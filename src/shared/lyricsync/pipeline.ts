// Emissions + text -> line and word timings. Port of the prototype's pipeline.py
// (everything after the neural network): anchors, chorus repeats, repair of lines the
// model cannot hear, missing tail detection, line ends, gaps, recognition level.

import { alignWords, FRAME_S, type LogProbs, type Window } from './ctc';
import { seqRatio } from './difflib';
import { percentile, voicedMask } from './dsp';
import { repeatAnchors, pyRound, type Feats } from './repeats';
import { isAdlib, isVocalise, LAT, latToCyr, toTokens, type Vocab } from './text';

export const LEAD_S = 0.15;
const MAX_EXTEND_S = 1.5;
const MISSING_MATCH = 0.3;
const MINDUR_FRAC = 0.6;
const SPREAD_MINRUN = 4;
const SPREAD_SURE = 0.5;
const MINDUR_ITERS = 4;
const SQUEEZE_X = 2.0;
const GAP_MIN_S = 4.0;
const RECOG_POOR = 0.30;
const RECOG_GOOD = 0.60;

const r3 = (x: number) => pyRound(x * 1000) / 1000;
const median = (a: ArrayLike<number>) => percentile(a, 50);

export interface Item { line: number; w: string; aligned: boolean; start: number; end: number; score: number }
export interface OutLine { i: number; text: string; start: number; end: number; conf: number; match: number; words: Item[] }
export interface Recognition { score: number; heard_pct: number; level: 'good' | 'partial' | 'poor' }
export interface Anchors { lines: Map<number, number>; words: Map<string, number> }   // words: "line:word" (0-based)
export interface AlignResult {
  lines: OutLine[];
  gaps: Array<[number, number]>;
  meta: {
    duration: number; lead: number; recognition: Recognition;
    repeat_anchors: Record<string, number>; retimed_lines: number[];
    missing_lines?: Array<{ i: number; text: string }>;
    unwritten_repeats?: Array<{ lines: number[]; refStart: number; at: number[] }>;
    anchors: Record<string, number>;
  };
}

export interface AlignInput {
  logp: LogProbs;            // masked emissions (silence forced to blank)
  spec: Vocab;               // alphabet of logp
  lines: string[];
  anchors?: Anchors;
  vocal: Float32Array | null;
  feats: Feats;              // repeatFeatures(vocal ?? mix)
  voiced: Uint8Array | null; // voiced mask per frame (vocal track)
  dur: number;
  vadDb?: number;
  lead?: number;
  repeat?: boolean;
  repair?: boolean;
}

const words = (line: string) => line.split(/\s+/).filter(Boolean);
const nchar = (t: string) => [...t.replace(/ /g, '')].length || 1;

function lineMatch(greedy: Int32Array, inv: Map<number, string>, spec: Vocab, ws: Item[]): number {
  const a = Math.trunc((ws[0].start + LEAD_S) / FRAME_S), b = Math.trunc(ws[ws.length - 1].end / FRAME_S) + 1;
  let heard = '';
  let prev = -1;
  for (let t = Math.max(0, a); t < Math.min(b, greedy.length); t++) {
    const tok = greedy[t];
    if (tok !== prev && tok !== spec.blank) heard += inv.get(tok) ?? '';
    prev = tok;
  }
  heard = heard.split('|').join(' ').trim().toLowerCase();
  let want = ws.map((w) => w.w).join(' ').toLowerCase();
  const keep = new Set(Object.keys(spec.vocab).filter((c) => [...c].length === 1).map((c) => c.toLowerCase()));
  want = [...want].map((c) => keep.has(c) ? c : (/[\p{L}\p{N}]/u.test(c) || '-,.!?—\'"()'.includes(c) ? '' : ' ')).join('');
  if ((spec.lang === 'ru' || spec.lang === 'uk') && LAT.test(want)) want = latToCyr(want);
  const w = want.trim();
  return w ? r3(seqRatio(heard, w)) : 0;
}

export function recognition(lines: Array<{ text: string; match: number }>): Recognition {
  const ls = lines.filter((l) => !isVocalise(l.text));
  if (!ls.length) return { score: 0, heard_pct: 0, level: 'poor' };
  let sw = 0, s = 0, heard = 0;
  for (const l of ls) { const w = [...l.text].length; sw += w; s += l.match * w; if (l.match >= MISSING_MATCH) heard++; }
  const score = s / Math.max(1, sw);
  return { score: r3(score), heard_pct: pyRound((100 * heard) / ls.length), level: score < RECOG_POOR ? 'poor' : score >= RECOG_GOOD ? 'good' : 'partial' };
}

function singExtent(vocal: Float32Array, nFrames: number, vadDb: number): [number, number] {
  const v = voicedMask(vocal, nFrames, vadDb, 0);
  const runs: Array<[number, number]> = [];
  let start = -1;
  for (let i = 0; i <= nFrames; i++) {
    const x = i < nFrames && v[i];
    if (x && start < 0) start = i;
    else if (!x && start >= 0) { if ((i - start) * FRAME_S >= 0.5) runs.push([start, i]); start = -1; }
  }
  if (!runs.length) return [0, nFrames * FRAME_S];
  return [runs[0][0] * FRAME_S, runs[runs.length - 1][1] * FRAME_S];
}

function anchorWindows(anchors: Map<number, number>, nLines: number, dur: number, caps?: Map<number, number> | null,
  lows?: Map<number, number> | null, slack = 0.6): Map<number, Window> | null {
  const pts = [...anchors.entries()].filter(([i]) => i >= 0 && i < nLines).sort((a, b) => a[0] - b[0]);
  if (!pts.length && !(lows && lows.size)) return null;
  const win = new Map<number, Window>();
  pts.forEach(([i, a], k) => {
    const [ni, na] = k + 1 < pts.length ? pts[k + 1] : [nLines, dur];
    for (let li = i; li < ni; li++) win.set(li, [Math.max(0, a - slack), Math.min(dur, na + slack)]);
  });
  for (let li = 0; li < (pts.length ? pts[0][0] : 0); li++) win.set(li, [0, pts[0][1] + slack]);
  for (const [li, c] of caps || []) {
    const w = win.get(li);
    if (w && c > w[0] + 1.5) win.set(li, [w[0], Math.min(w[1], c + slack)]);
  }
  for (const [li, lo] of lows || []) {
    const [a, b] = win.get(li) ?? [0, dur];
    if (lo < b - 0.5) win.set(li, [Math.max(a, lo), b]);
  }
  return win;
}

function pinsToWords(pins: Map<string, number>, items: Item[], idx: number[]): Map<number, number> {
  const seen = new Map<number, number>(), wiOf: number[] = [];
  items.forEach((x, ii) => { wiOf[ii] = seen.get(x.line) ?? 0; seen.set(x.line, wiOf[ii] + 1); });
  const out = new Map<number, number>();
  for (const [key, t] of pins) {
    const [li, wi] = key.split(':').map(Number);
    let best: [number, number, number] | null = null;
    idx.forEach((ii, k) => {
      if (items[ii].line !== li) return;
      const c: [number, number, number] = [Math.abs(wiOf[ii] - wi), wiOf[ii] < wi ? 1 : 0, k];
      if (!best || c[0] < best[0] || (c[0] === best[0] && (c[1] < best[1] || (c[1] === best[1] && c[2] < best[2])))) best = c;
    });
    if (best) out.set((best as [number, number, number])[2], t);
  }
  return out;
}

function wordWindows(lineWin: Map<number, Window> | null, pins: Map<number, number>, wordLine: Int32Array, nchars: number[],
  dur: number, slack = 0.4): [Map<number, Window>, Map<number, Window>] {
  const n = nchars.length;
  const ww = new Map<number, Window>();
  const merge = (k: number, lo: number, hi: number) => {
    const cur = ww.get(k);
    if (cur) {
      const nw: Window = [Math.max(cur[0], lo), Math.min(cur[1], hi)];
      if (nw[1] - nw[0] >= 0.3) { ww.set(k, nw); return; }
    }
    ww.set(k, [lo, hi]);
  };
  if (lineWin) for (let k = 0; k < n; k++) { const w = lineWin.get(wordLine[k]); if (w) ww.set(k, w); }
  const starts = new Map<number, Window>();
  for (const [k, t] of pins) starts.set(k, [Math.max(0, t - 0.5), Math.min(dur, t + 0.1)]);
  const pts = [...pins.entries()].sort((a, b) => a[0] - b[0]);
  pts.forEach(([k0, t0], m) => {
    const [k1, t1] = m + 1 < pts.length ? pts[m + 1] : [n, dur];
    for (let k = k0; k < k1; k++) {
      const lo = Math.max(0, t0 - slack);
      let hi = Math.min(dur, t1 + slack);
      if (k === k0) hi = Math.min(hi, t0 + slack + 0.25 * nchars[k] + 0.5);
      merge(k, lo, hi);
    }
  });
  for (let k = 0; k < pts[0][0]; k++) merge(k, 0, pts[0][1] + slack);
  return [ww, starts];
}

function linspace(a: number, b: number, n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(n === 1 ? a : a + ((b - a) * i) / (n - 1));
  return out;
}

function spreadVocalise(items: Item[], vocalise: Set<number>, onset: number, perLine = 0.6): void {
  if (!vocalise.size) return;
  const lines = [...new Set(items.map((x) => x.line))].sort((a, b) => a - b);
  let k = 0;
  while (k < lines.length) {
    if (!vocalise.has(lines[k])) { k++; continue; }
    const a = k;
    while (k + 1 < lines.length && vocalise.has(lines[k + 1])) k++;
    const b = k; k++;
    const before = items.filter((x) => x.line < lines[a] && !vocalise.has(x.line) && x.aligned);
    const after = items.filter((x) => x.line > lines[b] && !vocalise.has(x.line) && x.aligned);
    let t0 = before.length ? before[before.length - 1].end : onset;
    const n = b - a + 1;
    const t1 = after.length ? after[0].start : t0 + perLine * n;
    if (t1 - t0 > perLine * n) t0 = t1 - perLine * n;
    t0 = Math.min(t0, t1);
    const edges = linspace(t0, t1, n + 1);
    for (let r = 0; r < n; r++) {
      const ws = items.filter((x) => x.line === lines[a + r]);
      const cut = linspace(edges[r], edges[r + 1], ws.length + 1);
      ws.forEach((x, q) => { x.start = r3(cut[q]); x.end = r3(cut[q + 1]); x.score = 0; });
    }
  }
}

function fillUnaligned(items: Item[]): void {
  items.forEach((x, i) => {
    if (x.aligned) return;
    let prev: Item | null = null, nxt: Item | null = null;
    for (let j = i - 1; j >= 0; j--) if (items[j].aligned) { prev = items[j]; break; }
    for (let j = i + 1; j < items.length; j++) if (items[j].aligned) { nxt = items[j]; break; }
    const s = prev ? prev.end : (nxt ? nxt.start : 0);
    const e = nxt ? nxt.start : s;
    x.start = r3(s); x.end = r3(Math.max(s, e)); x.score = 0;
  });
}

interface Geo { ws: Item[][]; st: number[]; en: number[]; nch: number[]; nxt: number[]; cps: number[] }
function geo(items: Item[], lines: string[]): Geo {
  const n = lines.length;
  const ws: Item[][] = Array.from({ length: n }, () => []);
  for (const x of items) ws[x.line].push(x);
  const st = ws.map((w) => w[0].start), en = ws.map((w) => w[w.length - 1].end);
  const nch = lines.map(nchar);
  const nxt = [...st.slice(1), Math.max(en[n - 1], st[n - 1] + 0.3)];
  const cps = nch.map((c, i) => c / Math.max(0.3, Math.min(nxt[i] - st[i], 12)));
  return { ws, st, en, nch, nxt, cps };
}

function minDurationLows(items: Item[], lines: string[], mf: (ws: Item[]) => number, prot: Set<number>, lows: Map<number, number>): Map<number, number> {
  const n = lines.length;
  if (n < 6) return new Map();
  const { ws, st, nch, nxt, cps } = geo(items, lines);
  const med = median(cps);
  const out = new Map<number, number>();
  let floor = 0;
  for (let k = 0; k < n - 1; k++) {
    if (isVocalise(lines[k]) || prot.has(k)) { floor = 0; continue; }
    const mind = (MINDUR_FRAC * nch[k]) / med;
    const sq = nxt[k] - st[k] < mind && mf(ws[k]) < MISSING_MATCH;
    const begin = Math.max(st[k], floor);
    if (sq || floor > st[k]) {
      const need = begin + mind;
      if (need > st[k + 1] + 0.05 && !prot.has(k + 1)) { out.set(k + 1, r3(need)); floor = need; continue; }
    }
    floor = 0;
  }
  for (const [k, v] of [...out]) if (!(v > (lows.get(k) ?? 0) + 0.05)) out.delete(k);
  return out;
}

function tailSuspect(items: Item[], lines: string[], mf: (ws: Item[]) => number, prot: Set<number>): [number, number] | null {
  const n = lines.length;
  if (n < 8 || prot.has(n - 1)) return null;
  const { ws, cps } = geo(items, lines);
  const med = median(cps);
  if (cps[n - 1] > SQUEEZE_X * med && mf(ws[n - 1]) < MISSING_MATCH) return [Math.trunc(n * 0.6), med];
  return null;
}

function tailFits(lines: OutLine[], med: number): boolean {
  const n = lines.length;
  const st = lines.map((l) => l.start);
  const nxt = [...st.slice(1), lines[n - 1].words[lines[n - 1].words.length - 1].end + 0.3];
  const cps = lines.map((l, i) => nchar(l.text) / Math.max(0.3, Math.min(nxt[i] - st[i], 12)));
  return cps.slice(-2).every((c) => c <= SQUEEZE_X * med);
}

function retimeWords(ws: Item[], c0: number, c1: number): void {
  const sizes = ws.map((x) => [...x.w].length + 1);
  const tot = sizes.reduce((a, b) => a + b, 0);
  let acc = 0;
  ws.forEach((x, q) => {
    const a = c0 + (acc / tot) * (c1 - c0);
    acc += sizes[q];
    const b = c0 + (acc / tot) * (c1 - c0);
    x.start = r3(a); x.end = r3(b); x.score = 0;
  });
}

function spreadRange(G: Geo, a: number, b: number, t0: number, t1: number, done: number[]): void {
  const tot = G.nch.slice(a, b + 1).reduce((x, y) => x + y, 0);
  let acc = 0;
  for (let k = a; k <= b; k++) {
    const p0 = t0 + (acc / tot) * (t1 - t0);
    acc += G.nch[k];
    const p1 = t0 + (acc / tot) * (t1 - t0);
    retimeWords(G.ws[k], p0, p1);
    done.push(k);
  }
}

function spreadUnheardRuns(items: Item[], lines: string[], tEnd: number, prot: Set<number>, mf: (ws: Item[]) => number): number[] {
  const n = lines.length;
  if (n < 8) return [];
  const G = geo(items, lines);
  const { st, nch, nxt, cps } = G;
  const adlib = lines.map(isAdlib);
  const sure = lines.map((l, li) => prot.has(li) || isVocalise(l) || adlib[li] || mf(G.ws[li]) >= SPREAD_SURE);
  const pace = cps.filter((_, i) => sure[i] && !adlib[i]);
  const med = pace.length >= 4 ? median(pace) : median(cps);
  const done: number[] = [];
  let li = 0;
  while (li < n) {
    if (sure[li]) { li++; continue; }
    const a = li;
    while (li + 1 < n && !sure[li + 1]) li++;
    let b = li;
    li++;
    if (b - a + 1 < SPREAD_MINRUN) continue;
    const c = cps.slice(a, b + 1);
    const t0 = st[a];
    let t1: number, last: number | null;
    if (c.some((x) => x > SQUEEZE_X * med)) {
      const tail = b === n - 1;
      t1 = tail ? Math.max(tEnd, t0) : st[b + 1];
      t1 = Math.min(t1, t0 + (nch.slice(a, b + 1).reduce((x, y) => x + y, 0) / med) * 1.15);
      last = b;
    } else {
      last = null;
      for (let k = a + 1; k <= b; k++) {
        if (!(c[k - a] < med / SQUEEZE_X / 1.5 && nxt[k] - st[k] > 6 && k + 1 < n)) continue;
        const need = nch.slice(a, k).reduce((x, y) => x + y, 0) / med;
        const deficit = need - (st[k] - t0);
        const excess = (nxt[k] - st[k]) - nch[k] / med;
        if (deficit >= 2 && deficit >= 0.15 * excess) { last = k; break; }
      }
      if (last === null) continue;
      t1 = st[last + 1];
    }
    if (t1 - t0 < 0.3) continue;
    b = last;
    spreadRange(G, a, b, t0, t1, done);
  }
  return done;
}

function retimeSqueezed(items: Item[], lines: string[], tEnd: number, prot: Set<number>, mf: (ws: Item[]) => number): number[] {
  const n = lines.length;
  if (n < 6) return [];
  const G = geo(items, lines);
  const { ws, st, en, nch, cps } = G;
  const med = median(cps);
  const bad: number[] = [];
  for (let li = 0; li < n; li++) if (cps[li] > SQUEEZE_X * med && !prot.has(li) && mf(ws[li]) < MISSING_MATCH) bad.push(li);
  if (!bad.length) return [];
  const done: number[] = [];
  let k = 0;
  while (k < bad.length) {
    const a = bad[k];
    let b = a;
    while (k + 1 < bad.length && bad[k + 1] === b + 1) { k++; b = bad[k]; }
    k++;
    const t0 = a > 0 ? en[a - 1] : 0;
    const tail = b === n - 1;
    let t1 = tail ? Math.max(tEnd, t0) : st[b + 1];
    const want = (nch.slice(a, b + 1).reduce((x, y) => x + y, 0) / med) * 1.15;
    if (tail || t1 - t0 > want) t1 = Math.min(t1, t0 + want);
    if (t1 - t0 < 0.3) continue;
    spreadRange(G, a, b, t0, t1, done);
  }
  return done;
}

function extendEnds(lines: OutLine[], voiced: Uint8Array | null, nFrames: number, dur: number): void {
  lines.forEach((ln, i) => {
    const limit = i + 1 < lines.length ? lines[i + 1].start : dur;
    let end = ln.end;
    if (voiced) {
      let f = Math.trunc(end / FRAME_S);
      const cap = Math.min(limit, end + MAX_EXTEND_S);
      while (f < nFrames && voiced[f] && f * FRAME_S < cap) f++;
      end = f * FRAME_S;
    } else end += 0.4;
    ln.end = r3(Math.min(Math.max(end, ln.end), limit));
  });
}

function gaps(lines: OutLine[], dur: number): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  let prevEnd = 0;
  const r2 = (x: number) => pyRound(x * 100) / 100;
  for (const ln of lines) {
    if (ln.start - prevEnd >= GAP_MIN_S) out.push([r2(prevEnd), r2(ln.start)]);
    prevEnd = ln.end;
  }
  if (dur - prevEnd >= GAP_MIN_S) out.push([r2(prevEnd), r2(dur)]);
  return out;
}

export function argmaxRows(lp: LogProbs): Int32Array {
  const g = new Int32Array(lp.T);
  for (let t = 0; t < lp.T; t++) {
    let bi = 0, bv = -Infinity;
    const o = t * lp.V;
    for (let v = 0; v < lp.V; v++) if (lp.data[o + v] > bv) { bv = lp.data[o + v]; bi = v; }
    g[t] = bi;
  }
  return g;
}

export function alignLyrics(inp: AlignInput, drop = true): AlignResult {
  const { logp, spec, lines, vocal, feats, voiced, dur } = inp;
  const vadDb = inp.vadDb ?? -35, lead = inp.lead ?? LEAD_S;
  const anchors: Anchors = inp.anchors ?? { lines: new Map(), words: new Map() };
  const n = lines.length;
  const greedy = argmaxRows(logp);
  const inv = new Map<number, string>();
  for (const [c, i] of Object.entries(spec.vocab)) inv.set(i, c);
  const mf = (ws: Item[]) => lineMatch(greedy, inv, spec, ws);

  const items: Item[] = [], toks: number[][] = [], idx: number[] = [];
  const vocalise = new Set<number>();
  lines.forEach((l, li) => { if (isVocalise(l)) vocalise.add(li); });
  lines.forEach((line, li) => {
    for (const w of words(line)) {
      const tk = vocalise.has(li) ? [] : toTokens(w, spec);
      items.push({ line: li, w, aligned: tk.length > 0, start: 0, end: 0, score: 0 });
      if (tk.length) { idx.push(items.length - 1); toks.push(tk); }
    }
  });
  if (!toks.length) throw new Error('no alignable words in the text');
  const [tA, tB] = vocal ? singExtent(vocal, logp.T, vadDb) : [0, dur];
  const wordLine = Int32Array.from(idx.map((i) => items[i].line));

  const lineAnch = new Map(anchors.lines);
  const pinsIn = new Map([...anchors.words].filter(([k]) => { const li = Number(k.split(':')[0]); return li >= 0 && li < n; }));
  const pins = pinsToWords(pinsIn, items, idx);
  const prot = new Set<number>([...lineAnch.keys(), ...[...pins.keys()].map((k) => wordLine[k])]);

  const doAlign = (anch: Map<number, number>, caps?: Map<number, number> | null, lows?: Map<number, number> | null) => {
    const lw = anchorWindows(anch, n, dur, caps, lows);
    let ww: Map<number, Window> | null = null, wst: Map<number, Window> | null = null;
    if (pins.size) [ww, wst] = wordWindows(lw, pins, wordLine, toks.map((t) => t.length), dur);
    const res = alignWords(logp, toks, spec.blank, spec.delim, wordLine, { windows: lw, wordWindows: ww, wordStarts: wst });
    res.forEach((r, k) => { const it = items[idx[k]]; it.start = r3(r.start); it.end = r3(r.end); it.score = r3(r.score); });
    fillUnaligned(items);
    spreadVocalise(items, vocalise, tA);
  };

  doAlign(lineAnch);
  const auto = new Map<number, number>();
  let caps: Map<number, number> | null = null;
  let extras: AlignResult['meta']['unwritten_repeats'] = [];
  if (inp.repeat !== false) {
    const st: number[] = [], en: number[] = [], cf: number[] = [];
    const byLine: Item[][] = Array.from({ length: n }, () => []);
    for (const x of items) byLine[x.line].push(x);
    byLine.forEach((ws) => {
      st.push(ws[0].start); en.push(ws[ws.length - 1].end);
      const sc = ws.filter((x) => x.aligned).map((x) => x.score);
      cf.push(sc.length ? sc.reduce((a, b) => a + b, 0) / sc.length : -99);
    });
    const rl = lines.map((l) => isVocalise(l) ? '' : l);
    const match = byLine.map(mf);
    const rep = repeatAnchors(st, en, cf, rl, feats, match);
    for (const [k, v] of rep.anchors) if (!prot.has(k)) auto.set(k, v);
    caps = rep.caps;
    extras = rep.extras;
    if (auto.size) doAlign(new Map([...auto, ...lineAnch]), caps);
  }
  const curAnchors = auto.size ? new Map([...auto, ...lineAnch]) : lineAnch;
  const autoProt = new Set<number>([...auto.keys(), ...prot]);
  const lows = new Map<number, number>();
  for (let it = 0; it < MINDUR_ITERS; it++) {
    const nw = minDurationLows(items, lines, mf, autoProt, lows);
    if (!nw.size) break;
    const saved = items.map((x) => ({ ...x }));
    try {
      doAlign(curAnchors, auto.size ? caps : null, new Map([...lows, ...nw]));
      for (const [k, v] of nw) lows.set(k, v);
    } catch {
      saved.forEach((s, i) => Object.assign(items[i], s));
      break;
    }
  }
  if (drop) {
    const nTry = tailSuspect(items, lines, mf, prot);
    if (nTry) {
      const med = nTry[1];
      for (let keep = n - 1; keep >= nTry[0]; keep--) {
        const r2 = alignLyrics({ ...inp, lines: lines.slice(0, keep) }, false);
        if (tailFits(r2.lines, med)) {
          r2.meta.missing_lines = lines.slice(keep).map((text, k) => ({ i: keep + k, text }));
          return r2;
        }
      }
    }
  }
  let guessed: number[] = [];
  if (inp.repair !== false) {
    guessed = spreadUnheardRuns(items, lines, tB, autoProt, mf);
    const g2 = retimeSqueezed(items, lines, tB, new Set([...autoProt, ...guessed]), mf);
    for (const k of g2) if (!guessed.includes(k)) guessed.push(k);
  }
  for (const x of items) x.start = r3(Math.max(0, x.start - lead));

  const outLines: OutLine[] = lines.map((text, li) => {
    const ws = items.filter((x) => x.line === li);
    const sc = ws.filter((x) => x.aligned).map((x) => x.score);
    return {
      i: li, text, start: ws[0].start, end: ws[ws.length - 1].end,
      conf: guessed.includes(li) ? -9 : (sc.length ? r3(sc.reduce((a, b) => a + b, 0) / sc.length) : 0),
      match: lineMatch(greedy, inv, spec, ws),
      words: ws,
    };
  });
  extendEnds(outLines, voiced, logp.T, dur);
  const anchOut: Record<string, number> = {};
  for (const [k, v] of anchors.lines) anchOut[String(k)] = v;
  for (const [k, v] of anchors.words) anchOut[k] = v;
  const repOut: Record<string, number> = {};
  for (const [k, v] of auto) repOut[String(k)] = v;
  return {
    lines: outLines,
    gaps: gaps(outLines, dur),
    meta: {
      duration: dur, lead, recognition: recognition(outLines), repeat_anchors: repOut, retimed_lines: guessed,
      unwritten_repeats: extras && extras.length ? extras : undefined, anchors: anchOut,
    },
  };
}

// ---- LRC -------------------------------------------------------------------------

function ts(sec: number): string {
  sec = Math.max(0, sec);
  const m = Math.floor(sec / 60), s = sec - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(2).padStart(5, '0')}`;
}

export function toLrc(res: AlignResult, opts: { title?: string; artist?: string; enhanced?: boolean; instrumental?: boolean; tag?: string } = {}): string {
  const out: string[] = [];
  if (opts.artist) out.push(`[ar:${opts.artist}]`);
  if (opts.title) out.push(`[ti:${opts.title}]`);
  out.push(`[length:${ts(res.meta.duration)}]`);
  out.push(`[re:${opts.tag || 'SixteenCloud lyricsync'}]`);
  const ev: Array<[number, string]> = [];
  for (const ln of res.lines) {
    const body = opts.enhanced ? ln.words.map((w) => `<${ts(w.start)}>${w.w}`).join(' ') : ln.text;
    ev.push([ln.start, `[${ts(ln.start)}]${body}`]);
  }
  if (opts.instrumental !== false) for (const g of res.gaps) ev.push([g[0], `[${ts(g[0])}]`]);
  ev.sort((a, b) => a[0] - b[0]);
  return out.concat(ev.map((e) => e[1])).join('\n') + '\n';
}

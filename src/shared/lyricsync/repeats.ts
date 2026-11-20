// Repeated text blocks (choruses): when the sound of two copies matches with a constant
// offset, the less certain copy is anchored to the more certain one. Also handles a chorus
// sung more times than written ("x2" omitted). Port of the prototype's repeats.py.

import { seqRatio } from './difflib';
import { normLine } from './text';

export const SR = 16000;
export const HOP = 512;
const MIN_SIM = 0.8;
const MIN_BLOCK = 2;
const MIN_COS = 0.35;
const MAX_SPREAD_S = 0.4;
const NARROW_MIN_COS = 0.5;
const REF_MIN_MATCH = 0.25;
const RUN_MIN_COS = 0.55;
const RUN_REL = 0.85;
const RUN_HEARD = 0.5;

/** Python round(): half to even. */
export function pyRound(x: number): number {
  const r = Math.round(x);
  return (Math.abs(x % 1) === 0.5 && r % 2 !== 0) ? r - 1 : r;
}
const r3 = (x: number) => pyRound(x * 1000) / 1000;

export interface Feats { F: Float32Array; T: number; D: number }

export function findBlocks(lines: string[]): Array<[number, number, number]> {
  const n = lines.length;
  const nl = lines.map(normLine);
  const sim: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (nl[i] && nl[j] && seqRatio(nl[i], nl[j]) >= MIN_SIM) sim[i][j] = true;
  }
  const blocks: Array<[number, number, number]> = [];
  const seen = new Set<number>();
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
    if (sim[i][j] && !seen.has(i * n + j)) {
      let m = 0;
      while (i + m < n && j + m < n && sim[i + m][j + m] && i + m < j) { seen.add((i + m) * n + j + m); m++; }
      if (m >= MIN_BLOCK) blocks.push([i, j, m]);
    }
  }
  return blocks;
}

function dot(F: Feats, o1: number, o2: number): number {
  let s = 0;
  const D = F.D, a = o1 * D, b = o2 * D;
  for (let d = 0; d < D; d++) s += F.F[a + d] * F.F[b + d];
  return s;
}

function localOffset(F: Feats, a: number, b: number, center: number, span: number, minAbs = 0): [number, number] {
  const fa = Math.trunc((a * SR) / HOP), fb = Math.trunc((b * SR) / HOP);
  const W = Math.min(fb, F.T) - fa;
  if (W < 10) return [-1, 0];
  let best: [number, number] = [-1, 0];
  const step = HOP / SR;
  const n = Math.ceil((2 * span) / step);
  for (let q = 0; q < n; q++) {
    const dt = center - span + q * step;
    if (Math.abs(dt) < minAbs) continue;
    const o = pyRound(((a + dt) * SR) / HOP);
    if (o < 0 || o + W > F.T) continue;
    let s = 0;
    for (let k = 0; k < W; k++) s += dot(F, o + k, fa + k);
    s /= W;
    if (s > best[0]) best = [s, dt];
  }
  return best;
}

function paceCv(starts: number[], lines: string[], i: number, m: number): number {
  const cps: number[] = [];
  for (let k = 0; k < m - 1; k++) cps.push([...lines[i + k]].length / Math.max(0.3, starts[i + k + 1] - starts[i + k]));
  if (cps.length < 2) return 0;
  const mean = cps.reduce((x, y) => x + y, 0) / cps.length;
  const sd = Math.sqrt(cps.reduce((x, y) => x + (y - mean) ** 2, 0) / cps.length);
  return sd / Math.max(1e-6, mean);
}

function searchSpan(starts: number[], lines: string[], ref: number, tgt: number, searchS: number): number {
  const nl = lines.map(normLine);
  const center = starts[tgt] - starts[ref];
  let gap = 1e9;
  for (let c = 0; c < lines.length; c++) {
    if (c === ref || c === tgt || !nl[c] || !nl[ref]) continue;
    if (seqRatio(nl[c], nl[ref]) >= MIN_SIM) gap = Math.min(gap, Math.abs((starts[c] - starts[ref]) - center));
  }
  return Math.max(1, Math.min(searchS, 0.45 * gap));
}

/** Similarity of block a..b with every place of the track (whole-block cosine). */
function blockCos(F: Feats, a: number, b: number): { ts: Float64Array; s: Float64Array } {
  const fa = Math.trunc((a * SR) / HOP), fb = Math.min(Math.trunc((b * SR) / HOP), F.T);
  const W = fb - fa;
  if (W < 10 || W >= F.T) return { ts: new Float64Array(0), s: new Float64Array(0) };
  const n = F.T - W + 1;
  const s = new Float64Array(n), ts = new Float64Array(n);
  for (let o = 0; o < n; o++) {
    let acc = 0;
    for (let k = 0; k < W; k++) acc += dot(F, o + k, fa + k);
    s[o] = acc / W;
    ts[o] = (o * HOP) / SR;
  }
  return { ts, s };
}

function occurrences(F: Feats, a: number, b: number): Array<[number, number]> {
  const { ts, s } = blockCos(F, a, b);
  if (!s.length) return [[a, 1]];
  const L = b - a;
  for (let k = 0; k < s.length; k++) if (Math.abs(ts[k] - a) < 0.5 * L) s[k] = -1;
  const order = Array.from(s.keys()).sort((x, y) => s[y] - s[x]);
  let peaks: Array<[number, number]> = [];
  for (const k of order) {
    if (s[k] < RUN_MIN_COS) break;
    if (peaks.every(([t]) => Math.abs(ts[k] - t) >= 0.5 * L)) peaks.push([ts[k], s[k]]);
  }
  if (peaks.length) { const best = peaks[0][1]; peaks = peaks.filter((p) => p[1] >= RUN_REL * best); }
  return [...peaks, [a, 1] as [number, number]].sort((x, y) => x[0] - y[0]);
}

function runs(occ: Array<[number, number]>, L: number): number[][] {
  const out: number[][] = [];
  for (const [t] of occ) {
    const last = out[out.length - 1];
    if (last && t - last[last.length - 1] >= 0.8 * L && t - last[last.length - 1] <= 1.25 * L + 1.5) last.push(t);
    else out.push([t]);
  }
  return out;
}

/** Chorus sung twice in a row but written once: put the text copy on the FIRST of the sung copies.
 *  -> [shift of the ref copy, centre for the tgt copy relative to ref or null, start times of unwritten repeats]. */
function unwrittenRepeatShift(F: Feats, starts: number[], ends: number[], lines: string[], ref: number, tgt: number, m: number,
  match: number[] | null): [number, number | null, number[]] {
  const a = starts[ref], b = ends[ref + m - 1];
  const L = b - a;
  if (L < 3) return [0, null, []];
  const occ = occurrences(F, a, b);
  const nl = lines.map(normLine);
  const same = (x: number, y: number) => !!nl[x] && !!nl[y] && seqRatio(nl[x], nl[y]) >= MIN_SIM;
  let nText = 0, c = 0;
  while (c + m <= lines.length) {
    let all = true;
    for (let k = 0; k < m; k++) if (!same(c + k, ref + k)) { all = false; break; }
    if (all) { nText++; c += m; } else c++;
  }
  if (occ.length <= nText) return [0, null, []];
  const rs = runs(occ, L);
  const near = (t: number) => {
    let bi = 0, bd = Infinity;
    rs.forEach((r, i) => { const d = Math.min(...r.map((x) => Math.abs(t - x))); if (d < bd) { bd = d; bi = i; } });
    return bi;
  };
  const rRef = near(a), rTgt = near(starts[tgt]);
  if (rRef === rTgt) return [0, null, []];
  const copies = new Set<number>();
  for (let k = 0; k < m; k++) { copies.add(ref + k); copies.add(tgt + k); }
  const busy = (lo: number, hi: number) => {
    if (!match) return false;
    for (let k = 0; k < starts.length; k++) {
      if (copies.has(k) || match[k] < RUN_HEARD) continue;
      const ov = Math.min(hi, ends[k]) - Math.max(lo, starts[k]);
      if (ov > 0.5 * Math.max(0.3, ends[k] - starts[k])) return true;
    }
    return false;
  };
  let shift = 0;
  const extra: number[] = [];
  const run = rs[rRef];
  if (run.length > 1) {
    const first = run[0];
    if (Math.abs(first - a) > 0.5 && !busy(first, a)) shift = first - a;
    for (const t of run) if (Math.abs(t - (a + shift)) > 0.5) extra.push(t);
  }
  const runT = rs[rTgt];
  if (runT.length > 1) extra.push(...runT.slice(1));
  return [shift, runT[0] - a, extra];
}

export interface RepeatResult {
  anchors: Map<number, number>;          // line -> start time
  caps: Map<number, number>;             // last line of a copy -> latest end
  extras: Array<{ lines: number[]; refStart: number; at: number[] }>;
}

/** starts/ends/confs: current line alignment (s, without lead). lines: vocalise lines replaced by "". */
export function repeatAnchors(starts: number[], ends: number[], confs: number[], lines: string[], F: Feats,
  match: number[] | null, searchS = 8.0): RepeatResult {
  const out = new Map<number, number>(), caps = new Map<number, number>();
  const extras: RepeatResult['extras'] = [];
  const mean = (a: number[], i: number, m: number) => { let s = 0; for (let k = 0; k < m; k++) s += a[i + k]; return s / m; };
  for (const [i, j, m] of findBlocks(lines)) {
    const ci = mean(confs, i, m), cj = mean(confs, j, m);
    let ref: number, tgt: number;
    if (match) {
      const mi = mean(match, i, m), mj = mean(match, j, m);
      if (Math.max(mi, mj) < REF_MIN_MATCH) continue;
      if (Math.abs(mi - mj) > 0.15) [ref, tgt] = mi > mj ? [i, j] : [j, i];
      else if (Math.abs(ci - cj) > 0.5) [ref, tgt] = ci > cj ? [i, j] : [j, i];
      else [ref, tgt] = paceCv(starts, lines, i, m) <= paceCv(starts, lines, j, m) ? [i, j] : [j, i];
    } else if (Math.abs(ci - cj) > 0.5) [ref, tgt] = ci > cj ? [i, j] : [j, i];
    else [ref, tgt] = paceCv(starts, lines, i, m) <= paceCv(starts, lines, j, m) ? [i, j] : [j, i];

    let center = starts[tgt] - starts[ref];
    let search = searchSpan(starts, lines, ref, tgt, searchS);
    const [shift, c2, extra] = unwrittenRepeatShift(F, starts, ends, lines, ref, tgt, m, match);
    if (c2 !== null) { center = c2; search = Math.min(search, 2.0); }
    if (extra.length) extras.push({ lines: Array.from({ length: m }, (_, k) => ref + k), refStart: starts[ref], at: extra.map(r3) });

    const offs: number[] = [];
    const minAbs = 0.8 * (ends[ref + m - 1] - starts[ref]);
    for (let k = 0; k < m; k++) {
      const a = starts[ref + k], b = ends[ref + k];
      if (b - a < 0.8) continue;
      let [s, dt] = localOffset(F, a, b, center, search, minAbs);
      if (s < NARROW_MIN_COS && search < searchS) [s, dt] = localOffset(F, a, b, center, searchS, minAbs);
      if (s >= MIN_COS) offs.push(dt);
    }
    if (offs.length < Math.max(2, Math.floor((m + 1) / 2))) continue;
    const sorted = offs.slice().sort((x, y) => x - y);
    const h = sorted.length >> 1;
    const dt = sorted.length % 2 ? sorted[h] : (sorted[h - 1] + sorted[h]) / 2;
    if (sorted[sorted.length - 1] - sorted[0] > MAX_SPREAD_S) continue;
    for (let k = 0; k < m; k++) {
      out.set(tgt + k, r3(starts[ref + k] + dt));
      if (shift) out.set(ref + k, r3(starts[ref + k] + shift));
    }
    const n = starts.length;
    const spans: number[] = [];
    for (const c of [i, j]) if (c + m < n && c + m !== j) spans.push(starts[c + m] - starts[c + m - 1]);
    const span = spans.length ? Math.max(0.5, Math.min(...spans)) : Math.max(0.5, ends[ref + m - 1] - starts[ref + m - 1]);
    for (const c of [i, j]) {
      const first = out.get(c + m - 1) ?? starts[c + m - 1];
      caps.set(c + m - 1, r3(first + 1.5 * span + 1.0));
      const later = extra.filter((t) => t > (out.get(c) ?? starts[c]) + 0.5);
      if (later.length) caps.set(c + m - 1, r3(Math.min(caps.get(c + m - 1)!, Math.min(...later))));
    }
  }
  return { anchors: out, caps, extras };
}

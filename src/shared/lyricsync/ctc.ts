// CTC forced alignment (Viterbi) with hard time windows per target symbol and an
// in-line pause penalty. Ported from the prototype's viterbi.py + align.py; the
// arithmetic mirrors numpy float32 so paths match the prototype.

export const FRAME_S = 0.02;
export const HARD = -1e4;
export const IN_LINE_PEN = 0.03;      // nat per frame of pause between symbols of one line

const f32 = Math.fround;

/** Log-probabilities, T frames x V symbols, row-major. */
export interface LogProbs { data: Float32Array; T: number; V: number }

export type Window = [number, number];          // seconds, inclusive

export interface AlignOptions {
  /** line index -> allowed window for its symbols */
  windows?: Map<number, Window> | null;
  /** aligned-word index -> allowed window for its symbols */
  wordWindows?: Map<number, Window> | null;
  /** aligned-word index -> allowed window for its first symbol */
  wordStarts?: Map<number, Window> | null;
  inLinePen?: number;
}

export interface WordSpan { start: number; end: number; score: number }

/** -> path (T): target index per frame or -1 for blank. lo/hi: allowed time per target (outside: +HARD). */
export function viterbi(lp: LogProbs, targets: Int32Array, blank: number, lo: Float64Array | null, hi: Float64Array | null,
  blankPen: Float32Array | null): Int32Array {
  const { T, V, data } = lp;
  const L = targets.length;
  const S = 2 * L + 1;
  const NEG = f32(-1e30);
  const ext = new Int32Array(S).fill(blank);
  for (let k = 0; k < L; k++) ext[2 * k + 1] = targets[k];
  const skipOk = new Uint8Array(S);
  for (let s = 3; s < S; s += 2) skipOk[s] = targets[(s - 1) / 2] !== targets[(s - 3) / 2] ? 1 : 0;
  let alpha = new Float32Array(S).fill(NEG);
  let next = new Float32Array(S);
  const back = new Uint8Array(T * S);
  const biasAt = (t: number, k: number): number => {
    if (!lo || !hi) return 0;
    const ts = f32(t * FRAME_S);
    return (ts < lo[k] || ts > hi[k]) ? HARD : 0;
  };
  alpha[0] = data[ext[0]];
  if (S > 1) alpha[1] = f32(data[ext[1]] + biasAt(0, 0));
  for (let t = 1; t < T; t++) {
    const row = t * V;
    const bo = t * S;
    for (let s = 0; s < S; s++) {
      let best = alpha[s], choice = 0;
      if (s >= 1 && alpha[s - 1] > best) { best = alpha[s - 1]; choice = 1; }
      if (s >= 2 && skipOk[s] && alpha[s - 2] > best) { best = alpha[s - 2]; choice = 2; }
      // numpy argmax over (alpha, a1, a2) with NEG fill: ties go to the first
      if (s >= 2 && !skipOk[s] && choice === 0 && NEG > best) { best = NEG; choice = 2; }
      let e = data[row + ext[s]];
      if (s & 1) {
        const b = biasAt(t, (s - 1) >> 1);
        if (b) e = f32(e + b);
      } else if (blankPen) {
        e = f32(e - blankPen[s >> 1]);
      }
      let v = f32(best + e);
      if (v < NEG) v = NEG;
      next[s] = v;
      back[bo + s] = choice;
    }
    const tmp = alpha; alpha = next; next = tmp;
  }
  let s = S - 1;
  if (S > 1 && !(alpha[S - 1] >= alpha[S - 2])) s = S - 2;
  const path = new Int32Array(T);
  for (let t = T - 1; t >= 0; t--) {
    path[t] = s % 2 === 1 ? (s - 1) >> 1 : -1;
    s -= back[t * S + s];
  }
  return path;
}

/** Penalty (L+1) for blank states: paid only between symbols of one line. */
function gapPenalty(owner: Int32Array, wordLine: Int32Array, pen: number): Float32Array {
  const L = owner.length;
  const line = new Int32Array(L);
  for (let j = 0; j < L; j++) line[j] = owner[j] >= 0 ? wordLine[owner[j]] : -1;
  for (let j = 0; j < L; j++) {
    if (owner[j] < 0 && j > 0 && j < L - 1 && line[j - 1] === line[j + 1]) line[j] = line[j - 1];
  }
  const out = new Float32Array(L + 1);
  for (let k = 1; k < L; k++) out[k] = (line[k - 1] === line[k] && line[k] >= 0) ? f32(pen) : 0;
  return out;
}

/** wordTokens: ids per aligned word; wordLine[k]: its line. -> spans per word (seconds). Throws if the text does not fit. */
export function alignWords(lp: LogProbs, wordTokens: number[][], blank: number, delim: number | null,
  wordLine: Int32Array, opts: AlignOptions = {}): WordSpan[] {
  const tg: number[] = [], ow: number[] = [];
  wordTokens.forEach((toks, wi) => {
    if (wi && delim !== null) { tg.push(delim); ow.push(-1); }
    for (const x of toks) { tg.push(x); ow.push(wi); }
  });
  const targets = Int32Array.from(tg), owner = Int32Array.from(ow);
  const T = lp.T, L = targets.length;
  let R = 0;
  for (let j = 1; j < L; j++) if (targets[j] === targets[j - 1]) R++;
  if (T < L + R) throw new Error(`text does not fit the audio: ${L + R} symbols for ${T} frames`);

  let lo: Float64Array | null = null, hi: Float64Array | null = null;
  const { windows, wordWindows, wordStarts } = opts;
  if ((windows && windows.size) || (wordWindows && wordWindows.size) || (wordStarts && wordStarts.size)) {
    lo = new Float64Array(L).fill(-Infinity);
    hi = new Float64Array(L).fill(Infinity);
    const clip = (j: number, w: Window) => {
      const a = f32(w[0]), b = f32(w[1]);
      if (a > lo![j]) lo![j] = a;
      if (b < hi![j]) hi![j] = b;
    };
    for (let j = 0; j < L; j++) {
      const w = owner[j];
      if (w < 0) continue;
      const lw = windows?.get(wordLine[w]);
      if (lw) clip(j, lw);
      const ww = wordWindows?.get(w);
      if (ww) clip(j, ww);
      if (wordStarts && (j === 0 || owner[j - 1] !== w)) {
        const s0 = wordStarts.get(w);
        if (s0) clip(j, s0);
      }
    }
  }
  const pen = opts.inLinePen ?? IN_LINE_PEN;
  const blankPen = pen > 0 ? gapPenalty(owner, wordLine, pen) : null;
  const path = viterbi(lp, targets, blank, lo, hi, blankPen);

  const starts = new Int32Array(L).fill(-1), ends = new Int32Array(L).fill(-1);
  for (let t = 0; t < path.length; t++) {
    const j = path[t];
    if (j < 0) continue;
    if (starts[j] < 0) starts[j] = t;
    ends[j] = t + 1;
  }
  for (let j = 0; j < L; j++) if (starts[j] < 0) throw new Error('alignment found no path (windows too strict?)');
  const scFrame = new Float32Array(path.length);
  for (let t = 0; t < path.length; t++) {
    const tok = path[t] >= 0 ? targets[path[t]] : blank;
    scFrame[t] = lp.data[t * lp.V + tok];
  }
  const out: Array<{ start: number; end: number; scores: number[] } | null> = wordTokens.map(() => null);
  for (let j = 0; j < L; j++) {
    const w = owner[j];
    if (w < 0) continue;
    const s = starts[j] * FRAME_S, e = ends[j] * FRAME_S;
    let sum = 0;
    for (let t = starts[j]; t < ends[j]; t++) sum += scFrame[t];
    const sc = sum / (ends[j] - starts[j]);
    const o = out[w];
    if (!o) out[w] = { start: s, end: e, scores: [sc] };
    else { o.end = e; o.scores.push(sc); }
  }
  return out.map((o) => ({ start: o!.start, end: o!.end, score: o!.scores.reduce((a, b) => a + b, 0) / o!.scores.length }));
}

// Mixing emissions of several models (prototype pipeline._ensemble): XLSR (vocal) +
// GigaAM (vocal) + GigaAM (mix), averaged probabilities in the XLSR alphabet, each source
// weighted by how much it "hears" (share of non-blank frames where there is singing).

import type { LogProbs } from './ctc';
import { voicedMask } from './dsp';
import type { Vocab } from './text';

export interface Part { lp: LogProbs; vocab: Vocab }

function logSoftmaxRows(d: Float32Array, T: number, V: number): void {
  for (let t = 0; t < T; t++) {
    const o = t * V;
    let mx = -Infinity;
    for (let v = 0; v < V; v++) if (d[o + v] > mx) mx = d[o + v];
    let s = 0;
    for (let v = 0; v < V; v++) s += Math.exp(d[o + v] - mx);
    const ls = Math.log(s);
    for (let v = 0; v < V; v++) d[o + v] = Math.fround(d[o + v] - mx - ls);
  }
}

/** parts[0] defines the output alphabet. vocal: vocal track at 16 kHz (for the hearing weights) or null. */
export function ensemble(parts: Part[], vocal: Float32Array | null): { lp: LogProbs; weights: number[] } {
  const base = parts[0];
  const T = Math.min(...parts.map((p) => p.lp.T));
  const V = base.lp.V;
  const out = new Float32Array(T * V);
  for (let t = 0; t < T; t++) out.set(base.lp.data.subarray(t * V, t * V + V), t * V);
  if (parts.length === 1) return { lp: { data: out, T, V }, weights: [1] };

  // column maps: base id -> id in each part
  const maps = parts.map((p, pi) => {
    const m = new Map<number, number>();
    if (pi === 0) { for (const i of Object.values(base.vocab.vocab)) m.set(i, i); m.set(base.vocab.blank, base.vocab.blank); return m; }
    for (const [ch, i] of Object.entries(base.vocab.vocab)) {
      const gi = p.vocab.vocab[ch];
      if (gi !== undefined && ch !== '|') m.set(i, gi);
    }
    m.set(base.vocab.blank, p.vocab.blank);
    if (base.vocab.delim !== null && p.vocab.delim !== null) m.set(base.vocab.delim, p.vocab.delim);
    return m;
  });
  const cols = [...maps[1].keys()];

  // hearing weights
  const v = vocal ? voicedMask(vocal, T, -35, 0) : new Uint8Array(T).fill(1);
  const rate = parts.map((p) => {
    let n = 0, nb = 0;
    for (let t = 0; t < T; t++) {
      if (!v[t]) continue;
      n++;
      const o = t * p.lp.V;
      let bi = 0, bv = -Infinity;
      for (let k = 0; k < p.lp.V; k++) if (p.lp.data[o + k] > bv) { bv = p.lp.data[o + k]; bi = k; }
      if (bi !== p.vocab.blank) nb++;
    }
    return (n ? nb / n : 0) + 0.02;
  });
  const rs = rate.reduce((a, b) => a + b, 0);
  const w = rate.map((r) => r / rs);

  for (let t = 0; t < T; t++) {
    for (const c of cols) {
      let mx = -Infinity;
      const xs: number[] = [];
      for (let pi = 0; pi < parts.length; pi++) {
        const p = parts[pi];
        const x = p.lp.data[t * p.lp.V + (pi === 0 ? c : maps[pi].get(c)!)];
        xs.push(x);
        if (x > mx) mx = x;
      }
      let s = 0;
      for (let pi = 0; pi < xs.length; pi++) s += w[pi] * Math.exp(xs[pi] - mx);
      out[t * V + c] = mx + Math.log(s + 1e-30);
    }
  }
  logSoftmaxRows(out, T, V);
  return { lp: { data: out, T, V }, weights: w };
}

/** Silence: only blank is possible. */
export function maskSilence(lp: LogProbs, voiced: Uint8Array, blank: number): void {
  for (let t = 0; t < lp.T; t++) {
    if (voiced[t]) continue;
    const o = t * lp.V;
    for (let k = 0; k < lp.V; k++) lp.data[o + k] = -1e4;
    lp.data[o + blank] = 0;
  }
}

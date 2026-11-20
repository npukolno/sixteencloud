// Neural part of lyricsync, run inside the worker process: vocal separation (MDX-Net),
// character emissions (wav2vec2 XLSR, GigaAM v3 CTC). Takes an onnxruntime module
// (native onnxruntime-node or onnxruntime-web) so the same code runs on both.
// Ported from the prototype (emit.py, audio-separator's MDX code).

import type { LogProbs } from '../../shared/lyricsync/ctc';
import { fft, gigaFeatures, hann } from '../../shared/lyricsync/dsp';
import { pyRound } from '../../shared/lyricsync/repeats';

export type Ort = any;
export type Session = any;
export type Progress = (frac: number) => void;
export type CheckCancel = () => void;

export const SR = 16000;

function logSoftmax(d: Float32Array, T: number, V: number): void {
  for (let t = 0; t < T; t++) {
    const o = t * V;
    let mx = -Infinity;
    for (let v = 0; v < V; v++) if (d[o + v] > mx) mx = d[o + v];
    let s = 0;
    for (let v = 0; v < V; v++) s += Math.exp(d[o + v] - mx);
    const ls = Math.log(s);
    for (let v = 0; v < V; v++) d[o + v] = d[o + v] - mx - ls;
  }
}

// ---- wav2vec2 (XLSR) ----------------------------------------------------------------

const CTX = 2 * SR;          // 2 s of context on both sides of a window
const WIN = 30 * SR;         // 30 s useful window
const CTX_FR = CTX / 320;

export async function xlsrEmissions(ort: Ort, sess: Session, wav: Float32Array, normalize: boolean,
  progress: Progress, cancel: CheckCancel, batch = 1): Promise<LogProbs> {
  const n = wav.length;
  let x = wav;
  if (normalize) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += wav[i];
    mean /= n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (wav[i] - mean) ** 2;
    const sd = Math.sqrt(v / n + 1e-7);
    x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (wav[i] - mean) / sd;
  }
  const nWin = Math.ceil(n / WIN);
  const L = WIN + 2 * CTX;
  const nFrames = Math.floor((n - 400) / 320) + 1;
  const parts: Float32Array[] = [];
  let V = 0;
  const useMask = sess.inputNames.includes('attention_mask');
  for (let b = 0; b < nWin; b += batch) {
    cancel();
    const nb = Math.min(batch, nWin - b);
    const inp = new Float32Array(nb * L);
    for (let k = 0; k < nb; k++) {
      const off = (b + k) * WIN - CTX;            // window start in the unpadded signal
      for (let i = 0; i < L; i++) { const j = off + i; inp[k * L + i] = j >= 0 && j < n ? x[j] : 0; }
    }
    const feeds: Record<string, any> = { input_values: new ort.Tensor('float32', inp, [nb, L]) };
    if (useMask) feeds.attention_mask = new ort.Tensor('int64', new BigInt64Array(nb * L).fill(1n), [nb, L]);
    const out = await sess.run(feeds);
    const lg = out[sess.outputNames[0]];
    const [, Tw, Vv] = lg.dims as number[];
    V = Vv;
    const data = lg.data as Float32Array;
    for (let k = 0; k < nb; k++) parts.push(data.slice((k * Tw + CTX_FR) * V, (k * Tw + CTX_FR + WIN / 320) * V));
    progress(Math.min(1, (b + nb) / nWin));
  }
  const all = new Float32Array(nFrames * V);
  let o = 0;
  for (const p of parts) {
    const take = Math.min(p.length, all.length - o);
    if (take <= 0) break;
    all.set(p.subarray(0, take), o);
    o += take;
  }
  logSoftmax(all, nFrames, V);
  return { data: all, T: nFrames, V };
}

// ---- GigaAM v3 CTC ------------------------------------------------------------------

export async function gigaEmissions(ort: Ort, sess: Session, wav: Float32Array, progress: Progress, cancel: CheckCancel): Promise<LogProbs> {
  const n = wav.length, win = 20 * SR, ctx = SR;
  const chunks: Float32Array[] = [];
  let V = 0, total = 0;
  for (let t = 0; t < n; t += win) {
    cancel();
    const a = Math.max(0, t - ctx), b = Math.min(n, t + win + ctx);
    const { F, T } = gigaFeatures(wav.subarray(a, b));
    const out = await sess.run({
      features: new ort.Tensor('float32', F, [1, 64, T]),
      feature_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(T)]), [1]),
    });
    const lp = out[sess.outputNames[0]];
    const [, To, Vv] = lp.dims as number[];
    V = Vv;
    const s0 = pyRound((t - a) / SR / 0.04);
    const s1 = Math.min(To, s0 + pyRound(Math.min(win, n - t) / SR / 0.04));
    const d = (lp.data as Float32Array).slice(s0 * V, s1 * V);
    chunks.push(d);
    total += s1 - s0;
    progress(Math.min(1, (t + win) / n));
  }
  // 40 ms frames -> repeat each twice (20 ms grid of the other models)
  const T2 = total * 2;
  const outd = new Float32Array(T2 * V);
  let r = 0;
  for (const c of chunks) {
    for (let f = 0; f < c.length / V; f++) {
      const row = c.subarray(f * V, f * V + V);
      outd.set(row, r * V); outd.set(row, (r + 1) * V);
      r += 2;
    }
  }
  logSoftmax(outd, T2, V);
  return { data: outd, T: T2, V };
}

// ---- MDX-Net vocal separation (UVR-MDX-NET-Voc_FT) ----------------------------------

export interface MdxConfig { nFft: number; hop: number; dimF: number; dimT: number; overlap: number }
export const MDX_VOC_FT: MdxConfig = { nFft: 7680, hop: 1024, dimF: 3072, dimT: 256, overlap: 0.25 };

/** STFT of one stereo chunk -> model input (1, 4, dimF, dimT): ch0 re, ch0 im, ch1 re, ch1 im. Bins < 3 zeroed. */
function stftChunk(l: Float32Array, r: Float32Array, cfg: MdxConfig, win: Float64Array): Float32Array {
  const { nFft, hop, dimF, dimT } = cfg;
  const pad = nFft / 2, N = l.length;
  const out = new Float32Array(4 * dimF * dimT);
  const re = new Float64Array(nFft), im = new Float64Array(nFft);
  const refl = (i: number) => { if (i < 0) return -i; if (i >= N) return 2 * N - 2 - i; return i; };
  for (let t = 0; t < dimT; t++) {
    for (let i = 0; i < nFft; i++) {
      const j = refl(t * hop + i - pad);
      re[i] = l[j] * win[i]; im[i] = r[j] * win[i];
    }
    fft(re, im);
    for (let k = 3; k < dimF; k++) {
      const nk = (nFft - k) % nFft;
      const lr = (re[k] + re[nk]) / 2, li = (im[k] - im[nk]) / 2;       // left channel bin
      const rr = (im[k] + im[nk]) / 2, ri = (re[nk] - re[k]) / 2;       // right channel bin
      out[(0 * dimF + k) * dimT + t] = lr;
      out[(1 * dimF + k) * dimT + t] = li;
      out[(2 * dimF + k) * dimT + t] = rr;
      out[(3 * dimF + k) * dimT + t] = ri;
    }
  }
  return out;
}

/** Inverse STFT (torch.istft, center=True) of model output -> stereo chunk of hop*(dimT-1) samples. */
function istftChunk(spec: Float32Array, cfg: MdxConfig, win: Float64Array): [Float32Array, Float32Array] {
  const { nFft, hop, dimF, dimT } = cfg;
  const len = nFft + hop * (dimT - 1);
  const yl = new Float64Array(len), yr = new Float64Array(len), env = new Float64Array(len);
  const re = new Float64Array(nFft), im = new Float64Array(nFft);
  const half = nFft / 2;
  for (let t = 0; t < dimT; t++) {
    re.fill(0); im.fill(0);
    for (let k = 0; k < dimF; k++) {
      const lr = spec[(0 * dimF + k) * dimT + t], rr = spec[(2 * dimF + k) * dimT + t];
      let li = spec[(1 * dimF + k) * dimT + t], ri = spec[(3 * dimF + k) * dimT + t];
      if (k === 0 || k === half) { li = 0; ri = 0; }
      // Z = L + iR (one complex inverse FFT for both channels)
      re[k] += lr - ri; im[k] += li + rr;
      if (k > 0 && k < half) { re[nFft - k] += lr + ri; im[nFft - k] += -li + rr; }
    }
    fft(re, im, true);
    const o = t * hop;
    for (let i = 0; i < nFft; i++) {
      yl[o + i] += (re[i] / nFft) * win[i];
      yr[o + i] += (im[i] / nFft) * win[i];
      env[o + i] += win[i] * win[i];
    }
  }
  const outLen = hop * (dimT - 1);
  const L = new Float32Array(outLen), R = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const e = env[i + half];
    const d = e > 1e-11 ? e : 1;
    L[i] = yl[i + half] / d; R[i] = yr[i + half] / d;
  }
  return [L, R];
}

/** Vocal stem of a stereo 44.1 kHz mix (left/right). Returns stereo vocals peak-normalised to 0.9. */
export async function separateVocals(ort: Ort, sess: Session, left: Float32Array, right: Float32Array,
  progress: Progress, cancel: CheckCancel, cfg: MdxConfig = MDX_VOC_FT): Promise<[Float32Array, Float32Array]> {
  const N = left.length;
  let peak = 0;
  for (let i = 0; i < N; i++) { const a = Math.abs(left[i]), b = Math.abs(right[i]); if (a > peak) peak = a; if (b > peak) peak = b; }
  if (!(peak > 0)) return [new Float32Array(N), new Float32Array(N)];
  const sc = peak > 0.9 ? 0.9 / peak : 1;
  const trim = cfg.nFft / 2;
  const chunk = cfg.hop * (cfg.dimT - 1);
  const gen = chunk - 2 * trim;
  const pad = gen + trim - (N % gen);
  const M = trim + N + pad;
  const mixL = new Float32Array(M), mixR = new Float32Array(M);
  for (let i = 0; i < N; i++) { mixL[trim + i] = left[i] * sc; mixR[trim + i] = right[i] * sc; }
  const step = Math.trunc((1 - cfg.overlap) * chunk);
  const resL = new Float64Array(M), resR = new Float64Array(M), div = new Float64Array(M);
  const win = hann(cfg.nFft);
  const nChunks = Math.ceil(M / step);
  for (let c = 0, i = 0; i < M; i += step, c++) {
    cancel();
    const end = Math.min(i + chunk, M), actual = end - i;
    const pl = new Float32Array(chunk), pr = new Float32Array(chunk);
    pl.set(mixL.subarray(i, end)); pr.set(mixR.subarray(i, end));
    const spek = stftChunk(pl, pr, cfg, win);
    const out = await sess.run({ input: new ort.Tensor('float32', spek, [1, 4, cfg.dimF, cfg.dimT]) });
    const pred = out[sess.outputNames[0]].data as Float32Array;
    const [yl, yr] = istftChunk(pred, cfg, win);
    // numpy.hanning (symmetric) over the actual chunk length
    for (let k = 0; k < actual; k++) {
      const w = actual > 1 ? 0.5 - 0.5 * Math.cos((2 * Math.PI * k) / (actual - 1)) : 1;
      resL[i + k] += yl[k] * w; resR[i + k] += yr[k] * w; div[i + k] += w;
    }
    progress(Math.min(1, (c + 1) / nChunks));
  }
  const L = new Float32Array(N), R = new Float32Array(N);
  let vp = 0;
  for (let k = 0; k < N; k++) {
    const d = div[trim + k] || 1;
    L[k] = (resL[trim + k] / d) * peak; R[k] = (resR[trim + k] / d) * peak;
    vp = Math.max(vp, Math.abs(L[k]), Math.abs(R[k]));
  }
  if (vp > 0.9) { const s = 0.9 / vp; for (let k = 0; k < N; k++) { L[k] *= s; R[k] *= s; } }
  return [L, R];
}

// Signal processing for lyricsync: mixed-radix FFT (sizes like 7680, 1024, 320),
// librosa-compatible mel filters, log-mel, MFCC, loudness mask. Pure TS, no deps.

// ---- FFT (Stockham autosort, radices 4/2/3/5 + generic) ----------------------

interface Stage { R: number; Ns: number; cos: Float64Array; sin: Float64Array }
export interface FftPlan { N: number; stages: Stage[]; bufRe: Float64Array; bufIm: Float64Array }

const planCache = new Map<number, FftPlan>();

export function fftPlan(N: number): FftPlan {
  const hit = planCache.get(N);
  if (hit) return hit;
  const radices: number[] = [];
  let n = N;
  for (const r of [4, 2, 3, 5]) while (n % r === 0) { radices.push(r); n /= r; }
  for (let r = 7; n > 1; r += 2) while (n % r === 0) { radices.push(r); n /= r; }
  const stages: Stage[] = [];
  let Ns = 1;
  for (const R of radices) {
    const cos = new Float64Array(Ns * R), sin = new Float64Array(Ns * R);
    for (let j = 0; j < Ns; j++) {
      const ang = (-2 * Math.PI * j) / (Ns * R);
      for (let r = 0; r < R; r++) { cos[j * R + r] = Math.cos(ang * r); sin[j * R + r] = Math.sin(ang * r); }
    }
    stages.push({ R, Ns, cos, sin });
    Ns *= R;
  }
  const plan = { N, stages, bufRe: new Float64Array(N), bufIm: new Float64Array(N) };
  planCache.set(N, plan);
  return plan;
}

const C3 = -0.5, S3 = -Math.sqrt(3) / 2;
const C51 = Math.cos(2 * Math.PI / 5), C52 = Math.cos(4 * Math.PI / 5);
const S51 = -Math.sin(2 * Math.PI / 5), S52 = -Math.sin(4 * Math.PI / 5);

/** In-place forward FFT (sign -1). inverse=true computes the unscaled inverse. */
export function fft(re: Float64Array, im: Float64Array, inverse = false): void {
  const N = re.length;
  const plan = fftPlan(N);
  if (inverse) for (let i = 0; i < N; i++) im[i] = -im[i];
  let xr = re, xi = im, yr = plan.bufRe, yi = plan.bufIm;
  const vr = new Float64Array(8), vi = new Float64Array(8);
  for (const { R, Ns, cos, sin } of plan.stages) {
    const NR = N / R;
    const gr = R > 8 ? new Float64Array(R) : vr, gi = R > 8 ? new Float64Array(R) : vi;
    for (let j = 0; j < NR; j++) {
      const jm = j % Ns;
      const tw = jm * R;
      for (let r = 0; r < R; r++) {
        const a = xr[j + r * NR], b = xi[j + r * NR];
        const c = cos[tw + r], s = sin[tw + r];
        gr[r] = a * c - b * s; gi[r] = a * s + b * c;
      }
      const base = (j - jm) * R + jm;
      if (R === 2) {
        yr[base] = gr[0] + gr[1]; yi[base] = gi[0] + gi[1];
        yr[base + Ns] = gr[0] - gr[1]; yi[base + Ns] = gi[0] - gi[1];
      } else if (R === 4) {
        const ar = gr[0] + gr[2], ai = gi[0] + gi[2], br = gr[0] - gr[2], bi = gi[0] - gi[2];
        const cr = gr[1] + gr[3], ci = gi[1] + gi[3], dr = gr[1] - gr[3], di = gi[1] - gi[3];
        yr[base] = ar + cr; yi[base] = ai + ci;
        yr[base + Ns] = br + di; yi[base + Ns] = bi - dr;
        yr[base + 2 * Ns] = ar - cr; yi[base + 2 * Ns] = ai - ci;
        yr[base + 3 * Ns] = br - di; yi[base + 3 * Ns] = bi + dr;
      } else if (R === 3) {
        const sr = gr[1] + gr[2], si = gi[1] + gi[2], dr = gr[1] - gr[2], di = gi[1] - gi[2];
        const mr = gr[0] + C3 * sr, mi = gi[0] + C3 * si;
        yr[base] = gr[0] + sr; yi[base] = gi[0] + si;
        yr[base + Ns] = mr - S3 * di; yi[base + Ns] = mi + S3 * dr;
        yr[base + 2 * Ns] = mr + S3 * di; yi[base + 2 * Ns] = mi - S3 * dr;
      } else if (R === 5) {
        const s1r = gr[1] + gr[4], s1i = gi[1] + gi[4], d1r = gr[1] - gr[4], d1i = gi[1] - gi[4];
        const s2r = gr[2] + gr[3], s2i = gi[2] + gi[3], d2r = gr[2] - gr[3], d2i = gi[2] - gi[3];
        const m1r = gr[0] + C51 * s1r + C52 * s2r, m1i = gi[0] + C51 * s1i + C52 * s2i;
        const m2r = gr[0] + C52 * s1r + C51 * s2r, m2i = gi[0] + C52 * s1i + C51 * s2i;
        const n1r = S51 * d1r + S52 * d2r, n1i = S51 * d1i + S52 * d2i;
        const n2r = S52 * d1r - S51 * d2r, n2i = S52 * d1i - S51 * d2i;
        yr[base] = gr[0] + s1r + s2r; yi[base] = gi[0] + s1i + s2i;
        yr[base + Ns] = m1r - n1i; yi[base + Ns] = m1i + n1r;
        yr[base + 4 * Ns] = m1r + n1i; yi[base + 4 * Ns] = m1i - n1r;
        yr[base + 2 * Ns] = m2r - n2i; yi[base + 2 * Ns] = m2i + n2r;
        yr[base + 3 * Ns] = m2r + n2i; yi[base + 3 * Ns] = m2i - n2r;
      } else {
        for (let k = 0; k < R; k++) {
          let sr = 0, si = 0;
          for (let r = 0; r < R; r++) {
            const ang = (-2 * Math.PI * r * k) / R;
            const c = Math.cos(ang), s = Math.sin(ang);
            sr += gr[r] * c - gi[r] * s; si += gr[r] * s + gi[r] * c;
          }
          yr[base + k * Ns] = sr; yi[base + k * Ns] = si;
        }
      }
    }
    const tr = xr, ti = xi; xr = yr; xi = yi; yr = tr; yi = ti;
  }
  if (xr !== re) { re.set(xr); im.set(xi); }
  if (inverse) for (let i = 0; i < N; i++) im[i] = -im[i];
}

// ---- Windows, mel filters -----------------------------------------------------

/** Periodic Hann (scipy get_window('hann', n, fftbins=True), torch.hann_window(periodic=True)). */
export function hann(n: number): Float64Array {
  const w = new Float64Array(n);
  for (let i = 0; i < n; i++) w[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n);
  return w;
}

function hzToMel(f: number, htk: boolean): number {
  if (htk) return 2595 * Math.log10(1 + f / 700);
  const fsp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fsp, logstep = Math.log(6.4) / 27;
  return f >= minLogHz ? minLogMel + Math.log(f / minLogHz) / logstep : f / fsp;
}
function melToHz(m: number, htk: boolean): number {
  if (htk) return 700 * (Math.pow(10, m / 2595) - 1);
  const fsp = 200 / 3, minLogHz = 1000, minLogMel = minLogHz / fsp, logstep = Math.log(6.4) / 27;
  return m >= minLogMel ? minLogHz * Math.exp(logstep * (m - minLogMel)) : fsp * m;
}

/** librosa.filters.mel: (nMels x (nFft/2+1)), row-major. */
export function melFilters(sr: number, nFft: number, nMels: number, htk: boolean, slaneyNorm: boolean, fmin = 0, fmax = sr / 2): Float32Array {
  const nB = Math.floor(nFft / 2) + 1;
  const lo = hzToMel(fmin, htk), hi = hzToMel(fmax, htk);
  const melF = new Float64Array(nMels + 2);
  for (let i = 0; i < nMels + 2; i++) melF[i] = melToHz(lo + ((hi - lo) * i) / (nMels + 1), htk);
  const W = new Float32Array(nMels * nB);
  for (let i = 0; i < nMels; i++) {
    const enorm = slaneyNorm ? 2 / (melF[i + 2] - melF[i]) : 1;
    const d0 = melF[i + 1] - melF[i], d1 = melF[i + 2] - melF[i + 1];
    for (let k = 0; k < nB; k++) {
      const f = (k * sr) / nFft;
      const lower = (f - melF[i]) / d0, upper = (melF[i + 2] - f) / d1;
      W[i * nB + k] = Math.max(0, Math.min(lower, upper)) * enorm;
    }
  }
  return W;
}

/** Power spectrogram frames (T x nB) of y; center pads nFft/2 zeros on both sides (librosa pad_mode='constant'). */
export function powerSpec(y: Float32Array, nFft: number, hop: number, center: boolean): { P: Float32Array; T: number; nB: number } {
  const pad = center ? Math.floor(nFft / 2) : 0;
  const len = y.length + 2 * pad;
  const T = len < nFft ? 0 : 1 + Math.floor((len - nFft) / hop);
  const nB = Math.floor(nFft / 2) + 1;
  const win = hann(nFft);
  const P = new Float32Array(T * nB);
  const re = new Float64Array(nFft), im = new Float64Array(nFft);
  // two real frames per complex FFT
  for (let t = 0; t < T; t += 2) {
    const two = t + 1 < T;
    for (let i = 0; i < nFft; i++) {
      const i1 = t * hop + i - pad, i2 = (t + 1) * hop + i - pad;
      re[i] = (i1 >= 0 && i1 < y.length ? y[i1] : 0) * win[i];
      im[i] = two && i2 >= 0 && i2 < y.length ? y[i2] * win[i] : 0;
    }
    fft(re, im);
    for (let k = 0; k < nB; k++) {
      const nk = (nFft - k) % nFft;
      const ar = (re[k] + re[nk]) / 2, ai = (im[k] - im[nk]) / 2;       // frame t
      P[t * nB + k] = ar * ar + ai * ai;
      if (two) {
        const br = (im[k] + im[nk]) / 2, bi = (re[nk] - re[k]) / 2;     // frame t+1
        P[(t + 1) * nB + k] = br * br + bi * bi;
      }
    }
  }
  return { P, T, nB };
}

function applyMel(P: Float32Array, T: number, nB: number, W: Float32Array, nMels: number): Float32Array {
  const M = new Float32Array(T * nMels);
  for (let t = 0; t < T; t++) {
    for (let m = 0; m < nMels; m++) {
      let s = 0;
      const wo = m * nB, po = t * nB;
      for (let k = 0; k < nB; k++) { const w = W[wo + k]; if (w) s += w * P[po + k]; }
      M[t * nMels + m] = s;
    }
  }
  return M;
}

/** GigaAM features: log mel 64, n_fft 320, hop 160, no centering, HTK mel, no norm. -> (64 x T) row-major per mel. */
export function gigaFeatures(y: Float32Array): { F: Float32Array; T: number } {
  const { P, T, nB } = powerSpec(y, 320, 160, false);
  const W = melFilters(16000, 320, 64, true, false, 0, 8000);
  const M = applyMel(P, T, nB, W, 64);
  const F = new Float32Array(64 * T);
  for (let t = 0; t < T; t++) for (let m = 0; m < 64; m++) F[m * T + t] = Math.log(Math.min(1e9, Math.max(1e-9, M[t * 64 + m])));
  return { F, T };
}

/** Features for comparing repeated sections (prototype repeats.features): MFCC 1..19 (librosa defaults,
 *  hop 512, n_fft 1024), standardised per coefficient, L2-normalised per frame. -> (T x 19). */
export function repeatFeatures(y: Float32Array, sr = 16000): { F: Float32Array; T: number; D: number } {
  const nMels = 128, nMfcc = 20;
  const { P, T, nB } = powerSpec(y, 1024, 512, true);
  const W = melFilters(sr, 1024, nMels, false, true);
  const M = applyMel(P, T, nB, W, nMels);
  // power_to_db(ref=1, amin=1e-10, top_db=80)
  let mx = -Infinity;
  for (let i = 0; i < M.length; i++) { const v = 10 * Math.log10(Math.max(1e-10, M[i])); M[i] = v; if (v > mx) mx = v; }
  for (let i = 0; i < M.length; i++) if (M[i] < mx - 80) M[i] = mx - 80;
  // DCT-II ortho, keep coefficients 1..19
  const D = nMfcc - 1;
  const basis = new Float64Array(nMfcc * nMels);
  for (let k = 0; k < nMfcc; k++) {
    const sc = k === 0 ? Math.sqrt(1 / nMels) : Math.sqrt(2 / nMels);
    for (let n = 0; n < nMels; n++) basis[k * nMels + n] = sc * Math.cos((Math.PI / nMels) * (n + 0.5) * k);
  }
  const F = new Float32Array(T * D);
  for (let t = 0; t < T; t++) {
    for (let k = 1; k < nMfcc; k++) {
      let s = 0;
      for (let n = 0; n < nMels; n++) s += basis[k * nMels + n] * M[t * nMels + n];
      F[t * D + k - 1] = s;
    }
  }
  for (let d = 0; d < D; d++) {
    let mean = 0;
    for (let t = 0; t < T; t++) mean += F[t * D + d];
    mean /= Math.max(1, T);
    let v = 0;
    for (let t = 0; t < T; t++) { const x = F[t * D + d] - mean; v += x * x; }
    const sd = Math.sqrt(v / Math.max(1, T)) + 1e-6;
    for (let t = 0; t < T; t++) F[t * D + d] = (F[t * D + d] - mean) / sd;
  }
  for (let t = 0; t < T; t++) {
    let n = 0;
    for (let d = 0; d < D; d++) n += F[t * D + d] ** 2;
    n = Math.sqrt(n) + 1e-9;
    for (let d = 0; d < D; d++) F[t * D + d] /= n;
  }
  return { F, T, D };
}

// ---- Loudness ------------------------------------------------------------------

/** Loudness (dB) in nFrames equal frames. */
export function frameDb(wav: Float32Array, nFrames: number): Float64Array {
  const hop = wav.length / nFrames;
  const sq = new Float64Array(wav.length + 1);
  for (let i = 0; i < wav.length; i++) sq[i + 1] = sq[i] + wav[i] * wav[i];
  const out = new Float64Array(nFrames);
  for (let f = 0; f < nFrames; f++) {
    const a = Math.floor(f * hop), b = Math.floor((f + 1) * hop);
    const rms = Math.sqrt((sq[b] - sq[a]) / Math.max(1, b - a));
    out[f] = 20 * Math.log10(rms + 1e-9);
  }
  return out;
}

/** numpy.percentile (linear interpolation). */
export function percentile(x: ArrayLike<number>, q: number): number {
  const s = Float64Array.from(x).sort();
  if (!s.length) return 0;
  const pos = ((s.length - 1) * q) / 100;
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

/** Frames where the (vocal) track is within thrDb of its loud level, dilated by pad frames. */
export function voicedMask(wav: Float32Array, nFrames: number, thrDb = -35, pad = 2): Uint8Array {
  const db = frameDb(wav, nFrames);
  const thr = percentile(db, 95) + thrDb;
  const v = new Uint8Array(nFrames);
  for (let i = 0; i < nFrames; i++) v[i] = db[i] > thr ? 1 : 0;
  if (!pad) return v;
  const out = new Uint8Array(nFrames);
  for (let i = 0; i < nFrames; i++) {
    if (!v[i]) continue;
    for (let k = Math.max(0, i - pad); k <= Math.min(nFrames - 1, i + pad); k++) out[k] = 1;
  }
  return out;
}

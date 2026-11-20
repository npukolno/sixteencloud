// lyricsync worker: runs in its own process (Electron utilityProcess, or a Node child in tests)
// so a crash, an out-of-memory or a hang can never take the app down, and cancel = kill.
// Steps: decode -> vocal separation -> character emissions -> alignment.

import { spawn } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensemble, maskSilence } from '../../shared/lyricsync/ensemble';
import { repeatFeatures, voicedMask } from '../../shared/lyricsync/dsp';
import { alignLyrics, toLrc, type AlignResult } from '../../shared/lyricsync/pipeline';
import type { LogProbs } from '../../shared/lyricsync/ctc';
import type { Vocab } from '../../shared/lyricsync/text';
import { gigaEmissions, separateVocals, xlsrEmissions, type Ort } from './engine';

export type Stage = 'decode' | 'runtime' | 'separate' | 'emissions' | 'align';
export interface JobSpec {
  audio: string;              // local file (or an HLS playlist file when hls=true)
  hls?: boolean;
  lines: string[];
  lang: 'ru' | 'en';
  anchors?: { lines: Array<[number, number]>; words: Array<[string, number]> };
  runtimeDir: string;
  backend: 'native' | 'wasm';
  separatorDir: string;
  languageDir: string;
  ffmpeg: string;
  threads: number;
  maxSeconds?: number;
  meta?: { title?: string; artist?: string };
}
export type WorkerMsg =
  | { type: 'progress'; stage: Stage; frac: number; overall: number }
  | { type: 'log'; message: string }
  | { type: 'result'; result: AlignResult; lrc: string; timings: Record<string, number>; backend: string }
  | { type: 'error'; code: string; message: string };

// share of the total time per stage (measured on a 6-core CPU)
const WEIGHT: Record<Stage, [number, number]> = {
  decode: [0, 0.02], runtime: [0.02, 0.04], separate: [0.04, 0.72], emissions: [0.72, 0.97], align: [0.97, 1],
};

class JobError extends Error { constructor(public code: string, msg: string) { super(msg); } }

const port: any = (process as any).parentPort;
function send(m: WorkerMsg): void {
  if (port) port.postMessage(m); else if (process.send) process.send(m);
}
let lastSent = 0;
function progress(stage: Stage, frac: number, force = false): void {
  const now = Date.now();
  if (!force && now - lastSent < 250 && frac < 1) return;
  lastSent = now;
  const [a, b] = WEIGHT[stage];
  send({ type: 'progress', stage, frac, overall: a + (b - a) * Math.max(0, Math.min(1, frac)) });
}

function ffmpegDecode(ff: string, input: string, hls: boolean, channels: number, rate: number, maxSeconds: number): Promise<Float32Array> {
  const args = ['-v', 'error', '-nostdin'];
  if (hls) args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls');
  args.push('-i', input, '-t', String(maxSeconds), '-vn', '-f', 'f32le', '-ac', String(channels), '-ar', String(rate), '-');
  return runFfmpeg(ff, args, null);
}

function runFfmpeg(ff: string, args: string[], stdin: Buffer | null): Promise<Float32Array> {
  return new Promise((resolve, reject) => {
    const p = spawn(ff, args, { stdio: [stdin ? 'pipe' : 'ignore', 'pipe', 'pipe'], windowsHide: true });
    const chunks: Buffer[] = [];
    let err = '';
    p.stdout!.on('data', (c: Buffer) => chunks.push(c));
    p.stderr!.on('data', (c: Buffer) => { err = (err + c.toString()).slice(-2000); });
    p.on('error', (e) => reject(new JobError('decode', `ffmpeg: ${e.message}`)));
    p.on('close', (code) => {
      if (code !== 0) { reject(new JobError('decode', `ffmpeg exited ${code}: ${err.trim().split('\n').slice(-2).join(' | ')}`)); return; }
      const buf = Buffer.concat(chunks);
      resolve(new Float32Array(buf.buffer, buf.byteOffset, Math.floor(buf.length / 4)).slice());
    });
    if (stdin) { p.stdin!.on('error', () => { /* reported by close */ }); p.stdin!.end(stdin); }
  });
}

function loadOrt(dir: string, backend: 'native' | 'wasm', threads: number): Ort {
  if (backend === 'native') return require(path.join(dir, 'node_modules', 'onnxruntime-node'));
  const ort = require(path.join(dir, 'node_modules', 'onnxruntime-web', 'dist', 'ort.node.min.js'));
  ort.env.wasm.numThreads = threads;
  ort.env.wasm.wasmPaths = path.join(dir, 'node_modules', 'onnxruntime-web', 'dist') + path.sep;
  return ort;
}

function readXlsrVocab(file: string, lang: string): Vocab {
  const v = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, number>;
  const blank = v['<pad>'] ?? v['[PAD]'];
  if (blank === undefined || v['|'] === undefined) throw new JobError('model', 'unexpected vocabulary');
  return { lang, variant: 'xlsr', vocab: v, blank, delim: v['|'] };
}

function readGigaVocab(file: string): Vocab {
  const v: Record<string, number> = {};
  for (const ln of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!ln.trim()) continue;
    const i = ln.lastIndexOf(' ');
    v[ln.slice(0, i)] = Number(ln.slice(i + 1));
  }
  const blank = v['<blk>'];
  delete v['<blk>'];
  v['|'] = v['▁']; delete v['▁'];
  v['ё'] = v['е'];                                       // no ё in the GigaAM alphabet
  return { lang: 'ru', variant: 'giga', vocab: v, blank, delim: v['|'] };
}

async function run(job: JobSpec): Promise<void> {
  const T: Record<string, number> = {};
  const tick = (k: string, t0: number) => { T[k] = Math.round((performance.now() - t0) / 100) / 10; };
  const cancel = () => { /* the parent kills the process to cancel */ };
  const maxS = job.maxSeconds ?? 900;

  let t0 = performance.now();
  progress('decode', 0, true);
  const mix = await ffmpegDecode(job.ffmpeg, job.audio, !!job.hls, 1, 16000, maxS);
  if (mix.length < 16000 * 5) throw new JobError('decode', 'audio is shorter than 5 seconds or could not be read');
  const dur = mix.length / 16000;
  let st: Float32Array | null = await ffmpegDecode(job.ffmpeg, job.audio, !!job.hls, 2, 44100, maxS);
  const N = st.length / 2;
  const L = new Float32Array(N), R = new Float32Array(N);
  for (let i = 0; i < N; i++) { L[i] = st[2 * i]; R[i] = st[2 * i + 1]; }
  st = null;
  tick('decode_s', t0);
  progress('decode', 1, true);

  t0 = performance.now();
  progress('runtime', 0, true);
  let ort: Ort;
  try { ort = loadOrt(job.runtimeDir, job.backend, job.threads); } catch (e: any) {
    throw new JobError('runtime', `engine failed to load: ${e?.message || e}`);
  }
  const opts = job.backend === 'native'
    // No arena (peak memory 3.0 -> 1.9 GB) and no memory pattern: with it, the second run of a session that
    // returns a large tensor (MDX) crashes the process under Electron's V8 sandbox.
    ? { intraOpNumThreads: job.threads, interOpNumThreads: 1, graphOptimizationLevel: 'all', enableCpuMemArena: false, enableMemPattern: false }
    : { executionProviders: ['wasm'], graphOptimizationLevel: 'all' };
  const open = async (file: string) => {
    try { return await ort.InferenceSession.create(file, opts); } catch (e: any) {
      const m = String(e?.message || e);
      throw new JobError(/alloc|memory/i.test(m) ? 'memory' : 'model', `model ${path.basename(file)}: ${m}`);
    }
  };
  tick('runtime_s', t0);
  progress('runtime', 1, true);

  t0 = performance.now();
  progress('separate', 0, true);
  const sep = await open(path.join(job.separatorDir, 'UVR-MDX-NET-Voc_FT.onnx'));
  const [vl, vr] = await separateVocals(ort, sep, L, R, (f) => progress('separate', f), cancel);
  await sep.release?.();
  const inter = new Float32Array(2 * N);
  for (let i = 0; i < N; i++) { inter[2 * i] = vl[i]; inter[2 * i + 1] = vr[i]; }
  const vocal = await runFfmpeg(job.ffmpeg, ['-v', 'error', '-f', 'f32le', '-ac', '2', '-ar', '44100', '-i', 'pipe:0',
    '-f', 'f32le', '-ac', '1', '-ar', '16000', 'pipe:1'], Buffer.from(inter.buffer));
  (global as any).gc?.();
  tick('separate_s', t0);
  progress('separate', 1, true);

  t0 = performance.now();
  progress('emissions', 0, true);
  const xv = readXlsrVocab(path.join(job.languageDir, 'xlsr.vocab.json'), job.lang);
  const xs = await open(path.join(job.languageDir, 'xlsr.onnx'));
  const ruShare = job.lang === 'ru' ? 0.6 : 1;
  const xe = await xlsrEmissions(ort, xs, vocal, true, (f) => progress('emissions', f * ruShare), cancel);
  await xs.release?.();
  let lp: LogProbs = xe;
  let spec = xv;
  if (job.lang === 'ru') {
    const gvoc = readGigaVocab(path.join(job.languageDir, 'giga.vocab.txt'));
    const gs = await open(path.join(job.languageDir, 'giga.onnx'));
    const g1 = await gigaEmissions(ort, gs, vocal, (f) => progress('emissions', 0.6 + 0.2 * f), cancel);
    const g2 = await gigaEmissions(ort, gs, mix, (f) => progress('emissions', 0.8 + 0.2 * f), cancel);
    await gs.release?.();
    lp = ensemble([{ lp: xe, vocab: xv }, { lp: g1, vocab: gvoc }, { lp: g2, vocab: gvoc }], vocal).lp;
    spec = xv;
  }
  tick('emissions_s', t0);
  progress('emissions', 1, true);

  t0 = performance.now();
  progress('align', 0, true);
  const voiced = voicedMask(vocal, lp.T, -35, 2);
  maskSilence(lp, voiced, spec.blank);
  let result: AlignResult;
  try {
    result = alignLyrics({
      logp: lp, spec, lines: job.lines, vocal, feats: repeatFeatures(vocal), voiced, dur,
      anchors: job.anchors ? { lines: new Map(job.anchors.lines), words: new Map(job.anchors.words) } : undefined,
    });
  } catch (e: any) {
    throw new JobError('align', String(e?.message || e));
  }
  tick('align_s', t0);
  progress('align', 1, true);
  const lrc = toLrc(result, { title: job.meta?.title, artist: job.meta?.artist, tag: `SixteenCloud lyricsync ${job.lang}` });
  send({ type: 'result', result, lrc, timings: T, backend: job.backend });
}

function onMessage(raw: any): void {
  const m = raw && raw.data !== undefined && raw.type === undefined ? raw.data : raw;
  if (!m || m.type !== 'run') return;
  run(m.job as JobSpec).then(() => setTimeout(() => process.exit(0), 50)).catch((e: any) => {
    const code = e instanceof JobError ? e.code : (/memory|alloc/i.test(String(e?.message)) ? 'memory' : 'internal');
    send({ type: 'error', code, message: String(e?.message || e) });
    setTimeout(() => process.exit(1), 50);
  });
}

if (port) port.on('message', onMessage);
else process.on('message', onMessage);

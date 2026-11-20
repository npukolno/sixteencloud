// lyricsync in the app: pack installs, one sync job at a time in a separate process,
// saved syncs, and the IPC surface of the Sync tab. Every stage has a timeout or a
// watchdog and reports a readable error, so nothing can hang the UI.

import { app, dialog, net, utilityProcess, type BrowserWindow, type UtilityProcess } from 'electron';
import { execFile } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { ipcMain } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { detectLang, parseLyrics, suspiciousLines } from '../../shared/lyricsync/text';
import { logWarn } from '../logger';
import { resolveFfmpegPath } from '../ipc/downloader';
import { assertMainRenderer, safeSend } from '../ipc/guard';
import { setLocalLyricsProvider, updateLyricsPref } from '../ipc/lyrics';
import { eFetch, readFileHead, streamResponseToFile } from '../ipc/net';
import { resolveTrackStream } from '../ipc/soundcloud-api';
import { getStore } from '../ipc/store';
import { isHlsPlaylistBuffer } from '../ipc/validators';
import { Library, lyricsKey, type SyncEntry } from './library';
import { LANGUAGES, SEPARATOR, packSize, runtimePack, wasmPack, type Lang, type Pack } from './manifest';
import { dirSize, freeSpace, installPack, isInstalled, packDir, PackError, removePack, type FetchFn } from './models';
import type { JobSpec, Stage, WorkerMsg } from './worker';
import type { AlignResult } from '../../shared/lyricsync/pipeline';

const WATCHDOG_MS = 180_000;          // no word from the worker this long = stuck
const MAX_AUDIO_BYTES = 300 * 1024 * 1024;
const MAX_SECONDS = 15 * 60;

type PublicPack = 'engine' | Lang;

interface JobState {
  id: string;
  stage: 'fetch' | Stage;
  overall: number;
  startedAt: number;
  child: UtilityProcess | null;
  cancelled: boolean;
  title: string;
  artist: string;
}

export interface StartRequest {
  source: { kind: 'sc'; url: string; title: string; artist: string } | { kind: 'file'; path: string; title?: string; artist?: string };
  text: string;
  lang?: 'auto' | Lang;
  anchors?: Record<string, number>;
}

function threadsFor(): number {
  const n = os.cpus().length || 2;
  return Math.max(1, Math.min(8, n >= 8 ? Math.floor(n / 2) : n - 1));
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(resolveFfmpegPath(), args, { maxBuffer: 4 * 1024 * 1024, timeout: 5 * 60_000, windowsHide: true }, (err, _o, stderr) => {
      if (err) reject(new Error(`${err.message}: ${String(stderr || '').trim().split('\n').slice(-2).join(' | ')}`)); else resolve();
    });
  });
}

export function setupLyricsyncIPC(mainWindow: BrowserWindow): void {
  const base = path.join(app.getPath('userData'), 'lyricsync');
  const tmpDir = path.join(base, 'tmp');
  const lib = new Library(path.join(base, 'library'));
  const store = getStore() as any;
  const fetchFn: FetchFn = (url, init) => net.fetch(url, { headers: init?.headers, signal: init?.signal } as any) as unknown as Promise<Response>;

  // leftovers of a crash or a killed app
  try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch { /* in use */ }

  const emit = (payload: Record<string, unknown>) => safeSend(mainWindow, IPC_CHANNELS.LSYNC_EVENT, payload);

  function backend(): 'native' | 'wasm' {
    return store.get('lyricsync.backend') === 'wasm' || runtimePack().id === 'runtime-wasm' ? 'wasm' : 'native';
  }
  function runtime(): Pack { return backend() === 'wasm' ? wasmPack() : runtimePack(); }
  function packsFor(p: PublicPack): Pack[] { return p === 'engine' ? [runtime(), SEPARATOR] : [LANGUAGES[p]]; }

  // ---- packs --------------------------------------------------------------------
  let install: { packs: PublicPack[]; ctl: AbortController; done: number; total: number; speed: number } | null = null;

  function packStatus() {
    const list: PublicPack[] = ['engine', 'ru', 'en'];
    return list.map((id) => {
      const ps = packsFor(id);
      const installed = ps.every((p) => isInstalled(base, p));
      return {
        id, installed,
        size: ps.reduce((s, p) => s + packSize(p), 0),
        onDisk: ps.reduce((s, p) => s + dirSize(packDir(base, p)), 0),
        installing: !!install && install.packs.includes(id),
      };
    });
  }

  async function installSet(ids: PublicPack[]): Promise<void> {
    if (install) throw new Error('busy');
    const packs = ids.flatMap(packsFor).filter((p) => !isInstalled(base, p));
    const total = packs.reduce((s, p) => s + packSize(p), 0);
    const free = freeSpace(base);
    if (free !== null && free < total * 1.15 + 200e6) {
      throw Object.assign(new Error('not enough disk space'), { code: 'disk', need: total, free });
    }
    const ctl = new AbortController();
    install = { packs: ids, ctl, done: 0, total, speed: 0 };
    let before = 0;
    try {
      for (const p of packs) {
        await installPack(base, p, fetchFn, ctl.signal, (pr) => {
          if (!install) return;
          install.done = before + pr.done; install.speed = pr.speed;
          emit({ kind: 'install', done: install.done, total, speed: pr.speed, file: pr.file });
        });
        before += packSize(p);
      }
      emit({ kind: 'install-done', packs: packStatus() });
    } finally {
      install = null;
    }
  }

  // ---- library <-> lyrics panel ----------------------------------------------------
  const fmtDate = (iso: string) => { try { return new Date(iso).toLocaleDateString(); } catch { return ''; } };
  setLocalLyricsProvider((key) => lib.byKey(key).map((e) => ({
    id: e.id,
    label: `${e.artist} — ${e.title} · ${fmtDate(e.createdAt)}`,
    lyrics: e.lines.map((l) => l.text).join('\n'),
    syncedLyrics: e.lrc,
  })));

  // ---- jobs -----------------------------------------------------------------------
  let job: JobState | null = null;
  let last: { id: string; result: AlignResult; lrc: string; req: StartRequest; lang: Lang; duration: number } | null = null;

  async function fetchAudio(j: JobState, url: string): Promise<{ file: string }> {
    fs.mkdirSync(tmpDir, { recursive: true });
    const { audioUrl } = await resolveTrackStream(url);
    const raw = path.join(tmpDir, `${j.id}.src`);
    const resp = await eFetch(audioUrl);
    if (!resp.ok) throw Object.assign(new Error(`audio download failed: HTTP ${resp.status}`), { code: 'fetch' });
    await streamResponseToFile(resp, raw, MAX_AUDIO_BYTES);
    if (!isHlsPlaylistBuffer(readFileHead(raw, 16))) return { file: raw };
    // HLS: let ffmpeg fetch the segments once into one local file
    const out = path.join(tmpDir, `${j.id}.mka`);
    try {
      await runFfmpeg(['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls', '-i', raw, '-vn', '-c:a', 'copy', '-y', out]);
    } catch {
      const wav = path.join(tmpDir, `${j.id}.wav`);
      await runFfmpeg(['-v', 'error', '-nostdin', '-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls', '-i', raw, '-vn', '-ac', '2', '-ar', '44100', '-y', wav]);
      return { file: wav };
    }
    return { file: out };
  }

  function runWorker(j: JobState, spec: JobSpec): Promise<Extract<WorkerMsg, { type: 'result' }>> {
    return new Promise((resolve, reject) => {
      const child = utilityProcess.fork(path.join(__dirname, 'worker.js'), [], { serviceName: 'SixteenCloud lyricsync', stdio: 'pipe' });
      j.child = child;
      // The analysis keeps most cores busy for minutes; at normal priority it
      // competes with the player, the page and the compositor and the whole
      // app stutters. Low priority costs it almost nothing on an idle machine.
      child.once('spawn', () => {
        try { if (child.pid) os.setPriority(child.pid, os.constants.priority.PRIORITY_BELOW_NORMAL); } catch { /* not permitted: keep default */ }
      });
      let lastMsg = Date.now(), settled = false, stderr = '';
      child.stderr?.on('data', (c: Buffer) => { stderr = (stderr + c.toString()).slice(-1500); });
      const finish = (err: Error | null, res?: Extract<WorkerMsg, { type: 'result' }>) => {
        if (settled) return;
        settled = true;
        clearInterval(dog);
        try { child.kill(); } catch { /* already gone */ }
        j.child = null;
        if (err) reject(err); else resolve(res!);
      };
      const dog = setInterval(() => {
        if (Date.now() - lastMsg > WATCHDOG_MS) finish(Object.assign(new Error('the analysis stopped responding'), { code: 'stalled' }));
      }, 5000);
      child.on('message', (m: WorkerMsg) => {
        lastMsg = Date.now();
        if (m.type === 'progress') {
          j.stage = m.stage; j.overall = m.overall;
          emit({ kind: 'job', id: j.id, stage: m.stage, overall: m.overall, elapsed: (Date.now() - j.startedAt) / 1000 });
        } else if (m.type === 'result') finish(null, m);
        else if (m.type === 'error') finish(Object.assign(new Error(m.message), { code: m.code }));
      });
      child.on('exit', (code) => {
        if (j.cancelled) finish(Object.assign(new Error('cancelled'), { code: 'cancelled' }));
        else finish(Object.assign(new Error(`analysis process ended (${code})${stderr ? ': ' + stderr.trim().split('\n').slice(-1)[0] : ''}`),
          { code: /memory|alloc/i.test(stderr) ? 'memory' : 'crashed' }));
      });
      child.postMessage({ type: 'run', job: spec });
    });
  }

  async function start(req: StartRequest): Promise<{ id: string }> {
    if (job) throw Object.assign(new Error('another sync is running'), { code: 'busy' });
    const lines = parseLyrics(req.text || '');
    if (lines.length < 2) throw Object.assign(new Error('the text is empty'), { code: 'text' });
    if (lines.length > 400) throw Object.assign(new Error('the text is too long'), { code: 'text' });
    const lang: Lang = req.lang && req.lang !== 'auto' ? req.lang : (detectLang(lines) === 'en' ? 'en' : 'ru');
    const missing = (['engine', lang] as PublicPack[]).filter((p) => !packsFor(p).every((x) => isInstalled(base, x)));
    if (missing.length) throw Object.assign(new Error('models are not downloaded'), { code: 'packs', missing });

    const title = req.source.kind === 'sc' ? req.source.title : (req.source.title || path.basename(req.source.path).replace(/\.[^.]+$/, ''));
    const artist = req.source.kind === 'sc' ? req.source.artist : (req.source.artist || '');
    const j: JobState = { id: crypto.randomBytes(6).toString('hex'), stage: 'fetch', overall: 0, startedAt: Date.now(), child: null, cancelled: false, title, artist };
    job = j;
    last = null;
    emit({ kind: 'job', id: j.id, stage: 'fetch', overall: 0, elapsed: 0 });
    (async () => {
      let tmpFiles: string[] = [];
      try {
        let audio: string;
        if (req.source.kind === 'sc') {
          const a = await fetchAudio(j, req.source.url);
          audio = a.file;
          tmpFiles = fs.readdirSync(tmpDir).filter((n) => n.startsWith(j.id)).map((n) => path.join(tmpDir, n));
        } else {
          if (!fs.existsSync(req.source.path)) throw Object.assign(new Error('file not found'), { code: 'fetch' });
          audio = req.source.path;
        }
        if (j.cancelled) throw Object.assign(new Error('cancelled'), { code: 'cancelled' });
        const anchors = { lines: [] as Array<[number, number]>, words: [] as Array<[string, number]> };
        for (const [k, v] of Object.entries(req.anchors || {})) {
          if (typeof v !== 'number' || !Number.isFinite(v)) continue;
          const [li, wi] = k.split(':').map(Number);
          if (!Number.isInteger(li) || li < 1) continue;
          if (wi && wi > 1) anchors.words.push([`${li - 1}:${wi - 1}`, v]); else anchors.lines.push([li - 1, v]);
        }
        const mk = (b: 'native' | 'wasm'): JobSpec => ({
          audio, lines, lang, anchors, runtimeDir: packDir(base, b === 'wasm' ? wasmPack() : runtimePack()), backend: b,
          separatorDir: packDir(base, SEPARATOR), languageDir: packDir(base, LANGUAGES[lang]), ffmpeg: resolveFfmpegPath(),
          threads: threadsFor(), maxSeconds: MAX_SECONDS, meta: { title, artist },
        });
        let res: Extract<WorkerMsg, { type: 'result' }>;
        try {
          res = await runWorker(j, mk(backend()));
        } catch (e: any) {
          if (e?.code !== 'runtime' || backend() === 'wasm' || j.cancelled) throw e;
          // the native engine does not load on this machine: switch to WebAssembly for good
          logWarn('[lyricsync] native runtime failed, switching to wasm:', e?.message);
          emit({ kind: 'job', id: j.id, stage: 'runtime', overall: 0.02, elapsed: (Date.now() - j.startedAt) / 1000, note: 'wasm' });
          if (!isInstalled(base, wasmPack())) await installPack(base, wasmPack(), fetchFn, new AbortController().signal, () => {});
          store.set('lyricsync.backend', 'wasm');
          res = await runWorker(j, mk('wasm'));
        }
        last = { id: j.id, result: res.result, lrc: res.lrc, req, lang, duration: res.result.meta.duration };
        emit({ kind: 'job-done', id: j.id, result: summarize(res.result), lrc: res.lrc, lang, timings: res.timings, backend: res.backend, title, artist });
      } catch (e: any) {
        emit({ kind: 'job-error', id: j.id, code: e?.code || 'internal', message: String(e?.message || e) });
        if (e?.code !== 'cancelled') logWarn('[lyricsync] job failed:', e?.code, e?.message);
      } finally {
        for (const f of tmpFiles) { try { fs.rmSync(f, { force: true }); } catch { /* ignore */ } }
        if (job === j) job = null;
      }
    })();
    return { id: j.id };
  }

  function summarize(r: AlignResult) {
    return {
      lines: r.lines.map((l) => ({ i: l.i, text: l.text, start: l.start, end: l.end, match: l.match, guessed: l.conf === -9, words: l.words.map((w) => [w.start, w.w]) })),
      gaps: r.gaps,
      recognition: r.meta.recognition,
      missing: r.meta.missing_lines || [],
      repeats: Object.keys(r.meta.repeat_anchors).map(Number),
      duration: r.meta.duration,
    };
  }

  // ---- IPC ------------------------------------------------------------------------
  const H = (ch: string, fn: (...a: any[]) => unknown) => ipcMain.handle(ch, async (event, ...a) => {
    assertMainRenderer(event, mainWindow);
    return fn(...a);
  });

  H(IPC_CHANNELS.LSYNC_STATUS, () => ({
    packs: packStatus(),
    install: install ? { packs: install.packs, done: install.done, total: install.total, speed: install.speed } : null,
    job: job ? { id: job.id, stage: job.stage, overall: job.overall, elapsed: (Date.now() - job.startedAt) / 1000, title: job.title, artist: job.artist } : null,
    last: last ? { id: last.id } : null,
    disk: { used: dirSize(base), free: freeSpace(base), dir: base },
    hw: { cores: os.cpus().length, threads: threadsFor(), ramGb: Math.round(os.totalmem() / 1e9 * 10) / 10, freeRamGb: Math.round(os.freemem() / 1e9 * 10) / 10, backend: backend(), platform: `${process.platform}/${process.arch}` },
  }));
  H(IPC_CHANNELS.LSYNC_INSTALL, async (ids: unknown) => {
    const list = (Array.isArray(ids) ? ids : []).filter((x): x is PublicPack => x === 'engine' || x === 'ru' || x === 'en');
    if (!list.length) throw new Error('nothing to install');
    installSet(list).catch((e: any) => {
      const code = e instanceof PackError ? e.code : (e?.code || 'network');
      emit({ kind: 'install-error', code, message: String(e?.message || e), need: e?.need, free: e?.free, packs: packStatus() });
    });
    return true;
  });
  H(IPC_CHANNELS.LSYNC_CANCEL_INSTALL, () => { install?.ctl.abort(); return true; });
  H(IPC_CHANNELS.LSYNC_REMOVE, (id: unknown) => {
    if (id !== 'engine' && id !== 'ru' && id !== 'en') throw new Error('unknown pack');
    if (job || install) throw new Error('busy');
    for (const p of packsFor(id)) removePack(base, p);
    if (id === 'engine') { removePack(base, wasmPack()); removePack(base, runtimePack()); }
    return packStatus();
  });
  H(IPC_CHANNELS.LSYNC_START, (req: unknown) => {
    const r = req as StartRequest;
    if (!r || typeof r.text !== 'string' || r.text.length > 100_000 || !r.source) throw new Error('bad request');
    if (r.source.kind === 'sc' && (typeof r.source.url !== 'string' || !/^https:\/\/(m\.)?soundcloud\.com\//.test(r.source.url))) throw new Error('bad track url');
    if (r.source.kind === 'file' && typeof r.source.path !== 'string') throw new Error('bad file');
    return start(r).catch((e: any) => ({ error: { code: e?.code || 'internal', message: String(e?.message || e), missing: e?.missing } }));
  });
  H(IPC_CHANNELS.LSYNC_CANCEL, () => {
    if (!job) return false;
    job.cancelled = true;
    try { job.child?.kill(); } catch { /* gone */ }
    return true;
  });
  H(IPC_CHANNELS.LSYNC_CHECK_TEXT, (text: unknown) => {
    if (typeof text !== 'string' || text.length > 100_000) throw new Error('bad text');
    const lines = parseLyrics(text);
    return { lines: lines.length, lang: lines.length ? detectLang(lines) : null, suspicious: suspiciousLines(text).slice(0, 5) };
  });
  H(IPC_CHANNELS.LSYNC_SAVE, (opts: unknown) => {
    const o = (opts || {}) as { id?: string; title?: string; artist?: string; url?: string; key?: string; apply?: boolean };
    if (!last || last.id !== o.id) throw new Error('nothing to save');
    const title = String(o.title || '').slice(0, 300), artist = String(o.artist || '').slice(0, 300);
    const key = typeof o.key === 'string' && o.key ? o.key.slice(0, 600) : lyricsKey(artist, title);
    const r = last.result;
    const entry: Omit<SyncEntry, 'id' | 'createdAt'> = {
      key, title, artist, url: typeof o.url === 'string' ? o.url.slice(0, 500) : undefined, lang: last.lang, duration: last.duration,
      lrc: last.lrc, text: last.req.text.slice(0, 100_000),
      lines: r.lines.map((l) => ({ t: l.start, end: l.end, text: l.text, match: l.match, guessed: l.conf === -9, words: l.words.map((w) => [w.start, w.w] as [number, string]) })),
      recognition: r.meta.recognition, anchors: last.req.anchors,
    };
    const saved = lib.save(entry);
    if (o.apply !== false) {
      try { updateLyricsPref('setChoice', key, { lyrics: entry.lines.map((l) => l.text).join('\n'), syncedLyrics: entry.lrc, source: 'sixteen' }); } catch (e: any) { logWarn('[lyricsync] set choice failed:', e?.message); }
    }
    emit({ kind: 'saved', id: saved.id, key });
    return { id: saved.id, key };
  });
  H(IPC_CHANNELS.LSYNC_LIBRARY, () => lib.list());
  H(IPC_CHANNELS.LSYNC_GET, (id: unknown) => (typeof id === 'string' ? lib.get(id) : null));
  H(IPC_CHANNELS.LSYNC_DELETE, (id: unknown) => {
    if (typeof id !== 'string') throw new Error('bad id');
    const e = lib.get(id);
    lib.remove(id);
    // a deleted sync must not stay chosen in the Lyrics panel
    if (e) {
      try {
        const pref = updateLyricsPref('get', e.key) as { choice?: { source?: string; syncedLyrics?: string } } | null;
        if (pref?.choice?.source === 'sixteen' && pref.choice.syncedLyrics === e.lrc) updateLyricsPref('setChoice', e.key, null);
      } catch { /* ignore */ }
    }
    return lib.list();
  });
  H(IPC_CHANNELS.LSYNC_PICK_FILE, async () => {
    const r = await dialog.showOpenDialog(mainWindow, {
      properties: ['openFile'],
      filters: [{ name: 'Audio', extensions: ['mp3', 'm4a', 'aac', 'ogg', 'opus', 'flac', 'wav', 'webm', 'mka'] }],
    });
    if (r.canceled || !r.filePaths[0]) return null;
    return { path: r.filePaths[0], name: path.basename(r.filePaths[0]) };
  });

  app.on('before-quit', () => {
    install?.ctl.abort();
    try { job?.child?.kill(); } catch { /* gone */ }
  });
}

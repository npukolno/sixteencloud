// Download manager for lyricsync packs: resumable downloads (HTTP Range), hash checks,
// npm tarball extraction, cancel, stall detection with retries, removal, disk usage.
// Electron-free (fetch is injected) so it can be tested with plain Node.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import type { Pack, PackFile } from './manifest';

export type FetchFn = (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) => Promise<Response>;

export interface DownloadProgress { pack: string; done: number; total: number; file: string; speed: number }

const MARKER = '.complete.json';
const STALL_MS = 30_000;
const RETRIES = 5;

export class PackError extends Error {
  constructor(public code: 'network' | 'disk' | 'hash' | 'cancelled' | 'extract' | 'http', message: string) { super(message); }
}

export function packDir(base: string, pack: Pack): string {
  return path.join(base, 'packs', pack.id);
}

function fingerprint(pack: Pack): string {
  return crypto.createHash('sha256').update(JSON.stringify(pack.files.map((f) => [f.path, f.url, f.sha256 || f.integrity]))).digest('hex').slice(0, 16);
}

export function isInstalled(base: string, pack: Pack): boolean {
  try {
    const m = JSON.parse(fs.readFileSync(path.join(packDir(base, pack), MARKER), 'utf8'));
    return m.fingerprint === fingerprint(pack);
  } catch { return false; }
}

export function dirSize(dir: string): number {
  let total = 0;
  const walk = (d: string) => {
    let ents: fs.Dirent[] = [];
    try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else { try { total += fs.statSync(p).size; } catch { /* vanished */ } }
    }
  };
  walk(dir);
  return total;
}

export function freeSpace(dir: string): number | null {
  try {
    fs.mkdirSync(dir, { recursive: true });
    const s = fs.statfsSync(dir);
    return Number(s.bavail) * Number(s.bsize);
  } catch { return null; }
}

export function removePack(base: string, pack: Pack): void {
  fs.rmSync(packDir(base, pack), { recursive: true, force: true });
}

async function hashFile(file: string, algo: 'sha256' | 'sha512', enc: 'hex' | 'base64'): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash(algo);
    fs.createReadStream(file).on('data', (c) => h.update(c)).on('error', reject).on('end', () => resolve(h.digest(enc)));
  });
}

async function verify(file: string, f: PackFile): Promise<boolean> {
  if (f.sha256) return (await hashFile(file, 'sha256', 'hex')) === f.sha256;
  if (f.integrity) return `sha512-${await hashFile(file, 'sha512', 'base64')}` === f.integrity;
  return true;
}

/** Minimal streaming tar reader over a .tgz: writes entries accepted by include() under destDir. */
export async function extractTgz(file: string, f: NonNullable<PackFile['extract']>, destDir: string): Promise<number> {
  const into = path.join(destDir, f.into);
  const data = zlib.gunzipSync(fs.readFileSync(file));
  let off = 0, count = 0, longName: string | null = null, paxPath: string | null = null;
  const str = (b: Buffer) => b.toString('utf8').replace(/\0.*$/s, '');
  while (off + 512 <= data.length) {
    const h = data.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const size = parseInt(str(h.subarray(124, 136)).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(h.subarray(345, 500));
    let name = longName ?? paxPath ?? ((prefix ? prefix + '/' : '') + str(h.subarray(0, 100)));
    const body = data.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'L') { longName = str(body); continue; }
    if (type === 'x') { const m = /\d+ path=([^\n]*)\n/.exec(body.toString('utf8')); paxPath = m ? m[1] : null; continue; }
    if (type === 'g') continue;
    longName = null; paxPath = null;
    if (type !== '0' && type !== '\0' && type !== '7') continue;
    if (!name.startsWith(f.strip)) continue;
    name = name.slice(f.strip.length);
    if (!f.include(name)) continue;
    const out = path.resolve(into, name);
    if (!out.startsWith(path.resolve(into) + path.sep)) throw new PackError('extract', `unsafe path in archive: ${name}`);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, body);
    count++;
  }
  if (!count) throw new PackError('extract', `nothing extracted from ${path.basename(file)}`);
  return count;
}

async function downloadOne(fetchFn: FetchFn, f: PackFile, dest: string, signal: AbortSignal,
  onBytes: (absBytesOfThisFile: number) => void): Promise<void> {
  const part = dest + '.part';
  for (let attempt = 0; ; attempt++) {
    if (signal.aborted) throw new PackError('cancelled', 'cancelled');
    let have = 0;
    try { have = fs.statSync(part).size; } catch { /* fresh */ }
    if (f.size && have > f.size) { fs.rmSync(part, { force: true }); have = 0; }
    const ctl = new AbortController();
    const onAbort = () => ctl.abort();
    signal.addEventListener('abort', onAbort);
    let stallTimer: NodeJS.Timeout | null = null;
    const arm = () => { if (stallTimer) clearTimeout(stallTimer); stallTimer = setTimeout(() => ctl.abort(), STALL_MS); };
    try {
      if (f.size && have === f.size) return;
      arm();
      const resp = await fetchFn(f.url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctl.signal });
      if (resp.status === 416) { fs.rmSync(part, { force: true }); throw new Error('range not satisfiable'); }
      if (!resp.ok) throw new PackError('http', `HTTP ${resp.status} for ${f.url}`);
      if (have && resp.status !== 206) { have = 0; }                  // server ignored Range: start over
      let cur = have;
      onBytes(cur);
      const fd = fs.openSync(part, have ? 'a' : 'w');
      try {
        const reader = resp.body!.getReader();
        for (;;) {
          arm();
          const { done, value } = await reader.read();
          if (done) break;
          try { fs.writeSync(fd, value); } catch (e: any) { throw new PackError('disk', e?.code === 'ENOSPC' ? 'disk full' : String(e?.message || e)); }
          cur += value.length;
          onBytes(cur);
        }
      } finally { fs.closeSync(fd); }
      const got = fs.statSync(part).size;
      if (f.size && got !== f.size) throw new Error(`incomplete: ${got} of ${f.size} bytes`);
      if (!(await verify(part, f))) { fs.rmSync(part, { force: true }); throw new PackError('hash', `checksum mismatch: ${path.basename(dest)}`); }
      fs.renameSync(part, dest);
      return;
    } catch (e: any) {
      if (signal.aborted) throw new PackError('cancelled', 'cancelled');
      if (e instanceof PackError && (e.code === 'disk' || (e.code === 'hash' && attempt >= 1) || (e.code === 'http' && /HTTP 4\d\d/.test(e.message) && !/HTTP 429/.test(e.message)))) throw e;
      if (attempt >= RETRIES) throw e instanceof PackError ? e : new PackError('network', String(e?.message || e));
      await new Promise((r) => setTimeout(r, Math.min(15_000, 1000 * 2 ** attempt)));
    } finally {
      if (stallTimer) clearTimeout(stallTimer);
      signal.removeEventListener('abort', onAbort);
    }
  }
}

/** Download, verify and unpack a pack. Re-entrant: finished files are kept, partial ones resumed. */
export async function installPack(base: string, pack: Pack, fetchFn: FetchFn, signal: AbortSignal,
  onProgress: (p: DownloadProgress) => void): Promise<void> {
  const dir = packDir(base, pack);
  fs.mkdirSync(dir, { recursive: true });
  const total = pack.files.reduce((s, f) => s + (f.size || 0), 0);
  let done = 0, lastT = Date.now(), lastDone = 0, speed = 0;
  for (const f of pack.files) {
    const dest = path.join(dir, f.path);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const fileStart = done;
    if (fs.existsSync(dest) && !f.extract) { done += f.size; onProgress({ pack: pack.id, done, total, file: f.path, speed: 0 }); continue; }
    await downloadOne(fetchFn, f, dest, signal, (abs) => {
      done = fileStart + abs;
      const now = Date.now();
      if (now - lastT >= 500) { speed = ((done - lastDone) * 1000) / (now - lastT); lastT = now; lastDone = done; }
      onProgress({ pack: pack.id, done: Math.min(done, total), total, file: f.path, speed });
    });
    if (f.extract) {
      try { await extractTgz(dest, f.extract, dir); } finally { fs.rmSync(dest, { force: true }); }
    }
    done = fileStart + f.size;
  }
  fs.writeFileSync(path.join(dir, MARKER), JSON.stringify({ fingerprint: fingerprint(pack), at: new Date().toISOString() }));
}

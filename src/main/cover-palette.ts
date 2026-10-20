import { app, net } from 'electron';
import { execFile } from 'child_process';
import { createHash } from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { logWarn } from './logger';

export interface CoverPalette {
  primary: string;
  secondary: string;
  tertiary: string;
  accent: string;
  source?: 'accent' | 'matugen';
}

const MEMORY_LIMIT = 240;
const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const MATUGEN_TIMEOUT_MS = 4500;
const DOWNLOAD_TIMEOUT_MS = 8000;

const memory = new Map<string, CoverPalette>();
const pending = new Map<string, Promise<CoverPalette | null>>();
let diskLoaded = false;
let persistTimer: NodeJS.Timeout | null = null;
let imageCachePruned = false;
const COVER_IMAGE_LIMIT = 240;

function cacheFile(): string {
  // v3: accent palettes are now used verbatim (like the desktop cava) instead
  // of being saturation-forced, which turned near-neutral covers into colors.
  return path.join(app.getPath('userData'), 'cover-palettes-v3.json');
}

function imageDir(): string {
  return path.join(app.getPath('userData'), 'cover-cache');
}

function isAllowedCoverUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    return host === 'soundcloud.com' || host.endsWith('.soundcloud.com') || host === 'sndcdn.com' || host.endsWith('.sndcdn.com');
  } catch {
    return false;
  }
}

function normalizeHex(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(/^#?([0-9a-f]{6})$/i);
  return match ? `#${match[1].toLowerCase()}` : null;
}

function loadDisk(): void {
  if (diskLoaded) return;
  diskLoaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(cacheFile(), 'utf8')) as Record<string, CoverPalette>;
    for (const [url, palette] of Object.entries(raw)) {
      if (palette && normalizeHex(palette.primary) && normalizeHex(palette.secondary)) {
        memory.set(url, palette);
      }
    }
  } catch {
    // First run or an older cache shape: start empty.
  }
}

function persist(): void {
  if (persistTimer) clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    persistTimer = null;
    try {
      const entries = Array.from(memory.entries()).slice(-MEMORY_LIMIT);
      fs.mkdirSync(path.dirname(cacheFile()), { recursive: true });
      fs.writeFileSync(cacheFile(), JSON.stringify(Object.fromEntries(entries)), 'utf8');
    } catch (e: any) {
      logWarn('[cover-palette] cache write failed:', e?.message);
    }
  }, 1500);
  persistTimer.unref?.();
}

function matugenConfig(): string {
  // The user runs matugen on their desktop rice; its config rewrites their
  // theme files. We only read colors, so run with an isolated empty config.
  const file = path.join(os.tmpdir(), 'sixteencloud-matugen.toml');
  const contents = '[config]\nversion_check = false\n\n[templates]\n';
  try {
    const current = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
    if (current !== contents) fs.writeFileSync(file, contents, 'utf8');
  } catch {
    // Falls through: matugen will report the error and we return null.
  }
  return file;
}

function pruneCoverImages(): void {
  if (imageCachePruned) return;
  imageCachePruned = true;
  try {
    const dir = imageDir();
    const entries = fs.readdirSync(dir)
      .filter((name) => name.endsWith('.img'))
      .map((name) => {
        const filePath = path.join(dir, name);
        try {
          return { filePath, mtime: fs.statSync(filePath).mtimeMs };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { filePath: string; mtime: number } => entry !== null)
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(COVER_IMAGE_LIMIT)) {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
    }
  } catch {
    // Best-effort cache maintenance.
  }
}

function downloadCover(url: string): Promise<string | null> {
  pruneCoverImages();
  return new Promise((resolve) => {
    const digest = createHash('sha1').update(url).digest('hex');
    const target = path.join(imageDir(), `${digest}.img`);
    try {
      if (fs.existsSync(target) && fs.statSync(target).size > 0) {
        resolve(target);
        return;
      }
    } catch {
      // Missing or unreadable cache entry: download again.
    }

    let settled = false;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    let request: Electron.ClientRequest;
    try {
      request = net.request({ method: 'GET', url, redirect: 'follow' });
    } catch {
      finish(null);
      return;
    }

    const timeout = setTimeout(() => {
      try { request.abort(); } catch {}
      finish(null);
    }, DOWNLOAD_TIMEOUT_MS);
    timeout.unref?.();

    request.on('response', (response) => {
      if (response.statusCode < 200 || response.statusCode >= 300) {
        clearTimeout(timeout);
        finish(null);
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      response.on('data', (chunk: Buffer) => {
        total += chunk.length;
        if (total > MAX_IMAGE_BYTES) {
          clearTimeout(timeout);
          try { request.abort(); } catch {}
          finish(null);
          return;
        }
        chunks.push(chunk);
      });
      response.on('end', () => {
        clearTimeout(timeout);
        if (total === 0) {
          finish(null);
          return;
        }
        try {
          fs.mkdirSync(path.dirname(target), { recursive: true });
          fs.writeFileSync(target, Buffer.concat(chunks));
          finish(target);
        } catch {
          finish(null);
        }
      });
      response.on('error', () => {
        clearTimeout(timeout);
        finish(null);
      });
    });
    request.on('error', () => {
      clearTimeout(timeout);
      finish(null);
    });
    request.end();
  });
}

function hexToRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  const to = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h /= 6;
  }
  return [h, s, l];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hue = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  if (s === 0) return [l * 255, l * 255, l * 255];
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
}

function mixHex(a: string, b: string, t: number): string {
  const ca = hexToRgb(a);
  const cb = hexToRgb(b);
  return rgbToHex(ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t);
}

// Use the extracted accent as-is, the way the desktop bar does: top stop is
// the accent itself, bottom is a darker mix of the same hue. Near-neutral
// covers stay neutral; a 1-bit channel difference must not become a hue.
function buildAccentPalette(accentHex: string): CoverPalette {
  const [h, s, l] = rgbToHsl(...hexToRgb(accentHex));
  const neutral = s < 0.12;
  const primary = neutral
    ? rgbToHex(...hslToRgb(h, s, Math.max(0.35, Math.min(0.85, l))))
    : accentHex;
  return {
    primary,
    secondary: mixHex(primary, '#ffffff', neutral ? 0.1 : 0.14),
    tertiary: mixHex(primary, '#000000', neutral ? 0.38 : 0.45),
    accent: primary,
    source: 'accent',
  };
}

function runCoverAccent(file: string): Promise<string | null> {
  const script = path.join(os.homedir(), '.config/quickshell/ii/scripts/cover-accent.py');
  return new Promise((resolve) => {
    if (!fs.existsSync(script)) {
      resolve(null);
      return;
    }
    execFile('python3', [script, file], { timeout: 2500, maxBuffer: 64 * 1024 }, (error, stdout) => {
      if (error || !stdout) {
        resolve(null);
        return;
      }
      resolve(normalizeHex(stdout.trim()));
    });
  });
}

function runMatugen(file: string): Promise<CoverPalette | null> {
  return new Promise((resolve) => {
    execFile(
      'matugen',
      ['image', file, '--prefer', 'darkness', '-j', 'hex', '--dry-run', '-c', matugenConfig()],
      { timeout: MATUGEN_TIMEOUT_MS, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, NO_COLOR: '1' } },
      (error, stdout) => {
        if (error || !stdout) {
          resolve(null);
          return;
        }
        try {
          const parsed = JSON.parse(stdout) as { colors?: Record<string, { default?: { color?: string } }> };
          const pick = (name: string): string | null => normalizeHex(parsed.colors?.[name]?.default?.color);
          const primary = pick('primary');
          if (!primary) {
            resolve(null);
            return;
          }
          const secondary = pick('secondary') || primary;
          const tertiary = pick('tertiary') || secondary;
          const accent = pick('primary_container') || primary;
          resolve({ primary, secondary, tertiary, accent, source: 'matugen' });
        } catch {
          resolve(null);
        }
      },
    );
  });
}

export async function getCoverPalette(url: unknown): Promise<CoverPalette | null> {
  if (typeof url !== 'string' || !isAllowedCoverUrl(url)) return null;
  loadDisk();
  const cached = memory.get(url);
  if (cached) return cached;
  const inFlight = pending.get(url);
  if (inFlight) return inFlight;

  const job = (async () => {
    const file = await downloadCover(url);
    if (!file) return null;
    const accent = await runCoverAccent(file);
    const palette = accent ? buildAccentPalette(accent) : await runMatugen(file);
    if (!palette) return null;
    memory.set(url, palette);
    if (memory.size > MEMORY_LIMIT) {
      const oldest = memory.keys().next().value;
      if (oldest) memory.delete(oldest);
    }
    persist();
    return palette;
  })();

  pending.set(url, job);
  try {
    return await job;
  } finally {
    pending.delete(url);
  }
}

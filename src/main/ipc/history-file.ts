// Listening history lives in its own file instead of config.json. The config is
// encrypted and rewritten whole on every store.set, and the history (play list
// plus lifetime counters) was 70% of it, so each played track re-encrypted
// ~180 KB on the main thread. Here the data is kept in memory, written plainly
// and atomically a moment after the last change, and flushed on quit.
// No electron imports: the test suite loads this under plain node.
import fs from 'fs';
import path from 'path';
import { emptyHistoryStats } from '../../shared/constants';

export interface HistoryData {
  tracks: unknown[];
  stats: Record<string, unknown>;
}

const FILE = 'history.json';
const WRITE_DELAY_MS = 1500;
export const MAX_HISTORY_TRACKS = 10000;

export class HistoryFile {
  private data: HistoryData | null = null;
  private timer: NodeJS.Timeout | null = null;
  private readonly file: string;

  constructor(dir: string, private readonly warn: (msg: string) => void = () => {}) {
    this.file = path.join(dir, FILE);
  }

  private load(): HistoryData {
    if (this.data) return this.data;
    let parsed: Partial<HistoryData> | null = null;
    try {
      parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch (e: any) {
      if (e?.code !== 'ENOENT') {
        // Unreadable: keep it for inspection, never overwrite what we cannot read.
        this.warn(`history file unreadable, starting empty: ${e?.message}`);
        try { fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`); } catch { /* nothing to keep */ }
      }
    }
    this.data = {
      tracks: Array.isArray(parsed?.tracks) ? parsed!.tracks! : [],
      stats: parsed?.stats && typeof parsed.stats === 'object' && !Array.isArray(parsed.stats)
        ? parsed.stats as Record<string, unknown>
        : emptyHistoryStats() as unknown as Record<string, unknown>,
    };
    return this.data;
  }

  exists(): boolean {
    return fs.existsSync(this.file);
  }

  getTracks(): unknown[] { return this.load().tracks; }
  getStats(): Record<string, unknown> { return this.load().stats; }

  setTracks(tracks: unknown[]): void {
    this.load().tracks = tracks;
    this.schedule();
  }

  setStats(stats: Record<string, unknown>): void {
    this.load().stats = stats;
    this.schedule();
  }

  /** Write now (quit, migration). Atomic: a crash mid-write keeps the old file. */
  flush(): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (!this.data) return;
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), { encoding: 'utf8', mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e: any) {
      this.warn(`could not save history: ${e?.message}`);
    }
  }

  private schedule(): void {
    if (this.timer) return;
    this.timer = setTimeout(() => { this.timer = null; this.flush(); }, WRITE_DELAY_MS);
    this.timer.unref?.();
  }
}

/**
 * Move history out of the old config. The new file is written and read back
 * before the config copies are cleared, so a failure leaves the data in place.
 */
export function migrateHistory(
  file: HistoryFile,
  legacy: { tracks: unknown; stats: unknown },
  clearLegacy: () => void,
): boolean {
  if (file.exists()) return false;
  const tracks = Array.isArray(legacy.tracks) ? legacy.tracks : [];
  const stats = legacy.stats && typeof legacy.stats === 'object' && !Array.isArray(legacy.stats)
    ? legacy.stats as Record<string, unknown>
    : null;
  if (!tracks.length && !(stats && (stats as { dataVersion?: unknown }).dataVersion === 1)) return false;
  file.setTracks(tracks);
  if (stats) file.setStats(stats);
  file.flush();
  if (!file.exists()) return false;
  clearLegacy();
  return true;
}

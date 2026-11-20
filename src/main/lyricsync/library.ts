// Saved synchronisations ("my lyrics"): one small JSON per track and language under
// <userData>/lyricsync/library. Looked up by the same key the Lyrics panel uses
// (artist|title, lower-case), so a saved sync shows up there as a version.

import crypto from 'crypto';
import fs from 'fs';
import path from 'path';

export interface SyncLine { t: number; end: number; text: string; match: number; guessed: boolean; words: Array<[number, string]> }
export interface SyncEntry {
  id: string;
  key: string;                 // artist|title, lower-case
  title: string;
  artist: string;
  url?: string;                // SoundCloud page, when made from a track
  lang: string;
  duration: number;
  createdAt: string;
  lrc: string;
  text: string;                // the lyrics text it was made from
  lines: SyncLine[];
  recognition: { score: number; heard_pct: number; level: string };
  anchors?: Record<string, number>;
}
export type SyncSummary = Omit<SyncEntry, 'lrc' | 'text' | 'lines'> & { lineCount: number; size: number };

export const LIBRARY_CAP = 500;
const MAX_FILE = 2 * 1024 * 1024;

export function lyricsKey(artist: string, title: string): string {
  return `${artist}|${title}`.toLowerCase();
}

export class Library {
  constructor(private dir: string) {}

  private file(id: string): string {
    if (!/^[a-f0-9]{16}$/.test(id)) throw new Error('bad sync id');
    return path.join(this.dir, `${id}.json`);
  }

  static idFor(key: string, lang: string): string {
    return crypto.createHash('sha256').update(`${key}\n${lang}`).digest('hex').slice(0, 16);
  }

  save(e: Omit<SyncEntry, 'id' | 'createdAt'>): SyncEntry {
    fs.mkdirSync(this.dir, { recursive: true });
    const entry: SyncEntry = { ...e, id: Library.idFor(e.key, e.lang), createdAt: new Date().toISOString() };
    const body = JSON.stringify(entry);
    if (body.length > MAX_FILE) throw new Error('sync too large');
    const tmp = this.file(entry.id) + '.tmp';
    fs.writeFileSync(tmp, body);
    fs.renameSync(tmp, this.file(entry.id));
    this.trim();
    return entry;
  }

  get(id: string): SyncEntry | null {
    try { return JSON.parse(fs.readFileSync(this.file(id), 'utf8')) as SyncEntry; } catch { return null; }
  }

  remove(id: string): void {
    fs.rmSync(this.file(id), { force: true });
  }

  /** Newest first. Unreadable files are skipped, never fatal. */
  list(): SyncSummary[] {
    let names: string[] = [];
    try { names = fs.readdirSync(this.dir).filter((n) => /^[a-f0-9]{16}\.json$/.test(n)); } catch { return []; }
    const out: SyncSummary[] = [];
    for (const n of names) {
      try {
        const p = path.join(this.dir, n);
        const size = fs.statSync(p).size;
        const e = JSON.parse(fs.readFileSync(p, 'utf8')) as SyncEntry;
        const { lrc: _l, text: _t, lines, ...rest } = e;
        out.push({ ...rest, lineCount: lines?.length || 0, size });
      } catch { /* skip broken entry */ }
    }
    return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  byKey(key: string): SyncEntry[] {
    return this.list().filter((s) => s.key === key).map((s) => this.get(s.id)).filter((e): e is SyncEntry => !!e);
  }

  totalSize(): number {
    return this.list().reduce((s, e) => s + e.size, 0);
  }

  private trim(): void {
    const all = this.list();
    for (const e of all.slice(LIBRARY_CAP)) this.remove(e.id);
  }
}

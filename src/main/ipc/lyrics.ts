import { ipcMain, type BrowserWindow } from 'electron';
import { CHROME_UA, IPC_CHANNELS } from '../../shared/constants';
import { cleanLyricsArtist, cleanLyricsTitle, matchScore, parseSoundCloudTrack, type LyricsQuery } from '../../shared/lyrics-match';
import { logWarn } from '../logger';
import { assertMainRenderer } from './guard';
import { fetchWithTimeout } from './net';
import { getStore } from './store';
import {
  extractAZLyrics, extractChartLyrics, extractGeniusLyrics, lrcToPlain, pickLrclib, type LrclibEntry,
} from './lyrics-parse';

// Optional provider key; never ship credentials in the client bundle.
const MUSIXMATCH_API_KEY = process.env.SIXTEENCLOUD_MUSIXMATCH_API_KEY || '';


// --- Per-track lyrics memory (choice + offset), shared with lyricsync -------------
const LYRICS_PREF_CAP = 200;

export function updateLyricsPref(action: string, key: string, value?: unknown): unknown {
  if (typeof key !== 'string' || !key || key.length > 600) throw new Error('Invalid lyrics key');
  const store = getStore();
  const prefs = ((store as any).get('lyricsPrefs') || {}) as Record<string, { choice?: any; offset?: number }>;
  if (action === 'get') return prefs[key] || null;
  const entry = prefs[key] || {};
  if (action === 'setOffset') {
    if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 60000) throw new Error('Invalid offset');
    if (value === 0) delete entry.offset; else entry.offset = Math.round(value);
  } else if (action === 'setChoice') {
    if (value === null) delete entry.choice;
    else {
      const v = value as { lyrics?: unknown; syncedLyrics?: unknown; source?: unknown };
      if (!v || typeof v.lyrics !== 'string' || v.lyrics.length > 200000 ||
          (v.syncedLyrics !== undefined && (typeof v.syncedLyrics !== 'string' || v.syncedLyrics.length > 300000))) throw new Error('Invalid lyrics choice');
      entry.choice = { lyrics: v.lyrics, syncedLyrics: v.syncedLyrics, source: typeof v.source === 'string' ? v.source.slice(0, 30) : 'manual' };
    }
  } else {
    throw new Error('Unknown lyrics pref action');
  }
  delete prefs[key];
  if (entry.choice || entry.offset) prefs[key] = entry;
  const keys = Object.keys(prefs);
  for (let i = 0; i < keys.length - LYRICS_PREF_CAP; i++) delete prefs[keys[i]];
  (store as any).set('lyricsPrefs', prefs);
  return prefs[key] || null;
}

/** Synced lyrics made on this computer (lyricsync), offered first among "other versions". */
export interface LocalLyricsVersion { id: string; label: string; lyrics: string; syncedLyrics: string; durationDiff?: number }
let localProvider: ((key: string) => LocalLyricsVersion[]) | null = null;
export function setLocalLyricsProvider(fn: (key: string) => LocalLyricsVersion[]): void { localProvider = fn; }
function localVersions(artist: string, title: string): LocalLyricsVersion[] {
  try { return localProvider ? localProvider(`${artist}|${title}`.toLowerCase()) : []; } catch { return []; }
}

export function setupLyricsIPC(mainWindow: BrowserWindow): void {
  // Lyrics — multi-source parallel search with caching.
  // Synced-capable: lrclib.net, NetEase, QQ Music. Plain-only: Genius, lyrics.ovh,
  // Musixmatch, AZLyrics, lyrist, ChartLyrics. lrclib always ranks first.
  const lyricsCache = new Map<string, { lyrics: string | null; syncedLyrics?: string; source?: string }>();
  const LYRICS_TIMEOUT = 4000;


  /** NetEase Cloud Music — deep RU/JA/KR catalogue with time-synced LRC. */
  async function fetchNetease(query: string, duration: number | undefined, wanted: LyricsQuery[]): Promise<{ lyrics: string; syncedLyrics?: string; source: string } | null> {
    try {
      const headers = { 'User-Agent': CHROME_UA, 'Referer': 'https://music.163.com/' };
      const searchResp = await fetchWithTimeout(
        `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=8`,
        LYRICS_TIMEOUT, { headers }
      );
      if (!searchResp.ok) return null;
      const searchData = await searchResp.json() as { result?: { songs?: Array<{ id?: number; name?: string; duration?: number; artists?: Array<{ name?: string }> }> } };
      const songs = searchData.result?.songs || [];
      if (!songs.length) return null;
      // NetEase reports durations in milliseconds.
      const ranked = songs
        .map((x) => ({ x, m: matchScore(x.name, (x.artists || []).map(a => a.name).join(' '), wanted, (typeof duration === 'number' && duration > 0 && x.duration) ? Math.abs(x.duration / 1000 - duration) : undefined) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => (b.m - (typeof duration === 'number' && duration > 0 ? Math.abs((b.x.duration || 1e9) / 1000 - duration) * 0.02 : 0)) - (a.m - (typeof duration === 'number' && duration > 0 ? Math.abs((a.x.duration || 1e9) / 1000 - duration) * 0.02 : 0)));
      if (!ranked.length) return null;
      const song = ranked[0].x;
      if (!song?.id) return null;
      const lyricResp = await fetchWithTimeout(
        `https://music.163.com/api/song/lyric?id=${song.id}&lv=-1&kv=-1&tv=-1`,
        LYRICS_TIMEOUT, { headers }
      );
      if (!lyricResp.ok) return null;
      const lyricData = await lyricResp.json() as { lrc?: { lyric?: string } };
      const lrc = (lyricData.lrc?.lyric || '').trim();
      if (lrc.length < 20) return null;
      if (/\[\d{1,3}:\d{1,2}/.test(lrc)) return { lyrics: lrcToPlain(lrc) || lrc, syncedLyrics: lrc, source: 'netease' };
      return { lyrics: lrc, source: 'netease' };
    } catch { return null; }
  }

  /** QQ Music — time-synced LRC; search rows carry durations in seconds. */
  async function fetchQQMusic(query: string, duration: number | undefined, wanted: LyricsQuery[]): Promise<{ lyrics: string; syncedLyrics?: string; source: string } | null> {
    try {
      const headers = { 'User-Agent': CHROME_UA, 'Referer': 'https://y.qq.com/' };
      const searchResp = await fetchWithTimeout(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(query)}&format=json&new_json=1`,
        LYRICS_TIMEOUT, { headers }
      );
      if (!searchResp.ok) return null;
      const searchData = await searchResp.json() as { data?: { song?: { list?: Array<{ mid?: string; name?: string; interval?: number; singer?: Array<{ name?: string }> }> } } };
      const songs = searchData.data?.song?.list || [];
      if (!songs.length) return null;
      const ranked = songs
        .map((x) => ({ x, m: matchScore(x.name, (x.singer || []).map(a => a.name).join(' '), wanted, (typeof duration === 'number' && duration > 0 && x.interval) ? Math.abs(x.interval - duration) : undefined) }))
        .filter((r) => r.m > 0)
        .sort((a, b) => (b.m - (typeof duration === 'number' && duration > 0 ? Math.abs((b.x.interval || 1e9) - duration) * 0.02 : 0)) - (a.m - (typeof duration === 'number' && duration > 0 ? Math.abs((a.x.interval || 1e9) - duration) * 0.02 : 0)));
      if (!ranked.length) return null;
      const song = ranked[0].x;
      if (!song?.mid) return null;
      const lyricResp = await fetchWithTimeout(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(song.mid)}&format=json&nobase64=1&g_tk=5381`,
        LYRICS_TIMEOUT, { headers: { ...headers, 'Referer': 'https://y.qq.com/portal/player.html' } }
      );
      if (!lyricResp.ok) return null;
      const lyricData = await lyricResp.json() as { lyric?: string };
      let lrc = (lyricData.lyric || '').trim();
      if (lrc.length < 20) return null;
      // QQ escapes entities and pads credit lines we do not want in the reel.
      lrc = lrc
        .replace(/&#(\d+);/g, (_s, d: string) => String.fromCharCode(Number(d)))
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/^\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\].*(?:Lyrics by|Composed by|Produced by|作词|作曲|编曲).*$/gim, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (!/\[\d{1,3}:\d{1,2}/.test(lrc)) return null;
      return { lyrics: lrcToPlain(lrc) || lrc, syncedLyrics: lrc, source: 'qqmusic' };
    } catch { return null; }
  }

  /** lyrist — small public lyrics API, plain text only. */
  async function fetchLyrist(artist: string, title: string): Promise<{ lyrics: string; source: string } | null> {
    try {
      const resp = await fetchWithTimeout(
        `https://lyrist.vercel.app/api/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`,
        LYRICS_TIMEOUT
      );
      if (!resp.ok) return null;
      const data = await resp.json() as { lyrics?: string };
      const text = (data.lyrics || '').trim();
      return text.length > 20 ? { lyrics: text, source: 'lyrist' } : null;
    } catch { return null; }
  }


  // --- Manual lyric choice ----------------------------------------------------
  interface LyricsCandidate { id: string; source: string; label: string; synced: boolean; lyrics: string; syncedLyrics?: string; durationDiff?: number }

  async function collectLyricsCandidates(query: string, dur: number | undefined, altQuery: string | undefined, wanted: LyricsQuery[]): Promise<LyricsCandidate[]> {
    const out: LyricsCandidate[] = [];
    const add = (c: LyricsCandidate | null) => { if (c && c.lyrics) out.push(c); };

    const lrclib = (async () => {
      try {
        const qs = Array.from(new Set([query, altQuery || ''].filter(Boolean)));
        const lists = await Promise.all(qs.map(async (q) => {
          try {
            const resp = await fetchWithTimeout(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, LYRICS_TIMEOUT + 1500);
            return resp.ok ? await resp.json() as Array<{ id?: number; trackName?: string; artistName?: string; duration?: number; plainLyrics?: string; syncedLyrics?: string }> : [];
          } catch { return []; }
        }));
        const seenIds = new Set<number | undefined>();
        const list = ([] as typeof lists[0]).concat(...lists).filter((e) => !seenIds.has(e.id) && !!seenIds.add(e.id));
        for (const e of list.slice(0, 12)) {
          const lyrics = e.syncedLyrics ? (lrcToPlain(e.syncedLyrics) || e.syncedLyrics) : (e.plainLyrics || '');
          add({
            id: `lrclib:${e.id}`, source: 'lrclib', label: `${e.artistName || '?'} — ${e.trackName || '?'}`,
            synced: !!e.syncedLyrics, lyrics, syncedLyrics: e.syncedLyrics || undefined,
            durationDiff: dur && e.duration ? Math.abs(e.duration - dur) : undefined,
          });
        }
      } catch { /* source unavailable */ }
    })();

    const netease = (async () => {
      try {
        const headers = { 'User-Agent': CHROME_UA, 'Referer': 'https://music.163.com/' };
        const resp = await fetchWithTimeout(`https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=6`, LYRICS_TIMEOUT, { headers });
        if (!resp.ok) return;
        const data = await resp.json() as { result?: { songs?: Array<{ id?: number; name?: string; duration?: number; artists?: Array<{ name?: string }> }> } };
        const songs = (data.result?.songs || []).slice(0, 5);
        await Promise.all(songs.map(async (song) => {
          try {
            const lr = await fetchWithTimeout(`https://music.163.com/api/song/lyric?id=${song.id}&lv=-1&kv=-1&tv=-1`, LYRICS_TIMEOUT, { headers });
            if (!lr.ok) return;
            const lrc = (((await lr.json()) as { lrc?: { lyric?: string } }).lrc?.lyric || '').trim();
            if (lrc.length < 20) return;
            const synced = /\[\d{1,3}:\d{1,2}/.test(lrc);
            add({
              id: `netease:${song.id}`, source: 'netease',
              label: `${(song.artists || []).map(a => a.name).filter(Boolean).join(', ') || '?'} — ${song.name || '?'}`,
              synced, lyrics: synced ? (lrcToPlain(lrc) || lrc) : lrc, syncedLyrics: synced ? lrc : undefined,
              durationDiff: dur && song.duration ? Math.abs(song.duration / 1000 - dur) : undefined,
            });
          } catch { /* skip this song */ }
        }));
      } catch { /* source unavailable */ }
    })();

    const qq = (async () => {
      try {
        const headers = { 'User-Agent': CHROME_UA, 'Referer': 'https://y.qq.com/' };
        const resp = await fetchWithTimeout(`https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(query)}&format=json&new_json=1`, LYRICS_TIMEOUT, { headers });
        if (!resp.ok) return;
        const data = await resp.json() as { data?: { song?: { list?: Array<{ mid?: string; name?: string; interval?: number; singer?: Array<{ name?: string }> }> } } };
        const songs = (data.data?.song?.list || []).slice(0, 4);
        await Promise.all(songs.map(async (song) => {
          try {
            const lr = await fetchWithTimeout(
              `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(song.mid || '')}&format=json&nobase64=1&g_tk=5381`,
              LYRICS_TIMEOUT, { headers: { ...headers, 'Referer': 'https://y.qq.com/portal/player.html' } });
            if (!lr.ok) return;
            const lrc = (((await lr.json()) as { lyric?: string }).lyric || '').trim()
              .replace(/&#(\d+);/g, (_m, d: string) => String.fromCharCode(Number(d)))
              .replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, '&');
            if (lrc.length < 20 || !/\[\d{1,3}:\d{1,2}/.test(lrc)) return;
            add({
              id: `qq:${song.mid}`, source: 'qqmusic',
              label: `${(song.singer || []).map(a => a.name).filter(Boolean).join(', ') || '?'} — ${song.name || '?'}`,
              synced: true, lyrics: lrcToPlain(lrc) || lrc, syncedLyrics: lrc,
              durationDiff: dur && song.interval ? Math.abs(song.interval - dur) : undefined,
            });
          } catch { /* skip this song */ }
        }));
      } catch { /* source unavailable */ }
    })();

    // Genius has plain text for many tracks the synced catalogues lack.
    const genius = (async () => {
      try {
        const resp = await fetchWithTimeout(`https://genius.com/api/search/song?q=${encodeURIComponent(query)}`, LYRICS_TIMEOUT + 2000, { headers: { 'User-Agent': CHROME_UA } });
        if (!resp.ok) return;
        const data = await resp.json() as { response?: { sections?: Array<{ hits?: Array<{ result?: { url?: string; title?: string; primary_artist?: { name?: string } } }> }> } };
        const hits = (data.response?.sections?.[0]?.hits || []).slice(0, 3);
        await Promise.all(hits.map(async (h) => {
          try {
            if (!h.result?.url) return;
            const page = await fetchWithTimeout(h.result.url, LYRICS_TIMEOUT + 2000, { headers: { 'User-Agent': CHROME_UA } });
            if (!page.ok) return;
            const lyrics = extractGeniusLyrics(await page.text());
            if (!lyrics) return;
            add({ id: `genius:${h.result.url}`, source: 'genius', label: `${h.result.primary_artist?.name || '?'} — ${h.result.title || '?'}`, synced: false, lyrics });
          } catch { /* skip this hit */ }
        }));
      } catch { /* source unavailable */ }
    })();

    await Promise.all([lrclib, netease, qq, genius]);
    // Relevance first: a synced lyric of the wrong song is worse than a plain one
    // of the right song. Labels are "artist — title"; unrelated hits are dropped
    // (unless nothing matches at all, so the list is never empty by our own doing).
    const seenText = new Set<string>();
    const ranked = out
      .filter((c) => { const k = c.lyrics.slice(0, 120); if (seenText.has(k)) return false; seenText.add(k); return true; })
      .map((c) => {
        const parts = c.label.split(' \u2014 ');
        const artistName = parts.length > 1 ? parts[0] : '';
        const name = parts.length > 1 ? parts.slice(1).join(' \u2014 ') : c.label;
        return { c, rel: matchScore(name, artistName, wanted, c.durationDiff) };
      });
    const relevant = ranked.filter((x) => x.rel > 0);
    return (relevant.length ? relevant : ranked)
      .sort((a, b) => (b.rel - a.rel) || (Number(b.c.synced) - Number(a.c.synced)) || ((a.c.durationDiff ?? 999) - (b.c.durationDiff ?? 999)))
      .map((x) => x.c)
      .slice(0, 14);
  }

  ipcMain.handle(IPC_CHANNELS.LYRICS_CANDIDATES, async (event, artist: string, title: string, duration?: number, customQuery?: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof artist !== 'string' || typeof title !== 'string' || artist.length > 500 || title.length > 500) throw new Error('Invalid lyrics query');
    const dur = (typeof duration === 'number' && Number.isFinite(duration) && duration > 1 && duration < 24 * 3600) ? duration : undefined;
    let query = typeof customQuery === 'string' && customQuery.trim() ? customQuery.trim().slice(0, 300) : '';
    const parsed = parseSoundCloudTrack(artist, title);
    if (!query) {
      const p0 = parsed[0] || { artist: cleanLyricsArtist(artist), title: cleanLyricsTitle(title) };
      query = `${p0.artist} ${p0.title}`.trim();
    }
    // A title-only query catches uploads whose uploader is not the real artist.
    const altQuery = parsed[0] && !customQuery ? parsed[0].title : '';
    // What the user typed is the truth about what they want; otherwise the parse is.
    const wanted: LyricsQuery[] = customQuery && customQuery.trim()
      ? [{ artist: query, title: query }]
      : (parsed.length ? parsed : [{ artist: query, title: query }]);
    const found = await collectLyricsCandidates(query, dur, altQuery, wanted);
    // This computer's own syncs of exactly this track come first.
    const own: LyricsCandidate[] = localVersions(artist, title).map((v) => ({
      id: `sixteen:${v.id}`, source: 'sixteen', label: v.label, synced: true, lyrics: v.lyrics, syncedLyrics: v.syncedLyrics, durationDiff: v.durationDiff,
    }));
    return own.concat(found);
  });

  // Per-track memory: the lyrics the user picked and their sync offset (ms).
  ipcMain.handle(IPC_CHANNELS.LYRICS_PREF, async (event, action: string, key: string, value?: unknown) => {
    assertMainRenderer(event, mainWindow);
    return updateLyricsPref(action, key, value);
  });

  ipcMain.handle(IPC_CHANNELS.LYRICS_FETCH, async (event, artist: string, title: string, duration?: number) => {
    assertMainRenderer(event, mainWindow);
    if (typeof artist !== 'string' || typeof title !== 'string' || artist.length > 500 || title.length > 500) throw new Error('Invalid lyrics query');
    // Duration comes from the playing audio element; it sharpens source matching.
    const dur = (typeof duration === 'number' && Number.isFinite(duration) && duration > 1 && duration < 24 * 3600) ? duration : undefined;
    const cacheKey = (artist + '|' + title + (dur ? '|d' + Math.round(dur) : '')).toLowerCase();
    if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

    const variations = parseSoundCloudTrack(artist, title);
    if (!variations.length) variations.push({ artist: cleanLyricsArtist(artist), title: cleanLyricsTitle(title) || title });

    const v0 = variations[0] || { artist, title };
    const searchQ = v0.artist + ' ' + v0.title;

    // ===== Phase 1: synced-capable sources, all in parallel =====
    // lrclib (exact gets incl. duration + two search flavours), NetEase LRC, QQ Music LRC.
    // Any synced result wins; lrclib ranks above the rest, then NetEase, then QQ Music.
    try {
      const lrclibPromises = variations.map(v =>
        fetchWithTimeout(
          `https://lrclib.net/api/get?artist_name=${encodeURIComponent(v.artist)}&track_name=${encodeURIComponent(v.title)}${dur ? '&duration=' + Math.round(dur) : ''}`,
          LYRICS_TIMEOUT
        ).then(async resp => (resp.ok ? await resp.json() as LrclibEntry : null)).catch(() => null)
      );

      const lrclibSearchPromises = [
        `https://lrclib.net/api/search?q=${encodeURIComponent(searchQ)}`,
        `https://lrclib.net/api/search?track_name=${encodeURIComponent(v0.title)}&artist_name=${encodeURIComponent(v0.artist)}`,
        ...variations.slice(1, 4).map(v => `https://lrclib.net/api/search?q=${encodeURIComponent(v.artist + ' ' + v.title)}`),
        `https://lrclib.net/api/search?q=${encodeURIComponent(v0.title)}`,
      ].map(url =>
        fetchWithTimeout(url, LYRICS_TIMEOUT)
          .then(async resp => (resp.ok ? await resp.json() as LrclibEntry[] : []))
          .catch(() => [] as LrclibEntry[])
      );

      const [exactEntries, searchLists, netease, qqmusic] = await Promise.all([
        Promise.all(lrclibPromises),
        Promise.all(lrclibSearchPromises),
        fetchNetease(searchQ, dur, variations),
        fetchQQMusic(searchQ, dur, variations),
      ]);

      const lrclib = pickLrclib(exactEntries.concat(...searchLists), dur, variations);

      const synced = [lrclib, netease, qqmusic].find(r => r && r.syncedLyrics);
      if (synced) { lyricsCache.set(cacheKey, synced); return synced; }

      const earlyPlain = lrclib || netease;
      if (earlyPlain && earlyPlain.lyrics) { lyricsCache.set(cacheKey, earlyPlain); return earlyPlain; }
    } catch (e: any) { logWarn('Lyrics phase 1 failed:', e?.message); }

    // ===== Phase 2: plain-text sources (all parallel) =====
    try {
      // --- Genius scrape ---
      const geniusPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          type GHit = { result?: { url?: string; title?: string; full_title?: string; primary_artist?: { name?: string } } };
          const queries = Array.from(new Set(variations.slice(0, 3).map(v => `${v.artist} ${v.title}`).concat(v0.title)));
          const lists = await Promise.all(queries.map(async (q) => {
            try {
              const r = await fetchWithTimeout(`https://genius.com/api/search/song?q=${encodeURIComponent(q)}`, LYRICS_TIMEOUT + 2000, { headers: { 'User-Agent': CHROME_UA } });
              if (!r.ok) return [] as GHit[];
              const d = await r.json() as { response?: { sections?: Array<{ hits?: GHit[] }> } };
              return d.response?.sections?.[0]?.hits || [];
            } catch { return [] as GHit[]; }
          }));
          const seenUrl = new Set<string>();
          const ranked = ([] as GHit[]).concat(...lists)
            .filter((h) => h.result?.url && !seenUrl.has(h.result.url) && !!seenUrl.add(h.result.url))
            .map((h) => ({ h, m: matchScore(h.result?.title, h.result?.primary_artist?.name, variations) }))
            .filter((x) => x.m > 0)
            .sort((a, b) => b.m - a.m);
          for (const { h } of ranked.slice(0, 2)) {
            const pageResp = await fetchWithTimeout(h.result!.url!, LYRICS_TIMEOUT + 2000, { headers: { 'User-Agent': CHROME_UA } });
            if (!pageResp.ok) continue;
            const lyrics = extractGeniusLyrics(await pageResp.text());
            if (lyrics) return { lyrics, source: 'genius' };
          }
          return null;
        } catch { return null; }
      })();

      // --- Musixmatch (macro API — used by desktop apps, no key needed) ---
      const musixmatchPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          if (!MUSIXMATCH_API_KEY) return null;
          // Step 1: search for the track
          const searchResp = await fetchWithTimeout(
            `https://api.musixmatch.com/ws/1.1/track.search?q_track=${encodeURIComponent(v0.title)}&q_artist=${encodeURIComponent(v0.artist)}&page_size=1&page=1&s_track_rating=desc&apikey=${MUSIXMATCH_API_KEY}`,
            LYRICS_TIMEOUT
          );
          if (!searchResp.ok) return null;
          const searchData = await searchResp.json() as any;
          const trackList = searchData?.message?.body?.track_list;
          if (!trackList || !trackList.length) return null;
          const trackId = trackList[0]?.track?.track_id;
          if (!trackId) return null;

          // Step 2: get lyrics
          const lyricsResp = await fetchWithTimeout(
            `https://api.musixmatch.com/ws/1.1/track.lyrics.get?track_id=${trackId}&apikey=${MUSIXMATCH_API_KEY}`,
            LYRICS_TIMEOUT
          );
          if (!lyricsResp.ok) return null;
          const lyricsData = await lyricsResp.json() as any;
          const lyricsBody = lyricsData?.message?.body?.lyrics?.lyrics_body;
          if (!lyricsBody || lyricsBody.length < 20) return null;
          // Musixmatch appends a commercial notice — remove it
          const cleaned = lyricsBody
            .replace(/\*{7,}.*$/s, '')
            .replace(/This Lyrics is NOT for Commercial use.*/s, '')
            .replace(/\.\.\.\s*$/, '')
            .trim();
          return cleaned.length > 20 ? { lyrics: cleaned, source: 'musixmatch' } : null;
        } catch { return null; }
      })();

      // --- lyrics.ovh ---
      const ovhPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          const resp = await fetchWithTimeout(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(v0.artist)}/${encodeURIComponent(v0.title)}`,
            LYRICS_TIMEOUT
          );
          if (!resp.ok) return null;
          const data = await resp.json() as { lyrics?: string };
          if (data.lyrics && data.lyrics.trim().length > 10) return { lyrics: data.lyrics.trim(), source: 'lyrics.ovh' };
          return null;
        } catch { return null; }
      })();

      // --- AZLyrics scrape ---
      const azlyricsPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          // AZLyrics URL pattern: azlyrics.com/lyrics/artistname/songname.html
          const azArtist = v0.artist.toLowerCase().replace(/[^a-z0-9]/g, '');
          const azTitle = v0.title.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!azArtist || !azTitle) return null;
          const resp = await fetchWithTimeout(
            `https://www.azlyrics.com/lyrics/${azArtist}/${azTitle}.html`,
            LYRICS_TIMEOUT,
            { headers: { 'User-Agent': CHROME_UA } }
          );
          if (!resp.ok) return null;
          const lyrics = extractAZLyrics(await resp.text());
          return lyrics ? { lyrics, source: 'azlyrics' } : null;
        } catch { return null; }
      })();

      // --- ChartLyrics API (XML) ---
      const chartlyricsPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          const resp = await fetchWithTimeout(
            `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(v0.artist)}&song=${encodeURIComponent(v0.title)}`,
            LYRICS_TIMEOUT
          );
          if (!resp.ok) return null;
          const lyrics = extractChartLyrics(await resp.text());
          return lyrics ? { lyrics, source: 'chartlyrics' } : null;
        } catch { return null; }
      })();

      const results = await Promise.all([
        geniusPromise, musixmatchPromise, ovhPromise, azlyricsPromise, chartlyricsPromise,
        fetchLyrist(v0.artist, v0.title),
      ]);

      // Pick the best result — prefer longest lyrics (usually most complete)
      const valid = results.filter((r): r is { lyrics: string; source: string } => r !== null && r.lyrics.length > 20);
      if (valid.length > 0) {
        valid.sort((a, b) => b.lyrics.length - a.lyrics.length);
        const best = valid[0];
        lyricsCache.set(cacheKey, best);
        return best;
      }
    } catch (e: any) { logWarn('Lyrics phase 2 failed:', e?.message); }

    const noResult = { lyrics: null };
    lyricsCache.set(cacheKey, noResult);
    return noResult;
  });
}

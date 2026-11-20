import { app, dialog, ipcMain, session, type BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import archiver from 'archiver';
import { IPC_CHANNELS, SOUNDCLOUD_API_V2 } from '../../shared/constants';
import type { DownloadRequest } from '../../shared/types';
import { isTrustedSoundCloudUrl } from '../../shared/security';
import { logInfo, logWarn } from '../logger';
import { assertMainRenderer, safeSend } from './guard';
import { eFetch, readFileHead, readResponseBuffer, streamResponseToFile } from './net';
import {
  resolveTrackStream, resolveTrackStreamById, scApiFetch, scResolve, storedOAuthToken, withClientId,
  type ResolvedTrackStream, type ScTrackData,
} from './soundcloud-api';
import { getStore } from './store';
import { coverArtUrl, escapeFfmpegMeta, isHlsPlaylistBuffer, safeFileName, validateDownloadRequest } from './validators';

const MAX_AUDIO_BYTES = 500 * 1024 * 1024;
const MAX_COVER_BYTES = 20 * 1024 * 1024;
const PLAYLIST_CONCURRENCY = 3;
const LIKES_PAGE_LIMIT = 50; // pages of 200 = 10k likes

type Quality = DownloadRequest['quality'];

// Converting needs a real ffmpeg. The bundled ffmpeg-static binary can be
// missing or built for another platform, so fall back to a system ffmpeg
// before giving up on the download.
export function resolveFfmpegPath(): string {
  let staticPath = '';
  try {
    staticPath = (require('ffmpeg-static') as string) || '';
  } catch { /* ffmpeg-static not installed */ }
  const candidates = [process.env.SIXTEENCLOUD_FFMPEG, staticPath, '/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg']
    .filter((c): c is string => !!c);
  for (const candidate of candidates) {
    try { if (fs.existsSync(candidate)) return candidate; } catch { /* try next */ }
  }
  return 'ffmpeg'; // let the spawn resolve it through PATH
}

/** The folder downloads really go to: the chosen one, else <system Music folder>/SixteenCloud. */
function resolveOutputDir(): string {
  return (getStore().get('downloader.outputDir') || path.join(app.getPath('music'), 'SixteenCloud')) as string;
}

function defaultOutputDir(): string {
  const dir = resolveOutputDir();
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function configuredQuality(): Quality {
  const q = getStore().get('downloader.quality');
  return q === '256' || q === 'original' ? q : '128';
}

function unlinkQuiet(file: string | null): void {
  if (!file) return;
  try { fs.unlinkSync(file); } catch { /* already gone */ }
}

function runFfmpeg(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(resolveFfmpegPath(), args, { maxBuffer: 8 * 1024 * 1024 }, (error, _stdout, stderr) => {
      if (!error) { resolve(); return; }
      const detail = String(stderr || '').trim().split('\n').slice(-3).join(' | ');
      reject(Object.assign(error, { message: detail ? `${error.message}: ${detail}` : error.message }));
    });
  });
}

export interface ConvertOptions {
  request: DownloadRequest;
  outputDir: string;
  /** File name without extension; defaults to "artist - title". */
  baseName?: string;
  /** Skip /resolve when the caller already has the stream. */
  resolved?: ResolvedTrackStream;
  token?: string;
  onStage?: (percent: number, status: 'downloading' | 'converting' | 'tagging') => void;
}

/**
 * Fetch one track, convert it to a tagged MP3 with cover art and return the
 * output path. Audio is streamed to disk, never buffered whole in memory.
 * HLS-only tracks need ffmpeg; progressive MP3 bytes are saved as they are
 * when ffmpeg is unavailable or fails.
 */
export async function downloadAndConvertTrack(opts: ConvertOptions): Promise<string> {
  const { request, outputDir } = opts;
  const onStage = opts.onStage || (() => {});
  const token = opts.token ?? storedOAuthToken();
  const baseName = opts.baseName || safeFileName(`${request.artist} - ${request.title}`);
  const outputFile = path.join(outputDir, baseName + '.mp3');
  const nonce = crypto.randomBytes(4).toString('hex');
  const tempFile = path.join(outputDir, `${baseName}.${nonce}.tmp`);
  let coverFile: string | null = null;

  onStage(10, 'downloading');
  const { audioUrl, trackData } = opts.resolved || await resolveTrackStream(request.trackUrl, token);
  onStage(30, 'downloading');

  try {
    const audioResp = await eFetch(audioUrl);
    if (!audioResp.ok) throw new Error(`Audio download failed: ${audioResp.status}`);
    await streamResponseToFile(audioResp, tempFile, MAX_AUDIO_BYTES);
    // SoundCloud serves HLS-only for many tracks: then the fetched bytes are
    // an m3u8 playlist whose segments ffmpeg must be allowed to fetch.
    const isHls = isHlsPlaylistBuffer(readFileHead(tempFile, 16));
    onStage(70, 'converting');

    if (request.artworkUrl) {
      try {
        const coverResp = await eFetch(coverArtUrl(request.artworkUrl));
        if (coverResp.ok) {
          const candidate = path.join(outputDir, `${baseName}.${nonce}.cover.jpg`);
          fs.writeFileSync(candidate, await readResponseBuffer(coverResp, MAX_COVER_BYTES));
          coverFile = candidate;
        }
      } catch { /* no cover, keep going */ }
    }

    const args: string[] = ['-hide_banner', '-nostats', '-loglevel', 'error'];
    if (isHls) args.push('-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls');
    args.push('-i', tempFile);
    if (coverFile) args.push('-i', coverFile, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    const year = String(trackData.release_date || trackData.created_at || '').substring(0, 4);
    args.push(
      '-c:a', 'libmp3lame', '-b:a', request.quality === 'original' ? '320k' : `${request.quality}k`,
      '-id3v2_version', '3',
      '-metadata', `title=${escapeFfmpegMeta(request.title)}`,
      '-metadata', `artist=${escapeFfmpegMeta(request.artist)}`,
      '-metadata', `album=${escapeFfmpegMeta(request.album || request.artist)}`,
    );
    if (trackData.genre) args.push('-metadata', `genre=${escapeFfmpegMeta(trackData.genre)}`);
    if (year) args.push('-metadata', `date=${year}`);
    if (request.trackNumber) args.push('-metadata', `track=${request.trackNumber}`);
    args.push('-y', outputFile);

    try {
      await runFfmpeg(args);
    } catch (err: any) {
      // An HLS playlist is text, not audio: saving it as .mp3 would hand the
      // user a broken file. Progressive bytes are already a playable MP3.
      if (isHls) throw new Error(`ffmpeg is required for this track: ${err?.message || err}`);
      logWarn(`[Downloader] ffmpeg failed (${err?.code || err?.message}), saving the original stream untagged`);
      unlinkQuiet(outputFile);
      fs.renameSync(tempFile, outputFile);
    }
    onStage(95, 'tagging');
    return outputFile;
  } catch (err) {
    unlinkQuiet(outputFile);
    throw err;
  } finally {
    unlinkQuiet(tempFile);
    unlinkQuiet(coverFile);
  }
}

/** Run tasks with at most `limit` in flight. */
async function runPool<T>(items: T[], limit: number, worker: (item: T, index: number) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(lanes);
}

/** Append " (2)", " (3)"... so two tracks with the same name do not clobber each other. */
function uniqueNames(names: string[]): string[] {
  const seen = new Map<string, number>();
  return names.map((name) => {
    const key = name.toLowerCase();
    const n = (seen.get(key) || 0) + 1;
    seen.set(key, n);
    return n === 1 ? name : `${name} (${n})`;
  });
}

interface LikesPage {
  collection?: Array<{ track?: { permalink_url?: string; title?: string; user?: { username?: string }; artwork_url?: string | null } }>;
  next_href?: string | null;
}

/** Validate a SoundCloud `next_href` and give it our current client_id. */
function nextPageUrl(nextHref: unknown): ((cid: string) => string) | null {
  if (typeof nextHref !== 'string' || !isTrustedSoundCloudUrl(nextHref)) return null;
  const url = new URL(nextHref);
  url.searchParams.delete('client_id');
  const base = url.toString();
  return (cid) => withClientId(base, cid);
}

type PlaylistTrack = ScTrackData & { id: number };
interface PlaylistData { id?: number; title?: string; secret_token?: string; track_count?: number; tracks?: PlaylistTrack[] }

export function setupDownloaderIPC(mainWindow: BrowserWindow): void {
  const store = getStore();

  function finishDownload(request: DownloadRequest, outputFile: string): void {
    const history = (store.get('downloader.history') || []) as Array<{ title: string; artist: string; date: string; path: string }>;
    history.push({ title: request.title, artist: request.artist, date: new Date().toISOString().split('T')[0], path: outputFile });
    store.set('downloader.history', history);
    safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, { trackId: request.trackId, percent: 100, status: 'complete' });
    safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_COMPLETE, { trackId: request.trackId, filePath: outputFile });
  }

  async function downloadSingle(request: DownloadRequest): Promise<void> {
    const outputFile = await downloadAndConvertTrack({
      request,
      outputDir: defaultOutputDir(),
      onStage: (percent, status) => safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, { trackId: request.trackId, percent, status }),
    });
    finishDownload(request, outputFile);
  }

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_TRACK, async (event, rawRequest: unknown) => {
    assertMainRenderer(event, mainWindow);
    try {
      await downloadSingle(validateDownloadRequest(rawRequest));
    } catch (err) {
      const trackId = rawRequest && typeof rawRequest === 'object' && 'trackId' in rawRequest
        ? String((rawRequest as { trackId?: unknown }).trackId || '') : '';
      safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_COMPLETE, { trackId, error: String(err) });
    }
  });

  // Canonical track metadata for the downloader panel: the modern track page
  // has no static title markup, so the panel asks the API instead.
  ipcMain.handle(IPC_CHANNELS.DOWNLOADER_RESOLVE, async (event, trackUrl: unknown) => {
    assertMainRenderer(event, mainWindow);
    if (typeof trackUrl !== 'string' || !isTrustedSoundCloudUrl(trackUrl)) throw new Error('Invalid track URL');
    const { resp, data } = await scResolve<ScTrackData>(trackUrl);
    if (!resp.ok || !data) throw new Error(`Resolve failed: ${resp.status}`);
    return {
      id: typeof data.id === 'number' ? data.id : null,
      title: typeof data.title === 'string' ? data.title : '',
      artist: data.user && typeof data.user.username === 'string' ? data.user.username : '',
      artworkUrl: typeof data.artwork_url === 'string' ? data.artwork_url : '',
      genre: data.genre || '',
      year: String(data.release_date || data.created_at || '').substring(0, 4),
    };
  });

  // --- Queue -----------------------------------------------------------------
  interface QueueItem { request: DownloadRequest; status: 'pending' | 'downloading' | 'paused' | 'done' | 'error'; error?: string }
  const downloadQueue: QueueItem[] = [];
  let queuePaused = false;
  let queueProcessing = false;

  function sendQueueState(): void {
    safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_QUEUE_STATE, {
      items: downloadQueue.map(q => ({ trackId: q.request.trackId, title: q.request.title, artist: q.request.artist, status: q.status, error: q.error })),
      paused: queuePaused,
    });
  }

  function enqueue(request: DownloadRequest): boolean {
    if (downloadQueue.some(q => q.request.trackId === request.trackId && q.status === 'pending')) return false;
    downloadQueue.push({ request, status: 'pending' });
    return true;
  }

  async function processQueue(): Promise<void> {
    if (queueProcessing || queuePaused) return;
    const next = downloadQueue.find(q => q.status === 'pending');
    if (!next) return;
    queueProcessing = true;
    next.status = 'downloading';
    sendQueueState();
    try {
      await downloadSingle(next.request);
      next.status = 'done';
    } catch (err) {
      logWarn(`[Downloader] Queue item failed: ${err}`);
      next.status = 'error';
      next.error = String((err as Error)?.message || err);
    }
    queueProcessing = false;
    sendQueueState();
    if (!queuePaused) void processQueue();
  }

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_ADD, async (event, rawRequest: unknown) => {
    assertMainRenderer(event, mainWindow);
    if (!enqueue(validateDownloadRequest(rawRequest))) return;
    sendQueueState();
    void processQueue();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_REMOVE, async (event, trackId: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof trackId !== 'string' || trackId.length > 256) return;
    const idx = downloadQueue.findIndex(q => q.request.trackId === trackId);
    if (idx !== -1) {
      downloadQueue.splice(idx, 1);
      sendQueueState();
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_PAUSE, async (event) => {
    assertMainRenderer(event, mainWindow);
    queuePaused = true;
    sendQueueState();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_RESUME, async (event) => {
    assertMainRenderer(event, mainWindow);
    queuePaused = false;
    sendQueueState();
    void processQueue();
  });

  // Every liked track goes into the queue; SoundCloud pages likes via next_href.
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_LIKED, async (event) => {
    assertMainRenderer(event, mainWindow);
    const token = storedOAuthToken();
    if (!token) throw new Error('auth: OAuth token required');
    const quality = configuredQuality();
    let pageUrl: ((cid: string) => string) | null = (cid) => `${SOUNDCLOUD_API_V2}/me/likes?limit=200&offset=0&client_id=${cid}`;
    let added = 0;
    for (let page = 0; pageUrl && page < LIKES_PAGE_LIMIT; page++) {
      const resp = await scApiFetch(pageUrl, token);
      if (!resp.ok) {
        if (page === 0) throw new Error(`Failed to fetch likes: ${resp.status}`);
        logWarn(`[Downloader] Likes page ${page + 1} failed (${resp.status}), stopping`);
        break;
      }
      const data = await resp.json() as LikesPage;
      for (const item of data.collection || []) {
        const track = item.track;
        if (!track?.permalink_url || !isTrustedSoundCloudUrl(track.permalink_url)) continue;
        const ok = enqueue({
          trackUrl: track.permalink_url,
          trackId: track.permalink_url.replace('https://soundcloud.com/', ''),
          title: track.title || 'Unknown',
          artist: track.user?.username || 'Unknown',
          artworkUrl: track.artwork_url || '',
          quality,
        });
        if (ok) added++;
      }
      pageUrl = nextPageUrl(data.next_href);
    }
    logInfo(`[Downloader] Queued ${added} liked tracks`);
    sendQueueState();
    if (added > 0) void processQueue();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_GET_DIR, (event) => {
    assertMainRenderer(event, mainWindow);
    return resolveOutputDir();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_SET_DIR, async (event) => {
    assertMainRenderer(event, mainWindow);
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'], title: 'Select download directory', defaultPath: resolveOutputDir(),
    });
    if (!result.canceled && result.filePaths.length > 0) {
      store.set('downloader.outputDir', result.filePaths[0]);
      return result.filePaths[0];
    }
    return resolveOutputDir();
  });

  // --- Playlist → zip ----------------------------------------------------------
  /** OAuth token: stored one, else what the page passed, else the session cookie. */
  async function playlistToken(pageToken?: string): Promise<string> {
    const stored = storedOAuthToken();
    if (stored) return stored;
    if (pageToken) return pageToken;
    try {
      const cookies = await session.defaultSession.cookies.get({ url: 'https://soundcloud.com', name: 'oauth_token' });
      if (cookies.length > 0) return cookies[0].value;
    } catch { /* no cookie jar access */ }
    return '';
  }

  /** Private playlists 404 through /resolve; the open page still has them in its hydration data. */
  async function playlistFromPage(token: string): Promise<PlaylistData | null> {
    if (mainWindow.isDestroyed()) return null;
    const pageData = await mainWindow.webContents.executeJavaScript(`
      (function() {
        try {
          var el = document.querySelector('#__sc_hydration');
          if (el) {
            var data = JSON.parse(el.textContent || '[]');
            var pl = data.find(function(e) { return e.hydratable === 'playlist'; });
            if (pl && pl.data) return JSON.stringify(pl.data);
          }
        } catch (e) {}
        return null;
      })();
    `).catch(() => null);
    if (typeof pageData !== 'string') return null;
    let playlist = JSON.parse(pageData) as PlaylistData;
    logInfo(`[Playlist] From page hydration: ${(playlist.tracks || []).length} tracks, secret token: ${playlist.secret_token ? 'yes' : 'no'}`);
    if (playlist.secret_token && playlist.id) {
      const resp = await scApiFetch(
        (cid) => `${SOUNDCLOUD_API_V2}/playlists/${playlist.id}?secret_token=${encodeURIComponent(playlist.secret_token!)}&client_id=${cid}`,
        token,
      );
      if (resp.ok) playlist = await resp.json() as PlaylistData;
    }
    return playlist;
  }

  /** Large playlists come back with "mini" tracks (id only); fill them in 50 at a time. */
  async function hydrateMiniTracks(tracks: PlaylistTrack[], token: string): Promise<void> {
    const mini = tracks.filter(t => !t.title);
    for (let b = 0; b < mini.length; b += 50) {
      const batch = mini.slice(b, b + 50);
      try {
        const resp = await scApiFetch((cid) => `${SOUNDCLOUD_API_V2}/tracks?ids=${batch.map(t => t.id).join(',')}&client_id=${cid}`, token);
        if (!resp.ok) { logInfo(`[Playlist] Track batch ${b / 50 + 1} answered ${resp.status}`); continue; }
        const full = new Map((await resp.json() as PlaylistTrack[]).map(ft => [ft.id, ft]));
        for (const t of batch) { const f = full.get(t.id); if (f) Object.assign(t, f); }
      } catch (e: any) {
        logInfo(`[Playlist] Track batch fetch failed: ${e?.message}`);
      }
    }
  }

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PLAYLIST, async (event, playlistUrl: string, pageToken?: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof playlistUrl !== 'string' || playlistUrl.length > 2048 || !isTrustedSoundCloudUrl(playlistUrl)) {
      throw new Error('Playlist URL must be an HTTPS SoundCloud URL');
    }
    if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 4096)) throw new Error('Invalid page token');
    logInfo(`[Playlist] Starting playlist download: ${playlistUrl}`);

    let tempDir: string | null = null;
    try {
      const token = await playlistToken(pageToken);
      logInfo(`[Playlist] OAuth token available: ${token ? 'yes' : 'no'}`);

      const { resp, data } = await scResolve<PlaylistData>(playlistUrl, token);
      let playlist = data;
      if (!resp.ok) {
        logInfo(`[Playlist] Resolve failed (${resp.status}), trying page hydration...`);
        playlist = await playlistFromPage(token).catch((e: any) => { logInfo(`[Playlist] Page extraction failed: ${e?.message}`); return null; });
        if (!playlist) throw new Error(`Resolve failed: ${resp.status} — playlist may be private. Try logging in via OAuth Token.`);
      }
      if (!playlist) throw new Error('Resolve returned no playlist');

      const tracks = (playlist.tracks || []).filter((t): t is PlaylistTrack => !!t && typeof t.id === 'number');
      logInfo(`[Playlist] Resolved ${tracks.length} tracks (track_count: ${playlist.track_count ?? '?'})`);
      await hydrateMiniTracks(tracks, token);

      const outputDir = defaultOutputDir();
      const playlistName = safeFileName(playlist.title || 'playlist', 100);
      tempDir = path.join(outputDir, `.${playlistName}_temp_${Date.now()}`);
      fs.mkdirSync(tempDir, { recursive: true });

      const quality = configuredQuality();
      const album = playlist.title || 'SoundCloud';
      const requests: DownloadRequest[] = tracks.map((track, i) => ({
        trackUrl: track.permalink_url || `https://soundcloud.com/track/${track.id}`,
        trackId: String(track.id),
        title: track.title || `Track ${i + 1}`,
        artist: track.user?.username || 'Unknown',
        artworkUrl: track.artwork_url || '',
        quality,
        album,
        trackNumber: i + 1,
      }));
      const names = uniqueNames(requests.map(r => safeFileName(`${r.artist} - ${r.title}`)));
      const results: Array<string | null> = new Array(tracks.length).fill(null);
      let completed = 0;
      const failures: string[] = [];

      const progress = (i: number, percent: number, status: string, extra: Record<string, unknown> = {}) => {
        safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
          trackId: 'playlist-' + tracks[i].id, percent, status,
          playlistIndex: i, playlistTotal: tracks.length, playlistCompleted: completed,
          trackName: requests[i].title + ' — ' + requests[i].artist,
          ...extra,
        });
      };

      const dir = tempDir;
      await runPool(tracks, PLAYLIST_CONCURRENCY, async (track, i) => {
        progress(i, 0, 'downloading');
        try {
          const resolved = await resolveTrackStreamById(track.id, token);
          results[i] = await downloadAndConvertTrack({
            request: requests[i], outputDir: dir, baseName: names[i], resolved, token,
            onStage: (percent, status) => progress(i, percent, status),
          });
          completed++;
          progress(i, 100, 'complete');
          logInfo(`[Playlist] Track ${i + 1}/${tracks.length} done`);
        } catch (err) {
          completed++;
          logInfo(`[Playlist] Track ${i + 1}/${tracks.length} error: ${err}`);
          failures.push(`${requests[i].title}: ${String((err as Error)?.message || err)}`);
          progress(i, 0, 'error', { error: String((err as Error)?.message || err) });
        }
      });

      const files = results.filter((f): f is string => !!f && fs.existsSync(f));
      if (files.length === 0) {
        throw new Error(`All ${tracks.length} tracks failed. First error: ${failures[0] || 'unknown'}`);
      }
      if (files.length > 0) {
        const zipPath = path.join(outputDir, playlistName + '.zip');
        logInfo(`[Playlist] Creating zip: ${zipPath} (${files.length} files)`);
        safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
          trackId: 'playlist-zip', percent: 99, status: 'zipping',
          playlistIndex: tracks.length - 1, playlistTotal: tracks.length, playlistCompleted: completed,
          trackName: playlistName + '.zip',
        });
        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 1 } }); // MP3 does not compress; go fast
          output.on('close', () => resolve());
          output.on('error', reject);
          archive.on('error', reject);
          archive.pipe(output);
          for (const file of files) archive.file(file, { name: path.basename(file) });
          void archive.finalize();
        });
      }

      logInfo(`[Playlist] All done! ${files.length}/${tracks.length} tracks`);
      safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_COMPLETE, { playlistDone: true, total: files.length, failed: failures.length, firstError: failures[0] || '' });
    } catch (err) {
      logInfo(`[Playlist] Fatal error: ${err}`);
      safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_COMPLETE, { error: String(err) });
    } finally {
      if (tempDir) {
        try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (e: any) { logWarn(`[Playlist] Temp cleanup failed: ${e?.message}`); }
      }
    }
  });
}

import { app, ipcMain, BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { createHash, randomBytes } from 'crypto';
import { IPC_CHANNELS } from '../shared/constants';
import { logInfo, logWarn } from './logger';
import { assertMainRenderer, getStore, resolveTrackStream } from './ipc';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../shared/security';
import type { TrackInfo } from '../shared/types';

interface CachedTrack {
  trackId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
  cachedAt: string;
  fileSize: number;
}

function getTracksFromStore(): CachedTrack[] {
  const store = getStore();
  if (!store) return [];
  return (store.get('offlineCache.tracks') || []) as CachedTrack[];
}

const CACHE_DIR_NAME = 'offline-cache';

function getCacheDir(): string {
  const baseDir = process.platform === 'linux' ? app.getPath('sessionData') : app.getPath('userData');
  const dir = path.join(baseDir, CACHE_DIR_NAME);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getCachedFilePath(trackId: string): string {
  const safeId = createHash('sha256').update(trackId).digest('hex');
  return path.join(getCacheDir(), `${safeId}.mp3`);
}

function getTotalCacheSize(): number {
  const tracks = getTracksFromStore();
  return tracks.reduce((sum, t) => sum + (t.fileSize || 0), 0);
}

/**
 * Stream a fetch response to disk while enforcing the cache size limit.
 * The caller is responsible for renaming the temporary file after this
 * function succeeds, so a failed download can never become a cache entry.
 */
async function streamResponseToFile(response: Response, filePath: string, maxBytes: number): Promise<number> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
  if (!response.body) throw new Error('Response body unavailable');

  const output = fs.createWriteStream(filePath, { flags: 'wx' });
  const reader = response.body.getReader();
  let total = 0;
  let outputError: Error | undefined;
  const onOutputError = (error: Error) => { outputError = error; };
  // Keep a listener for the whole transfer: createWriteStream can emit an
  // asynchronous open/write error while no drain/end handler is installed.
  output.on('error', onOutputError);

  const waitForDrain = (): Promise<void> => new Promise((resolve, reject) => {
    if (outputError) {
      reject(outputError);
      return;
    }
    const onDrain = () => {
      output.removeListener('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      output.removeListener('drain', onDrain);
      reject(error);
    };
    output.once('drain', onDrain);
    output.once('error', onError);
  });

  const finish = (): Promise<void> => new Promise((resolve, reject) => {
    if (outputError) {
      reject(outputError);
      return;
    }
    const onError = (error: Error) => reject(error);
    output.once('error', onError);
    output.end(() => {
      output.removeListener('error', onError);
      resolve();
    });
  });

  try {
    while (true) {
      if (outputError) throw outputError;
      const part = await reader.read();
      if (part.done) break;

      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      if (!output.write(chunk)) await waitForDrain();
      if (outputError) throw outputError;
    }
    await finish();
    return total;
  } catch (error) {
    try { await reader.cancel(); } catch { /* response already closed */ }
    const closePromise = output.closed
      ? Promise.resolve()
      : new Promise<void>(resolve => output.once('close', resolve));
    output.destroy();
    await closePromise;
    throw error;
  } finally {
    reader.releaseLock();
    output.removeListener('error', onOutputError);
  }
}

function enforceSizeLimit(): void {
  const store = getStore();
  if (!store) return;
  const maxBytes = ((store.get('offlineCache.maxSizeMB') as number) || 500) * 1024 * 1024;
  let tracks = [...getTracksFromStore()];

  // Sort by cachedAt ascending (oldest first)
  tracks.sort((a, b) => new Date(a.cachedAt).getTime() - new Date(b.cachedAt).getTime());

  let total = tracks.reduce((sum, t) => sum + (t.fileSize || 0), 0);

  while (total > maxBytes && tracks.length > 0) {
    const oldest = tracks.shift()!;
    const filePath = getCachedFilePath(oldest.trackId);
    try { fs.unlinkSync(filePath); } catch { /* file may not exist */ }
    total -= oldest.fileSize || 0;
    logInfo(`[OfflineCache] LRU evicted: ${oldest.title}`);
  }

  store.set('offlineCache.tracks', tracks);
}

interface OfflineCacheRequest {
  trackId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
  audioUrl: string;
}

function isValidCacheRequest(data: OfflineCacheRequest): boolean {
  return !!data &&
    typeof data.trackId === 'string' && data.trackId.length > 0 && data.trackId.length <= 256 &&
    typeof data.title === 'string' && data.title.length <= 500 &&
    typeof data.artist === 'string' && data.artist.length <= 500 &&
    typeof data.audioUrl === 'string' && isAllowedMediaUrl(data.audioUrl) &&
    (!data.artworkUrl || isAllowedMediaUrl(data.artworkUrl));
}

async function cacheTrack(data: OfflineCacheRequest): Promise<{ success: boolean; message?: string; error?: string }> {
  const store = getStore();
  if (!store) throw new Error('Store not initialized');
  if (!isValidCacheRequest(data)) throw new Error('Invalid offline cache request');

  // Check if already cached
  const tracks = getTracksFromStore();
  if (tracks.some(t => t.trackId === data.trackId)) {
    return { success: true, message: 'Already cached' };
  }

  const filePath = getCachedFilePath(data.trackId);
  const tempFilePath = `${filePath}.${process.pid}.${randomBytes(6).toString('hex')}.tmp`;

  try {
    const { net } = require('electron');
    const resp = await net.fetch(data.audioUrl);
    if (!resp.ok) throw new Error(`Download failed: ${resp.status}`);

    // Do not download a file that can never fit in the configured cache.
    const configuredLimitMB = Number(store.get('offlineCache.maxSizeMB')) || 500;
    const cacheLimitBytes = Math.max(50, Math.min(2048, configuredLimitMB)) * 1024 * 1024;
    const fileSize = await streamResponseToFile(resp, tempFilePath, Math.min(500 * 1024 * 1024, cacheLimitBytes));
    // Rename only after the stream has completed successfully. On POSIX this
    // replaces a stale file atomically; normally the destination is absent
    // because the track metadata was checked above.
    fs.renameSync(tempFilePath, filePath);

    const updatedTracks = [...tracks, {
      trackId: data.trackId,
      title: data.title,
      artist: data.artist,
      artworkUrl: data.artworkUrl,
      duration: data.duration,
      cachedAt: new Date().toISOString(),
      fileSize,
    }];
    store.set('offlineCache.tracks', updatedTracks);

    enforceSizeLimit();

    logInfo(`[OfflineCache] Cached: ${data.artist} - ${data.title} (${(fileSize / 1024 / 1024).toFixed(1)}MB)`);
    return { success: true };
  } catch (err: any) {
    try { fs.unlinkSync(tempFilePath); } catch { /* partial download cleanup */ }
    logWarn('[OfflineCache] Cache failed:', err?.message);
    return { success: false, error: err?.message };
  }
}

/** Derive a stable track id from a SoundCloud page URL. */
function trackIdFromUrl(trackUrl: string): string {
  try {
    return new URL(trackUrl).pathname.replace(/^\/+/, '').slice(0, 256);
  } catch {
    return '';
  }
}

export function setupOfflineCache(_win: BrowserWindow): void {
  // Cache a track
  ipcMain.handle(IPC_CHANNELS.OFFLINE_CACHE_TRACK, async (event, data: OfflineCacheRequest) => {
    assertMainRenderer(event, _win);
    return cacheTrack(data);
  });

  // Remove from cache
  ipcMain.handle(IPC_CHANNELS.OFFLINE_CACHE_REMOVE, async (event, trackId: string) => {
    assertMainRenderer(event, _win);
    if (typeof trackId !== 'string' || trackId.length > 256) return;
    const store = getStore();
    if (!store) return;

    const tracks = getTracksFromStore();
    store.set('offlineCache.tracks', tracks.filter(t => t.trackId !== trackId));

    const filePath = getCachedFilePath(trackId);
    try { fs.unlinkSync(filePath); } catch { /* ok */ }
    logInfo(`[OfflineCache] Removed: ${trackId}`);
  });

  // List cached tracks
  ipcMain.handle(IPC_CHANNELS.OFFLINE_CACHE_LIST, async (event) => {
    assertMainRenderer(event, _win);
    const store = getStore();
    if (!store) return [];
    return getTracksFromStore();
  });

  // Clear all
  ipcMain.handle(IPC_CHANNELS.OFFLINE_CACHE_CLEAR, async (event) => {
    assertMainRenderer(event, _win);
    const store = getStore();
    if (!store) return;

    const tracks = getTracksFromStore();
    for (const t of tracks) {
      const filePath = getCachedFilePath(t.trackId);
      try { fs.unlinkSync(filePath); } catch { /* ok */ }
    }
    store.set('offlineCache.tracks', []);
    logInfo('[OfflineCache] Cleared all');
  });

  // Status
  ipcMain.handle(IPC_CHANNELS.OFFLINE_CACHE_STATUS, async (event) => {
    assertMainRenderer(event, _win);
    const store = getStore();
    if (!store) return { count: 0, sizeMB: 0, maxSizeMB: 500 };

    const tracks = getTracksFromStore();
    const totalSize = getTotalCacheSize();
    return {
      count: tracks.length,
      sizeMB: Math.round(totalSize / 1024 / 1024 * 10) / 10,
      maxSizeMB: (store.get('offlineCache.maxSizeMB') as number) || 500,
    };
  });

  // Auto-cache tracks as they play. The renderer polls track info every few
  // seconds, so dedupe by track id and skip anything already on disk.
  let lastAutoCacheId = '';
  const autoCacheInFlight = new Set<string>();
  ipcMain.on(IPC_CHANNELS.TRACK_INFO, (event, rawInfo: TrackInfo) => {
    if (event.sender !== _win.webContents) return;
    if (!rawInfo || typeof rawInfo !== 'object') return;
    const store = getStore();
    if (!store) return;
    if (!store.get('offlineCache.enabled') || !store.get('offlineCache.autoCache')) return;
    if (rawInfo.isPlaying !== true) return;

    const trackUrl = typeof rawInfo.trackUrl === 'string' ? rawInfo.trackUrl : '';
    if (!isTrustedSoundCloudUrl(trackUrl)) return;
    const trackId = (typeof rawInfo.trackId === 'string' && rawInfo.trackId)
      ? rawInfo.trackId
      : trackIdFromUrl(trackUrl);
    if (!trackId || trackId === lastAutoCacheId || autoCacheInFlight.has(trackId)) return;
    if (getTracksFromStore().some(t => t.trackId === trackId)) {
      lastAutoCacheId = trackId;
      return;
    }

    lastAutoCacheId = trackId;
    autoCacheInFlight.add(trackId);
    void (async () => {
      try {
        const { audioUrl } = await resolveTrackStream(trackUrl);
        await cacheTrack({
          trackId,
          title: typeof rawInfo.title === 'string' ? rawInfo.title.slice(0, 500) : '',
          artist: typeof rawInfo.artist === 'string' ? rawInfo.artist.slice(0, 500) : '',
          artworkUrl: typeof rawInfo.artworkUrl === 'string' ? rawInfo.artworkUrl : '',
          duration: typeof rawInfo.duration === 'number' && Number.isFinite(rawInfo.duration) ? rawInfo.duration : 0,
          audioUrl,
        });
      } catch (err: any) {
        logWarn('[OfflineCache] Auto-cache failed:', err?.message);
      } finally {
        autoCacheInFlight.delete(trackId);
      }
    })();
  });
}

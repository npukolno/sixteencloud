import { ipcMain, type BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { logWarn } from '../logger';
import { cacheTrack } from '../offline-cache';
import { assertMainRenderer } from './guard';
import { resolveTrackStream } from './soundcloud-api';
import { validateOfflineQuickRequest } from './validators';

/**
 * One-click actions from the player bar. The page only names the track page;
 * the stream URL is resolved here, so the renderer never hands us a media URL
 * to fetch.
 */
export function setupQuickActionsIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.OFFLINE_CACHE_URL, async (event, raw: unknown) => {
    assertMainRenderer(event, mainWindow);
    const request = validateOfflineQuickRequest(raw);
    try {
      const { audioUrl, trackData } = await resolveTrackStream(request.trackUrl);
      const durationMs = Number((trackData as { duration?: unknown }).duration) || 0;
      return await cacheTrack({
        trackId: request.trackId,
        title: request.title || String(trackData.title || '').slice(0, 500),
        artist: request.artist || String(trackData.user?.username || '').slice(0, 500),
        artworkUrl: request.artworkUrl,
        duration: request.duration || durationMs / 1000,
        audioUrl,
      });
    } catch (err: any) {
      logWarn('[QuickActions] offline save failed:', err?.message);
      return { success: false, error: String(err?.message || err) };
    }
  });
}

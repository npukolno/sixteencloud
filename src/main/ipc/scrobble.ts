import { ipcMain, nativeImage, Notification, type BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../../shared/constants';
import { isAllowedMediaUrl } from '../../shared/security';
import { logWarn } from '../logger';
import { assertMainRenderer } from './guard';
import { eFetch, fetchWithTimeout } from './net';
import { getSecret, getStore, setSecret } from './store';

const LB_API = 'https://api.listenbrainz.org/1';

/** Track-change notifications (Linux has its own branded one in linux-integration). */
function setupTrackNotifications(mainWindow: BrowserWindow): void {
  let lastNotifyAt = 0;
  ipcMain.on(IPC_CHANNELS.NOTIFY_TRACK, async (event, info: { title?: unknown; artist?: unknown; artwork?: unknown }) => {
    try {
      assertMainRenderer(event, mainWindow);
      if (process.platform === 'linux') return;
      if (!getStore().get('player.notifications')) return;
      if (!Notification.isSupported() || mainWindow.isFocused()) return;
      const now = Date.now();
      if (now - lastNotifyAt < 1500) return;
      lastNotifyAt = now;
      const title = typeof info?.title === 'string' ? info.title.slice(0, 200) : '';
      const artist = typeof info?.artist === 'string' ? info.artist.slice(0, 200) : '';
      if (!title) return;
      let icon: Electron.NativeImage | undefined;
      if (typeof info.artwork === 'string' && isAllowedMediaUrl(info.artwork)) {
        try {
          const resp = await fetchWithTimeout(info.artwork.replace(/-(?:t\d+x\d+|small|badge|crop|large|original)\./, '-t200x200.'), 4000);
          if (resp.ok) {
            const img = nativeImage.createFromBuffer(Buffer.from(await resp.arrayBuffer()));
            if (!img.isEmpty()) icon = img;
          }
        } catch { /* a notification without a cover is fine */ }
      }
      new Notification({ title, body: artist, silent: true, icon }).show();
    } catch (e: any) {
      logWarn('[Notify] failed:', e?.message);
    }
  });
}

/**
 * ListenBrainz scrobbling. The token never leaves the main process: the
 * renderer can set it and ask whether one exists, but cannot read it back.
 */
export function setupScrobbleIPC(mainWindow: BrowserWindow): void {
  const store = getStore() as any;
  setupTrackNotifications(mainWindow);

  ipcMain.handle(IPC_CHANNELS.SCROBBLE_TOKEN, async (event, token: unknown) => {
    assertMainRenderer(event, mainWindow);
    if (typeof token !== 'string') return { success: false, error: 'Invalid token' };
    const value = token.trim();
    if (!value) { store.delete('scrobble'); return { success: true }; }
    if (!/^[A-Za-z0-9-]{20,64}$/.test(value)) return { success: false, error: 'Invalid token' };
    try {
      const resp = await eFetch(`${LB_API}/validate-token`, { headers: { Authorization: `Token ${value}` } });
      const data = await resp.json() as { valid?: boolean; user_name?: string };
      if (!resp.ok || !data.valid) return { success: false, error: 'Invalid token' };
      store.set('scrobble.user', data.user_name || '');
      setSecret('scrobble.token', value);
      return { success: true, user: data.user_name || '' };
    } catch (e: any) {
      return { success: false, error: String(e?.message || e) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.SCROBBLE_STATUS, async (event) => {
    assertMainRenderer(event, mainWindow);
    return { hasToken: !!getSecret('scrobble.token'), user: (store.get('scrobble.user') as string) || '' };
  });

  ipcMain.on(IPC_CHANNELS.SCROBBLE_SUBMIT, async (event, entry: { kind?: string; artist?: unknown; title?: unknown; durationMs?: unknown; listenedAt?: unknown }) => {
    try {
      assertMainRenderer(event, mainWindow);
      if (!store.get('player.scrobble')) return;
      const token = getSecret('scrobble.token');
      if (!token) return;
      const artist = typeof entry?.artist === 'string' ? entry.artist.trim().slice(0, 300) : '';
      const title = typeof entry?.title === 'string' ? entry.title.trim().slice(0, 300) : '';
      if (!artist || !title) return;
      const meta: Record<string, unknown> = {
        artist_name: artist, track_name: title,
        additional_info: {
          media_player: 'SixteenCloud', submission_client: 'SixteenCloud', music_service: 'soundcloud.com',
          ...(typeof entry.durationMs === 'number' && entry.durationMs > 0 ? { duration_ms: Math.round(entry.durationMs) } : {}),
        },
      };
      const body = entry.kind === 'now'
        ? { listen_type: 'playing_now', payload: [{ track_metadata: meta }] }
        : { listen_type: 'single', payload: [{ listened_at: typeof entry.listenedAt === 'number' ? Math.floor(entry.listenedAt) : Math.floor(Date.now() / 1000), track_metadata: meta }] };
      const resp = await eFetch(`${LB_API}/submit-listens`, {
        method: 'POST',
        headers: { Authorization: `Token ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!resp.ok) logWarn(`[Scrobble] ListenBrainz answered ${resp.status}`);
    } catch (e: any) {
      logWarn('[Scrobble] failed:', e?.message);
    }
  });
}

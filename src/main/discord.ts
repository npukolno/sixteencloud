import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { TrackInfo } from '../shared/types';
import { getStore } from './ipc';
import { logInfo } from './logger';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../shared/security';
import { t } from '../shared/i18n';
import { DiscordIpcClient } from './discord-ipc';

const DISCORD_CLIENT_ID = '1488109970095607908';
// Asset name in Discord Developer Portal — upload icon.png as 'sixteencloud' asset
const SIXTEENCLOUD_ICON = 'icon-1024';
const RETRY_INTERVAL_MS = 5000;
// Discord self-advances timestamps; only re-anchor after a seek larger than this.
const SEEK_TOLERANCE_SECONDS = 20;

interface DiscordActivity {
  type: number;
  details?: string;
  state?: string;
  timestamps?: { start?: number; end?: number };
  assets?: {
    large_image?: string;
    large_text?: string;
    small_image?: string;
    small_text?: string;
  };
  buttons?: Array<{ label: string; url: string }>;
  instance?: boolean;
}

let rpcClient: DiscordIpcClient | null = null;
let connected = false;
let connecting = false;
let currentTrack: TrackInfo | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let mainWin: BrowserWindow | null = null;
let lastError = '';
let lastEndpoint: string | null = null;
let lastActivityKey = '';
let timeAnchor: { key: string; start: number; end: number } | null = null;

function isEnabled(): boolean {
  const store = getStore();
  return !!store?.get('discordRp.enabled');
}

function sendState(): void {
  if (!mainWin || mainWin.isDestroyed() || mainWin.webContents.isDestroyed()) return;
  const store = getStore();
  const enabled = !!store?.get('discordRp.enabled');
  try {
    mainWin.webContents.send(IPC_CHANNELS.DISCORD_STATE, {
      connected,
      enabled,
      track: currentTrack,
      error: enabled && !connected ? (lastError || t('discord.not_running')) : undefined,
    });
  } catch { /* renderer may close between the checks and send */ }
}

async function connectRPC(): Promise<void> {
  if (connecting || rpcClient || !isEnabled()) return;

  connecting = true;
  lastError = '';
  const client = new DiscordIpcClient(DISCORD_CLIENT_ID);
  let ok = false;
  try {
    ok = await client.connect(lastEndpoint);
  } catch (err: any) {
    logInfo('[Discord RPC] connect error:', err?.message || err);
  }
  connecting = false;

  if (!ok || !client.isConnected) {
    client.disconnect();
    lastError = t('discord.not_running');
    sendState();
    scheduleRetry();
    return;
  }

  if (!isEnabled()) {
    client.disconnect();
    sendState();
    return;
  }

  rpcClient = client;
  connected = true;
  lastError = '';
  lastEndpoint = client.endpoint;
  logInfo('[Discord RPC] connected via', lastEndpoint || 'unknown endpoint');

  client.on('close', () => {
    if (rpcClient !== client) return;
    connected = false;
    rpcClient = null;
    lastActivityKey = '';
    timeAnchor = null;
    sendState();
    scheduleRetry();
  });

  sendState();
  updatePresence(true);
}

function scheduleRetry(): void {
  if (retryTimer) return;
  if (!isEnabled()) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    if (isEnabled()) {
      void connectRPC();
    }
  }, RETRY_INTERVAL_MS);
}

function clearPresence(): void {
  if (!rpcClient || !connected) return;
  if (lastActivityKey === '__cleared__') return;
  lastActivityKey = '__cleared__';
  rpcClient.setActivity(null).catch((err: any) => {
    logInfo('[Discord RPC] clear error:', err?.message || err);
  });
}

function buildActivity(
  showArtist: boolean,
  showTime: boolean,
  displaySmallIcon: boolean,
  displayButtons: boolean,
  useArtistName: boolean,
): DiscordActivity | null {
  if (!currentTrack) return null;

  const title = (currentTrack.title || 'Unknown Track').slice(0, 128);
  const artist = (currentTrack.artist || '').slice(0, 128);

  let artworkKey = 'soundcloud';
  if (currentTrack.artworkUrl && currentTrack.artworkUrl.startsWith('https://')) {
    artworkKey = currentTrack.artworkUrl;
  }

  const activity: DiscordActivity = {
    type: 2,
    details: title,
    state: showArtist && artist ? `by ${artist}` : undefined,
    assets: {
      large_image: artworkKey,
      large_text: 'SixteenCloud',
    },
    instance: false,
  };

  // "Artist as app name" — swap: bold line = artist, second line = track
  if (showArtist && artist && useArtistName) {
    activity.details = artist;
    activity.state = title;
  }

  if (displaySmallIcon) {
    activity.assets!.small_image = SIXTEENCLOUD_ICON;
    activity.assets!.small_text = 'SixteenCloud';
  }

  if (showTime && currentTrack.isPlaying && currentTrack.duration > 0) {
    const elapsedSeconds = Math.max(0, Math.min(currentTrack.duration, currentTrack.currentTime || 0));
    const anchorKey = `${currentTrack.trackUrl}|${title}|${currentTrack.duration}`;
    const predictedElapsed = timeAnchor && timeAnchor.key === anchorKey
      ? (Date.now() - timeAnchor.start) / 1000
      : Number.NaN;
    if (
      !timeAnchor
      || timeAnchor.key !== anchorKey
      || Math.abs(predictedElapsed - elapsedSeconds) > SEEK_TOLERANCE_SECONDS
    ) {
      const now = Date.now();
      timeAnchor = {
        key: anchorKey,
        start: now - elapsedSeconds * 1000,
        end: now + (currentTrack.duration - elapsedSeconds) * 1000,
      };
    }
    activity.timestamps = {
      start: Math.round(timeAnchor.start),
      end: Math.round(timeAnchor.end),
    };
  } else if (!currentTrack.isPlaying) {
    timeAnchor = null;
  }

  if (displayButtons && currentTrack.trackUrl) {
    let buttonUrl = currentTrack.trackUrl;
    try {
      const trackPath = new URL(currentTrack.trackUrl).pathname.replace(/^\//, '');
      if (trackPath) {
        buttonUrl = 'https://ocb2016.me/open?track=' + encodeURIComponent(trackPath);
      }
    } catch { /* use original URL if parsing fails */ }
    activity.buttons = [
      { label: 'Listen on SixteenCloud', url: buttonUrl },
    ];
  }

  return activity;
}

function updatePresence(force = false): void {
  if (!rpcClient || !connected) return;

  const store = getStore();
  if (!store || !store.get('discordRp.enabled')) return;

  if (!currentTrack) {
    clearPresence();
    return;
  }

  const displayWhenPaused = store.get('discordRp.displayWhenPaused');
  if (!currentTrack.isPlaying && !displayWhenPaused) {
    clearPresence();
    return;
  }

  const activity = buildActivity(
    store.get('discordRp.showArtist'),
    store.get('discordRp.showTime'),
    store.get('discordRp.displaySmallIcon'),
    store.get('discordRp.displayButtons'),
    store.get('discordRp.useArtistName'),
  );

  if (!activity) {
    clearPresence();
    return;
  }

  const key = JSON.stringify(activity);
  if (!force && key === lastActivityKey) return;
  lastActivityKey = key;

  rpcClient.setActivity(activity as unknown as Record<string, unknown>).catch((err: any) => {
    logInfo('[Discord RPC] set activity error:', err?.message || err);
  });
}

export function setupDiscordRPC(win: BrowserWindow): void {
  mainWin = win;

  // Listen for track info updates from renderer
  ipcMain.on(IPC_CHANNELS.TRACK_INFO, (event, info: TrackInfo) => {
    if (event.sender !== win.webContents) return;
    if (!info || typeof info !== 'object') return;
    const title = typeof info.title === 'string' ? info.title.trim().slice(0, 500) : '';
    const artist = typeof info.artist === 'string' ? info.artist.trim().slice(0, 500) : '';
    const artworkUrl = typeof info.artworkUrl === 'string' && isAllowedMediaUrl(info.artworkUrl) ? info.artworkUrl : '';
    const trackUrl = typeof info.trackUrl === 'string' && isTrustedSoundCloudUrl(info.trackUrl) ? info.trackUrl : '';
    const duration = typeof info.duration === 'number' && Number.isFinite(info.duration) ? Math.max(0, Math.min(86400, info.duration)) : 0;
    const currentTime = typeof info.currentTime === 'number' && Number.isFinite(info.currentTime) ? Math.max(0, Math.min(duration, info.currentTime)) : 0;
    currentTrack = { ...info, title, artist, artworkUrl, trackUrl, duration, currentTime, isPlaying: info.isPlaying === true };
    sendState();
    updatePresence();
  });

  // Toggle handler
  ipcMain.handle(IPC_CHANNELS.DISCORD_TOGGLE, async (event, enabled: boolean) => {
    if (event.sender !== win.webContents) throw new Error('Unauthorized IPC sender');
    if (enabled) {
      lastError = '';
      sendState();
      await connectRPC();
    } else {
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (rpcClient) {
        rpcClient.disconnect();
        rpcClient = null;
        connected = false;
      }
      lastActivityKey = '';
      timeAnchor = null;
      lastError = '';
      sendState();
    }
  });

  // Auto-connect if enabled
  if (isEnabled()) {
    void connectRPC();
  } else {
    sendState();
  }
}

export function destroyDiscordRPC(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (rpcClient) {
    rpcClient.disconnect();
    rpcClient = null;
  }
  connected = false;
  connecting = false;
  lastActivityKey = '';
  timeAnchor = null;
  mainWin = null;
}

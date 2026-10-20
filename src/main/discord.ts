import { BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { TrackInfo } from '../shared/types';
import { getStore } from './ipc';
import { logInfo } from './logger';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../shared/security';

const DISCORD_CLIENT_ID = '1488109970095607908';
// Asset name in Discord Developer Portal — upload icon.png as 'sixteencloud' asset
const SIXTEENCLOUD_ICON = 'icon-1024';

let rpcClient: any = null;
let connected = false;
let currentTrack: TrackInfo | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let mainWin: BrowserWindow | null = null;

async function connectRPC(): Promise<void> {
  if (connected || rpcClient) return;

  try {
    const DiscordRPC = require('discord-rpc');
    DiscordRPC.register(DISCORD_CLIENT_ID);
    rpcClient = new DiscordRPC.Client({ transport: 'ipc' });

    rpcClient.on('ready', () => {
      connected = true;
      // Patch request to inject type: 2 (LISTENING) into SET_ACTIVITY
      const origRequest = rpcClient.request.bind(rpcClient);
      rpcClient.request = function(cmd: string, payload: any) {
        if (cmd === 'SET_ACTIVITY' && payload && payload.activity) {
          payload.activity.type = 2;
        }
        return origRequest(cmd, payload);
      };
      sendState();
      updatePresence();
    });

    rpcClient.on('disconnected', () => {
      connected = false;
      rpcClient = null;
      sendState();
      scheduleRetry();
    });

    await rpcClient.login({ clientId: DISCORD_CLIENT_ID });
  } catch (err: any) {
    logInfo('[Discord RPC] connect error:', err?.message || err);
    connected = false;
    rpcClient = null;
    sendState();
    scheduleRetry();
  }
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    const store = getStore();
    if (store && store.get('discordRp.enabled')) {
      connectRPC();
    }
  }, 15000);
}

function sendState(): void {
  if (!mainWin || mainWin.isDestroyed() || mainWin.webContents.isDestroyed()) return;
  const store = getStore();
  try {
    mainWin.webContents.send(IPC_CHANNELS.DISCORD_STATE, {
      connected,
      enabled: !!store?.get('discordRp.enabled'),
      track: currentTrack,
    });
  } catch { /* renderer may close between the checks and send */ }
}

function updatePresence(): void {
  if (!rpcClient || !connected) return;

  const store = getStore();
  if (!store || !store.get('discordRp.enabled')) return;

  // If no track or track is paused and displayWhenPaused is off, clear presence
  if (!currentTrack) {
    try { rpcClient.clearActivity(); } catch { /* Expected: may fail during disconnect */ }
    return;
  }

  const displayWhenPaused = store.get('discordRp.displayWhenPaused');
  if (!currentTrack.isPlaying && !displayWhenPaused) {
    try { rpcClient.clearActivity(); } catch { /* Expected: may fail during disconnect */ }
    return;
  }

  const showArtist = store.get('discordRp.showArtist');
  const showTime = store.get('discordRp.showTime');
  const displaySmallIcon = store.get('discordRp.displaySmallIcon');
  const displayButtons = store.get('discordRp.displayButtons');
  const useArtistName = store.get('discordRp.useArtistName');

  // Discord RPC supports external URLs for images if they start with https://
  let artworkKey = 'soundcloud';
  if (currentTrack.artworkUrl && currentTrack.artworkUrl.startsWith('https://')) {
    artworkKey = currentTrack.artworkUrl;
  }

  // Discord RPC layout:
  // "Слушает SixteenCloud" — app name from Developer Portal
  // Line 1 (details): track title
  // Line 2 (state): by artist
  // Hover on artwork: track title
  const activity: any = {
    details: currentTrack.title || 'Unknown Track',
    state: showArtist && currentTrack.artist ? `by ${currentTrack.artist}` : undefined,
    largeImageKey: artworkKey,
    largeImageText: 'SixteenCloud',
    instance: false,
  };

  // "Artist as app name" — swap: bold line = artist, second line = track
  if (showArtist && currentTrack.artist && useArtistName) {
    activity.details = currentTrack.artist;
    activity.state = currentTrack.title || 'Unknown Track';
  }

  // Small icon — SixteenCloud logo
  if (displaySmallIcon) {
    activity.smallImageKey = SIXTEENCLOUD_ICON;
    activity.smallImageText = 'SixteenCloud';
  }

  // Timestamps
  if (showTime && currentTrack.isPlaying && currentTrack.duration > 0) {
    const now = Date.now();
    const elapsedSeconds = Math.max(0, Math.min(currentTrack.duration, currentTrack.currentTime || 0));
    const elapsed = elapsedSeconds * 1000;
    activity.startTimestamp = new Date(now - elapsed);
    activity.endTimestamp = new Date(now + (currentTrack.duration - elapsedSeconds) * 1000);
  }

  // Buttons — deep link via intermediate page (falls back to GitHub releases)
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

  try {
    rpcClient.setActivity(activity);
  } catch { /* Expected: may fail during disconnect */ }
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
      await connectRPC();
    } else {
      if (rpcClient) {
        try { rpcClient.clearActivity(); } catch { /* Expected: may fail during disconnect */ }
        try { rpcClient.destroy(); } catch { /* Expected: may fail during disconnect */ }
        rpcClient = null;
        connected = false;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      sendState();
    }
  });

  // Auto-connect if enabled
  const store = getStore();
  if (store && store.get('discordRp.enabled')) {
    connectRPC();
  }
}

export function destroyDiscordRPC(): void {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (rpcClient) {
    try { rpcClient.clearActivity(); } catch { /* Expected: may fail during disconnect */ }
    try { rpcClient.destroy(); } catch { /* Expected: may fail during disconnect */ }
    rpcClient = null;
    connected = false;
  }
  mainWin = null;
}

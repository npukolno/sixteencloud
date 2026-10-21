import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { installAudioHook } from './audio-hook';
import { installFingerprintAlignment } from './fingerprint';

// Install the audio graph hook in the page's main world before SoundCloud
// scripts run. Must happen from preload — page code may create its
// AudioContext at any moment after boot.
try {
  contextBridge.executeInMainWorld({ func: installAudioHook });
} catch (e) {
  console.warn('[SixteenCloud] audio hook injection failed:', e);
}

// Align navigator.userAgentData with the platform UA before page scripts run.
// A challenge that compares JS-visible client hints against the request
// headers must not see Electron's own brand list.
try {
  contextBridge.executeInMainWorld({ func: installFingerprintAlignment });
} catch (e) {
  console.warn('[SixteenCloud] fingerprint alignment injection failed:', e);
}

const api = {
  // Store
  storeGet: (key: string): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.STORE_GET, key),
  storeSet: (key: string, value: unknown): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.STORE_SET, key, value),

  // Geo-Bypass
  geoSetProxy: (proxyUrl: string, country: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.GEO_SET_PROXY, proxyUrl, country),
  geoTestProxy: (proxyUrl: string): Promise<boolean> =>
    ipcRenderer.invoke(IPC_CHANNELS.GEO_TEST_PROXY, proxyUrl),

  // Discord
  discordToggle: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DISCORD_TOGGLE, enabled),
  onDiscordState: (callback: (state: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DISCORD_STATE, (_event, state) => callback(state));
  },

  // Adblocker
  adToggle: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AD_TOGGLE, enabled),
  adUpdateLists: (): Promise<{success: boolean; count?: number; error?: string}> =>
    ipcRenderer.invoke(IPC_CHANNELS.AD_UPDATE_LISTS),
  onAdBlockCount: (callback: (count: number) => void) => {
    ipcRenderer.on(IPC_CHANNELS.AD_BLOCK_COUNT, (_event, count: number) => callback(count));
  },

  // Auth
  authSetToken: (token: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_SET_TOKEN, token),
  authValidate: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_VALIDATE),
  authLogout: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.AUTH_LOGOUT),
  onAuthState: (callback: (state: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.AUTH_STATE, (_event, state) => callback(state));
  },

  // Downloader
  downloadTrack: (request: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_TRACK, request),
  downloaderResolve: (trackUrl: string): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOADER_RESOLVE, trackUrl),
  downloadSetDir: (): Promise<string> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_SET_DIR),
  onDownloadProgress: (callback: (progress: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_PROGRESS, (_event, progress) => callback(progress));
  },
  onDownloadComplete: (callback: (result: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_COMPLETE, (_event, result) => callback(result));
  },

  // Track info from injected script
  sendTrackInfo: (info: unknown): void => {
    ipcRenderer.send(IPC_CHANNELS.TRACK_INFO, info);
  },

  // Cover-art palette for the player visualizer
  getCoverPalette: (url: string): Promise<{ primary: string; secondary: string; tertiary: string; accent: string } | null> =>
    ipcRenderer.invoke(IPC_CHANNELS.COVER_PALETTE, url),

  // Settings
  settingsClearCache: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.SETTINGS_CLEAR_CACHE),

  // Window controls
  windowMinimize: (): void => ipcRenderer.send(IPC_CHANNELS.WINDOW_MINIMIZE),
  windowMaximize: (): void => ipcRenderer.send(IPC_CHANNELS.WINDOW_MAXIMIZE),
  windowClose: (): void => ipcRenderer.send(IPC_CHANNELS.WINDOW_CLOSE),
  windowIsMaximized: (): Promise<boolean> => ipcRenderer.invoke(IPC_CHANNELS.WINDOW_IS_MAXIMIZED),

  // History
  historyGet: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_GET),
  historyClear: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_CLEAR),
  historySearch: (query: string): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.HISTORY_SEARCH, query),

  // Lyrics (duration in seconds sharpens source matching when known)
  lyricsFetch: (artist: string, title: string, duration?: number): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.LYRICS_FETCH, artist, title, duration),

  // Playlist download
  downloadPlaylist: (playlistUrl: string, pageToken?: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_PLAYLIST, playlistUrl, pageToken || ''),

  // Sidebar
  onSidebarToggle: (callback: () => void) => {
    ipcRenderer.on(IPC_CHANNELS.SIDEBAR_TOGGLE, () => callback());
  },
  sidebarNavigate: (url: string): void => {
    ipcRenderer.send(IPC_CHANNELS.SIDEBAR_NAVIGATE, url);
  },

  // Updater
  updaterCheck: (): Promise<unknown> => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_CHECK),
  onUpdaterStatus: (callback: (status: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATER_STATUS, (_event, status) => callback(status));
  },
  updaterDownload: (): Promise<void> => ipcRenderer.invoke(IPC_CHANNELS.UPDATER_DOWNLOAD),
  updaterInstall: (): void => ipcRenderer.send(IPC_CHANNELS.UPDATER_INSTALL),
  onUpdaterProgress: (callback: (progress: { percent: number }) => void) => {
    ipcRenderer.on(IPC_CHANNELS.UPDATER_PROGRESS, (_event, progress) => callback(progress));
  },

  // Media controls
  mediaPlayPause: (): void => ipcRenderer.send(IPC_CHANNELS.MEDIA_PLAY_PAUSE),
  mediaNext: (): void => ipcRenderer.send(IPC_CHANNELS.MEDIA_NEXT),
  mediaPrev: (): void => ipcRenderer.send(IPC_CHANNELS.MEDIA_PREV),

  // Download queue
  downloadQueueAdd: (request: unknown): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_QUEUE_ADD, request),
  downloadQueueRemove: (trackId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_QUEUE_REMOVE, trackId),
  downloadQueuePause: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_QUEUE_PAUSE),
  downloadQueueResume: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_QUEUE_RESUME),
  onDownloadQueueState: (callback: (state: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.DOWNLOAD_QUEUE_STATE, (_event, state) => callback(state));
  },

  // Download liked tracks
  downloadLiked: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.DOWNLOAD_LIKED),

  // Offline cache
  offlineCacheTrack: (data: unknown): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_CACHE_TRACK, data),
  offlineCacheRemove: (trackId: string): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_CACHE_REMOVE, trackId),
  offlineCacheList: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_CACHE_LIST),
  offlineCacheClear: (): Promise<void> =>
    ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_CACHE_CLEAR),
  offlineCacheStatus: (): Promise<unknown> =>
    ipcRenderer.invoke(IPC_CHANNELS.OFFLINE_CACHE_STATUS),

  // Mini-player
  miniPlayerToggle: (): void =>
    ipcRenderer.send(IPC_CHANNELS.MINI_PLAYER_TOGGLE),
  onMiniPlayerUpdate: (callback: (info: unknown) => void) => {
    ipcRenderer.on(IPC_CHANNELS.MINI_PLAYER_UPDATE, (_event, info) => callback(info));
  },
};

contextBridge.exposeInMainWorld('sixteenCloud', api);

export type SixteenCloudAPI = typeof api;

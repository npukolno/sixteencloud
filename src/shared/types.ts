import type { VisualizerType } from './constants';

export interface TrackInfo {
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
  currentTime: number;
  isPlaying: boolean;
  trackUrl: string;
  trackId: string;
}

declare global {
  interface Window {
    __scEscapeHtml: (value: unknown) => string;
    __scIsTrustedSoundCloudUrl: (value: unknown) => boolean;
    __scNavigate: (url: string) => boolean;
    __scVolumeStep: (delta: number) => boolean;
    __scVizSetEnabled?: (enabled: boolean) => void;
    __scVizGetEnabled?: () => boolean;
    __scVizSetType?: (type: string) => void;
    __scVizGetType?: () => string;
  }
}

export interface DownloadRequest {
  trackUrl: string;
  trackId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  quality: '128' | '256' | 'original';
  album?: string;
  trackNumber?: number;
}

export interface HistoryStats {
  dataVersion: number;
  tracksTotal: number;
  secondsTotal: number;
  artists: Record<string, number>;
  days: Record<string, number>;
  tracks: Record<string, { count: number; title: string; artist: string; artworkUrl: string; url: string }>;
}

export interface HistoryTrack {
  title: string;
  artist: string;
  artworkUrl: string;
  trackUrl: string;
  timestamp: string;
  duration: number;
}

export interface SidebarBookmark {
  name: string;
  url: string;
  type: 'track' | 'playlist' | 'artist';
  /** Cover thumbnail (sndcdn.com only). */
  artwork?: string;
  /** Shown in the Pinned section at the top. */
  pinned?: boolean;
  /** Folder name; unset means "no folder". */
  folder?: string;
  /** Timecode bookmark: seconds into the track to jump to. */
  time?: number;
}

export interface MiniPlayerState {
  title: string;
  artist: string;
  artworkUrl: string;
  isPlaying: boolean;
  position: number;
  duration: number;
  volume: number;
  trackUrl: string;
}

export interface StoreSchema {
  language: 'en' | 'ru';
  geoBypass: {
    enabled: boolean;
    proxyUrl: string;
    spoofCountry: string;
  };
  discordRp: {
    enabled: boolean;
    showArtist: boolean;
    showTime: boolean;
    displayWhenPaused: boolean;
    displaySmallIcon: boolean;
    displayButtons: boolean;
    useArtistName: boolean;
    enablePreview: boolean;
  };
  firstLaunch: boolean;
  adblocker: {
    enabled: boolean;
    blockedCount: number;
    customRules: string[];
    whitelist: string[];
    remoteDomains: string[];
    lastUpdated?: string;
  };
  authToken: {
    token: string;
  };
  downloader: {
    outputDir: string;
    quality: '128' | '256' | 'original';
    history: Array<{ title: string; artist: string; date: string; path: string }>;
  };
  settings: {
    startMinimized: boolean;
    launchOnStartup: boolean;
    accentColor: string;
    dynamicAccent: boolean;
    autoUpdate: boolean;
    keybinds: Record<string, string>;
    /** Side rail hidden behind its edge handle (rail keybind). */
    railHidden?: boolean;
    /** Drop the visualizer, blur and animations while on battery (default on). */
    batterySaver?: boolean;
    /** Cover-palette glow above the player bar (default on). */
    ambient?: boolean;
  };
  history: {
    enabled: boolean;
    maxTracks: number;
    tracks: HistoryTrack[];
    stats: HistoryStats;
  };
  lyrics: {
    fontSize: number;
  };
  player: {
    skipPromoted: boolean;
    skipPreviews: boolean;
    notifications: boolean;
    scrobble: boolean;
    speed: number;
    /** Jump back to the remembered position after a restart (default on). */
    resume?: boolean;
    /** Seconds per seek step (5, 10, 15 or 30; default 10). */
    seekStep?: number;
    /** Reposts in the home feed: shown, folded or dropped (default show). */
    reposts?: 'show' | 'collapse' | 'hide';
  };
  searchHistory: string[];
  themes: {
    active: string;
    custom: Record<string, { name: string; palette: Record<string, string> }>;
  };
  customCss: {
    code: string;
  };
  equalizer: {
    enabled: boolean;
    preset: string;
    bands: number[];
    customPresets: Record<string, number[]>;
  };
  /** Preamp and limiter / leveller on the master bus (shared/audio-fx.ts). */
  audioFx: {
    preamp: number;
    mode: 'off' | 'limiter' | 'normalize';
  };
  visualizer: {
    enabled: boolean;
    type: VisualizerType;
    colorScheme: string;
    version?: number;
  };
  sidebar: {
    bookmarks: SidebarBookmark[];
  };
  offlineCache: {
    enabled: boolean;
    autoCache: boolean;
    maxSizeMB: number;
    tracks: Array<{
      trackId: string;
      title: string;
      artist: string;
      artworkUrl: string;
      duration: number;
      cachedAt: string;
      fileSize: number;
    }>;
  };
  miniPlayer: {
    bounds: { x: number; y: number } | null;
  };
}

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
    autoUpdate: boolean;
    keybinds: Record<string, string>;
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
  visualizer: {
    enabled: boolean;
    type: 'bars' | 'wave' | 'circular';
    colorScheme: string;
    version?: number;
  };
  crossfade: {
    enabled: boolean;
    duration: number;
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
}

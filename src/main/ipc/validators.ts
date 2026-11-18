// Pure input validation for IPC payloads. No electron imports here, so the
// test suite can load this module under plain node.
import { VISUALIZER_TYPES } from '../../shared/constants';
import type { DownloadRequest } from '../../shared/types';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../../shared/security';
import { KEYBIND_ACTIONS, parseCombo } from '../../shared/keybinds';
import { isAudioFxState } from '../../shared/audio-fx';

export const STORE_KEYS: ReadonlySet<string> = new Set([
  'language', 'firstLaunch', 'geoBypass', 'geoBypass.enabled', 'geoBypass.proxyUrl', 'geoBypass.spoofCountry',
  'discordRp', 'discordRp.enabled', 'discordRp.showArtist', 'discordRp.showTime', 'discordRp.displayWhenPaused',
  'discordRp.displaySmallIcon', 'discordRp.displayButtons', 'discordRp.useArtistName', 'discordRp.enablePreview',
  'adblocker', 'adblocker.enabled', 'adblocker.blockedCount', 'adblocker.customRules', 'adblocker.whitelist',
  'adblocker.remoteDomains', 'adblocker.lastUpdated', 'downloader', 'downloader.outputDir', 'downloader.quality',
  'downloader.history', 'settings', 'settings.startMinimized', 'settings.launchOnStartup', 'settings.accentColor',
  'settings.dynamicAccent', 'settings.batterySaver', 'settings.ambient', 'player', 'player.skipPromoted', 'player.skipPreviews', 'player.notifications', 'player.scrobble', 'player.resume', 'player.speed', 'player.seekStep', 'searchHistory', 'wave',
  'settings.autoUpdate', 'settings.keybinds', 'history', 'history.enabled', 'history.maxTracks', 'history.tracks', 'history.stats', 'lyrics',
  'lyrics.fontSize', 'themes', 'themes.active', 'themes.custom', 'customCss', 'customCss.code', 'equalizer', 'audioFx', 'visualizer',
  'sidebar',
  'sidebar.bookmarks', 'offlineCache', 'offlineCache.enabled', 'offlineCache.autoCache', 'offlineCache.maxSizeMB',
  'offlineCache.tracks',
]);

export const READ_ONLY_STORE_KEYS: ReadonlySet<string> = new Set([
  'adblocker.blockedCount', 'adblocker.remoteDomains', 'adblocker.lastUpdated',
  'downloader', 'downloader.outputDir', 'downloader.history', 'history', 'offlineCache', 'offlineCache.tracks',
]);

const BOOLEAN_KEYS: ReadonlySet<string> = new Set([
  'settings.dynamicAccent', 'settings.batterySaver', 'settings.ambient', 'player.skipPromoted', 'player.skipPreviews',
  'player.notifications', 'player.scrobble', 'player.resume',
]);

export function validateStoreKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !STORE_KEYS.has(key)) throw new Error('Unknown store key');
}

export function validateStoreValue(key: string, value: unknown): void {
  if (key === 'language' && value !== 'en' && value !== 'ru') throw new Error('Invalid language');
  if (key === 'downloader.quality' && value !== '128' && value !== '256' && value !== 'original') throw new Error('Invalid quality');
  if (key === 'geoBypass.proxyUrl' && value !== '' && (typeof value !== 'string' || value.length > 2048 || !/^(https?|socks5):\/\//i.test(value))) {
    throw new Error('Invalid proxy URL');
  }
  if (key === 'settings.accentColor' && (typeof value !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(value))) {
    throw new Error('Invalid accent color');
  }
  if (BOOLEAN_KEYS.has(key) && typeof value !== 'boolean') throw new Error('Invalid flag');
  if (key === 'player.speed' && (typeof value !== 'number' || !Number.isFinite(value) || value < 0.25 || value > 3)) {
    throw new Error('Invalid speed');
  }
  if (key === 'player.seekStep' && value !== 5 && value !== 10 && value !== 15 && value !== 30) {
    throw new Error('Invalid seek step');
  }
  if (key === 'wave') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || JSON.stringify(value).length > 250000) throw new Error('Invalid wave data');
  }
  if (key === 'searchHistory' && (!Array.isArray(value) || value.length > 30 || value.some((v) => typeof v !== 'string' || v.length > 200))) {
    throw new Error('Invalid search history');
  }
  if (key === 'lyrics.fontSize' && (typeof value !== 'number' || !Number.isFinite(value) || value < 8 || value > 72)) {
    throw new Error('Invalid font size');
  }
  if (key === 'offlineCache.maxSizeMB' && (typeof value !== 'number' || !Number.isFinite(value) || value < 50 || value > 2048)) {
    throw new Error('Invalid cache size');
  }
  if (key === 'history.maxTracks' && (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > 10000)) {
    throw new Error('Invalid history limit');
  }
  if (key === 'history.stats' && (!value || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error('Invalid history stats');
  }
  if (key === 'settings.keybinds') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid keybinds');
    for (const [action, combo] of Object.entries(value)) {
      if (!(KEYBIND_ACTIONS as readonly string[]).includes(action) || typeof combo !== 'string' || !parseCombo(combo)) {
        throw new Error('Invalid keybind');
      }
    }
  }
  if (key === 'equalizer') {
    const state = value as { enabled?: unknown; preset?: unknown; bands?: unknown } | null;
    if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.enabled !== 'boolean' ||
        typeof state.preset !== 'string' || !Array.isArray(state.bands) || state.bands.length !== 10 ||
        state.bands.some((band: unknown) => typeof band !== 'number' || !Number.isFinite(band) || band < -12 || band > 12)) {
      throw new Error('Invalid equalizer state');
    }
  }
  if (key === 'audioFx' && !isAudioFxState(value)) throw new Error('Invalid audio effects state');
  if (key === 'visualizer') {
    const state = value as { enabled?: unknown; type?: unknown; lyricsRing?: unknown } | null;
    if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.enabled !== 'boolean' ||
        !(VISUALIZER_TYPES as readonly unknown[]).includes(state.type) ||
        (state.lyricsRing !== undefined && typeof state.lyricsRing !== 'boolean')) {
      throw new Error('Invalid visualizer state');
    }
  }
  const serialized = (() => { try { return JSON.stringify(value); } catch { return ''; } })();
  if (!serialized || serialized.length > 2_000_000) throw new Error('Store value is too large');
}

export function validateDownloadRequest(input: unknown): DownloadRequest {
  if (!input || typeof input !== 'object') throw new Error('Invalid download request');
  const request = input as Partial<DownloadRequest>;
  const text = (value: unknown, name: string, max: number): string => {
    if (typeof value !== 'string' || value.length === 0 || value.length > max) throw new Error(`Invalid ${name}`);
    return value;
  };
  const trackUrl = text(request.trackUrl, 'track URL', 2048);
  if (!isTrustedSoundCloudUrl(trackUrl)) throw new Error('Track URL must be an HTTPS SoundCloud URL');
  const quality = request.quality;
  if (quality !== '128' && quality !== '256' && quality !== 'original') throw new Error('Invalid quality');
  const artworkUrl = typeof request.artworkUrl === 'string' ? request.artworkUrl : '';
  if (artworkUrl && !isAllowedMediaUrl(artworkUrl)) throw new Error('Invalid artwork URL');
  return {
    trackUrl,
    trackId: text(request.trackId, 'track ID', 256),
    title: text(request.title, 'title', 500),
    artist: text(request.artist, 'artist', 500),
    artworkUrl,
    quality,
    album: request.album === undefined ? undefined : text(request.album, 'album', 500),
    trackNumber: request.trackNumber === undefined ? undefined : Math.max(1, Math.min(10000, Number(request.trackNumber) || 1)),
  };
}

/** "Save the playing track for offline" from the player bar (quick-actions.ts). */
export interface OfflineQuickRequest {
  trackUrl: string;
  trackId: string;
  title: string;
  artist: string;
  artworkUrl: string;
  duration: number;
}

export function validateOfflineQuickRequest(input: unknown): OfflineQuickRequest {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('Invalid offline request');
  const raw = input as Record<string, unknown>;
  const trackUrl = typeof raw.trackUrl === 'string' ? raw.trackUrl : '';
  if (!trackUrl || trackUrl.length > 2048 || !isTrustedSoundCloudUrl(trackUrl)) throw new Error('Track URL must be an HTTPS SoundCloud URL');
  // Same id the auto-cache derives: the page path, never the query (?in=...).
  const trackId = new URL(trackUrl).pathname.replace(/^\/+|\/+$/g, '').slice(0, 256);
  if (!trackId || trackId.split('/').length < 2) throw new Error('Not a track URL');
  const text = (value: unknown) => (typeof value === 'string' ? value.trim().slice(0, 500) : '');
  const artworkUrl = typeof raw.artworkUrl === 'string' && raw.artworkUrl && isAllowedMediaUrl(raw.artworkUrl) ? raw.artworkUrl : '';
  const duration = typeof raw.duration === 'number' && Number.isFinite(raw.duration) && raw.duration >= 0 && raw.duration < 86400 * 2
    ? raw.duration : 0;
  return { trackUrl, trackId, title: text(raw.title), artist: text(raw.artist), artworkUrl, duration };
}

/** True when the bytes are an HLS playlist rather than audio. */
export function isHlsPlaylistBuffer(buf: Uint8Array): boolean {
  return buf.length > 6 && Buffer.from(buf.subarray(0, 7)).toString('latin1') === '#EXTM3U';
}

/** A file name safe on Windows, macOS and Linux (no path separators or reserved characters). */
export function safeFileName(name: string, max = 200): string {
  return name.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').substring(0, max);
}

/** SoundCloud artwork URL rewritten to the 500x500 variant used for ID3 covers. */
export function coverArtUrl(artworkUrl: string): string {
  let artUrl = artworkUrl.replace(/-large\./, '-t500x500.').replace(/-[a-z0-9]+x[a-z0-9]+\./, '-t500x500.');
  if (!artUrl.includes('t500x500')) artUrl = artUrl.replace(/-\w+(\.\w+)$/, '-t500x500$1');
  return artUrl;
}

/** Escape a value for an ffmpeg `-metadata key=value` argument. */
export function escapeFfmpegMeta(val: string): string {
  return val.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/;/g, '\\;').replace(/\n/g, ' ');
}

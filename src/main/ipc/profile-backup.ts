// Settings profile backup: everything a user customises, in one JSON file.
// Pure (no electron imports) so the tests can load it under plain node.
//
// Export walks a fixed whitelist of store keys. Secrets (OAuth and
// ListenBrainz tokens), local paths and listening data are never part of it,
// and a proxy URL that carries credentials is left out. Import accepts only
// whitelisted keys and runs every value through the same validateStoreValue
// the renderer's store:set goes through, plus a shape check per key.

import { READ_ONLY_STORE_KEYS, STORE_KEYS, validateStoreValue } from './validators';

export const PROFILE_KIND = 'sixteencloud-settings';
export const PROFILE_VERSION = 1;
/** Upper bound for an imported file, checked before parsing. */
export const PROFILE_MAX_BYTES = 2 * 1024 * 1024;

type Shape = (value: unknown) => boolean;

const bool: Shape = (v) => typeof v === 'boolean';
const str = (max: number): Shape => (v) => typeof v === 'string' && v.length <= max;
const num = (min: number, max: number): Shape => (v) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
const strList = (maxItems: number, maxLen: number): Shape => (v) =>
  Array.isArray(v) && v.length <= maxItems && v.every((s) => typeof s === 'string' && s.length <= maxLen);
const plainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const HEX = /^#[0-9a-f]{3,8}$/i;

const customThemes: Shape = (v) => {
  if (!plainObject(v)) return false;
  const ids = Object.keys(v);
  if (ids.length > 200) return false;
  return ids.every((id) => {
    const theme = v[id];
    if (!/^custom_[a-zA-Z0-9_-]{1,80}$/.test(id) || !plainObject(theme)) return false;
    if (typeof theme.name !== 'string' || !theme.name.trim() || theme.name.length > 80) return false;
    const palette = theme.palette;
    return plainObject(palette) && Object.keys(palette).length <= 16 &&
      Object.values(palette).every((c) => typeof c === 'string' && HEX.test(c));
  });
};

const discordRp: Shape = (v) => plainObject(v) && Object.keys(v).length <= 20 && Object.values(v).every((x) => typeof x === 'boolean');

const bookmarks: Shape = (v) => Array.isArray(v) && v.length <= 1000 && v.every((b) =>
  plainObject(b) && typeof b.url === 'string' && typeof b.name === 'string');

const audioFx: Shape = (v) => plainObject(v);

/** Every key a profile may carry, with the shape its value must have. */
export const PROFILE_SCHEMA: Readonly<Record<string, Shape>> = {
  'language': (v) => v === 'en' || v === 'ru',
  'settings.accentColor': str(9),
  'settings.dynamicAccent': bool,
  'settings.batterySaver': bool,
  'settings.ambient': bool,
  'settings.autoUpdate': bool,
  'settings.startMinimized': bool,
  'settings.launchOnStartup': bool,
  'settings.keybinds': plainObject,
  'player.skipPromoted': bool,
  'player.skipPreviews': bool,
  'player.notifications': bool,
  'player.scrobble': bool,
  'player.resume': bool,
  'player.speed': num(0.25, 3),
  'player.seekStep': num(1, 60),
  'player.reposts': str(16),
  'lyrics.fontSize': num(8, 72),
  'themes.active': str(100),
  'themes.custom': customThemes,
  'customCss.code': str(500_000),
  'equalizer': plainObject,
  'audioFx': audioFx,
  'visualizer': plainObject,
  'sidebar.bookmarks': bookmarks,
  'adblocker.enabled': bool,
  'adblocker.customRules': strList(2000, 500),
  'adblocker.whitelist': strList(2000, 500),
  'discordRp': discordRp,
  'geoBypass.enabled': bool,
  'geoBypass.spoofCountry': (v) => typeof v === 'string' && /^[A-Z]{2}$/.test(v),
  'geoBypass.proxyUrl': str(2048),
  'offlineCache.enabled': bool,
  'offlineCache.autoCache': bool,
  'offlineCache.maxSizeMB': num(50, 2048),
  'history.enabled': bool,
  'history.maxTracks': num(0, 10000),
  'downloader.quality': (v) => v === '128' || v === '256' || v === 'original',
};

export const PROFILE_KEYS: readonly string[] = Object.keys(PROFILE_SCHEMA);

export interface SettingsProfile {
  kind: typeof PROFILE_KIND;
  version: number;
  app: string;
  exportedAt: string;
  values: Record<string, unknown>;
}

/** A proxy URL with user:password in it is a credential, not a setting. */
function proxyHasCredentials(value: unknown): boolean {
  if (typeof value !== 'string' || !value) return false;
  try { const u = new URL(value); return !!(u.username || u.password); } catch { return /@/.test(value); }
}

/** Build the export from a store getter (keys that are unset are skipped). */
export function buildProfile(get: (key: string) => unknown, appVersion: string, now = new Date()): SettingsProfile {
  const values: Record<string, unknown> = {};
  for (const key of PROFILE_KEYS) {
    const value = get(key);
    if (value === undefined || value === null) continue;
    if (key === 'geoBypass.proxyUrl' && proxyHasCredentials(value)) continue;
    // Never export something the import would reject.
    if (!PROFILE_SCHEMA[key](value)) continue;
    values[key] = JSON.parse(JSON.stringify(value));
  }
  return { kind: PROFILE_KIND, version: PROFILE_VERSION, app: `SixteenCloud ${appVersion}`, exportedAt: now.toISOString(), values };
}

export interface ProfileImport {
  /** Values that passed every check, ready for store.set. */
  values: Record<string, unknown>;
  /** Keys that were present but not applied, with the reason. */
  skipped: Array<{ key: string; reason: string }>;
}

/** Parse and validate an imported file. Throws only when the file is not a profile at all. */
export function parseProfile(text: string): ProfileImport {
  if (typeof text !== 'string' || text.length > PROFILE_MAX_BYTES) throw new Error('Profile file is too large');
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error('Not a JSON file'); }
  if (!plainObject(data) || data.kind !== PROFILE_KIND) throw new Error('Not a SixteenCloud settings file');
  if (typeof data.version !== 'number' || data.version < 1 || data.version > PROFILE_VERSION) throw new Error('Unsupported settings file version');
  if (!plainObject(data.values)) throw new Error('Settings file has no values');

  const values: Record<string, unknown> = {};
  const skipped: ProfileImport['skipped'] = [];
  for (const [key, value] of Object.entries(data.values)) {
    const shape = Object.prototype.hasOwnProperty.call(PROFILE_SCHEMA, key) ? PROFILE_SCHEMA[key] : undefined;
    if (!shape || !STORE_KEYS.has(key) || READ_ONLY_STORE_KEYS.has(key)) { skipped.push({ key, reason: 'not allowed' }); continue; }
    if (key === 'geoBypass.proxyUrl' && proxyHasCredentials(value)) { skipped.push({ key, reason: 'credentials' }); continue; }
    if (!shape(value)) { skipped.push({ key, reason: 'invalid' }); continue; }
    try {
      validateStoreValue(key, value);
    } catch (e) {
      skipped.push({ key, reason: e instanceof Error ? e.message : 'invalid' });
      continue;
    }
    values[key] = value;
  }
  return { values, skipped };
}

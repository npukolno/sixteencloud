import { app, BrowserWindow, ipcMain, Notification, nativeImage, net } from 'electron';
import type { IpcMainEvent, NativeImage } from 'electron';
import { createHash } from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { pathToFileURL } from 'url';
import { APP_NAME, IPC_CHANNELS } from '../shared/constants';
import { TrackInfo } from '../shared/types';
import { logInfo, logWarn } from './logger';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../shared/security';
import { readResponseBuffer } from './ipc';

type MprisPlaybackStatus = 'Playing' | 'Paused' | 'Stopped';

interface MprisPlayer {
  playbackStatus: MprisPlaybackStatus;
  metadata: Record<string, unknown>;
  getPosition?: () => number;
  on(event: string, handler: (...args: unknown[]) => void): void;
  removeAllListeners?: () => void;
  destroy?: () => void;
}

type MprisFactory = (options: Record<string, unknown>) => MprisPlayer;

interface LinuxDesktopPaths {
  configDir: string;
  cacheDir: string;
  dataDir: string;
  stateDir: string;
  logsDir: string;
  sessionDir: string;
  artworkDir: string;
}

interface ArtworkAsset {
  filePath: string;
  fileUri: string;
  image: NativeImage;
}

let mprisPlayer: MprisPlayer | null = null;
let trackInfoListener: ((event: IpcMainEvent, info: TrackInfo) => void) | null = null;
let currentTrack: TrackInfo | null = null;
let lastTrackKey: string | null = null;
let hasSeenFirstTrack = false;
let trackUpdateSequence = 0;

let linuxPathsCache: LinuxDesktopPaths | null = null;
let defaultArtworkAsset: ArtworkAsset | null = null;
const artworkAssetCache = new Map<string, ArtworkAsset>();
// Decoded 500x500 covers cost ~1 MB each as NativeImage; 120 entries kept
// roughly 120 MB of main-process RSS alive for artwork that is no longer on
// screen. Keep a short recent window instead.
const ARTWORK_MEMORY_LIMIT = 48;
const ARTWORK_DISK_LIMIT = 300;
let artworkDiskPruned = false;

function getXdgBaseDir(envName: string, fallbackRelativeToHome: string): string {
  const value = process.env[envName];
  if (value && path.isAbsolute(value)) return value;
  return path.join(os.homedir(), fallbackRelativeToHome);
}

function ensureDir(dirPath: string): string {
  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }
  return dirPath;
}

function getLinuxDesktopPaths(): LinuxDesktopPaths {
  if (linuxPathsCache) return linuxPathsCache;

  const configHome = getXdgBaseDir('XDG_CONFIG_HOME', '.config');
  const cacheHome = getXdgBaseDir('XDG_CACHE_HOME', '.cache');
  const dataHome = getXdgBaseDir('XDG_DATA_HOME', path.join('.local', 'share'));
  const stateHome = getXdgBaseDir('XDG_STATE_HOME', path.join('.local', 'state'));

  const configDir = ensureDir(path.join(configHome, APP_NAME));
  const cacheDir = ensureDir(path.join(cacheHome, APP_NAME));
  const dataDir = ensureDir(path.join(dataHome, APP_NAME));
  const stateDir = ensureDir(path.join(stateHome, APP_NAME));
  const logsDir = ensureDir(path.join(stateDir, 'logs'));
  const sessionDir = ensureDir(path.join(cacheDir, 'session'));
  const artworkDir = ensureDir(path.join(cacheDir, 'artwork'));

  linuxPathsCache = { configDir, cacheDir, dataDir, stateDir, logsDir, sessionDir, artworkDir };
  return linuxPathsCache;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeArtworkUrl(artworkUrl: string): string {
  if (!artworkUrl) return '';
  let normalized = artworkUrl
    .replace(/-t50x50\./, '-t500x500.')
    .replace(/-t120x120\./, '-t500x500.')
    .replace(/-t200x200\./, '-t500x500.')
    .replace(/-large\./, '-t500x500.')
    .replace(/-[a-z0-9]+x[a-z0-9]+\./, '-t500x500.');
  if (normalized.startsWith('//')) {
    normalized = `https:${normalized}`;
  }
  return normalized;
}

function getBundledIconPath(): string {
  const preferred = path.join(__dirname, '../../assets/icons/icon-512.png');
  if (fs.existsSync(preferred)) return preferred;
  return path.join(__dirname, '../../assets/icons/icon.png');
}

function createFileUri(filePath: string): string {
  return pathToFileURL(filePath).toString();
}

function getDefaultArtworkAsset(): ArtworkAsset {
  if (defaultArtworkAsset) return defaultArtworkAsset;
  const iconPath = getBundledIconPath();
  const icon = nativeImage.createFromPath(iconPath);
  defaultArtworkAsset = {
    filePath: iconPath,
    fileUri: createFileUri(iconPath),
    image: icon.isEmpty() ? nativeImage.createEmpty() : icon,
  };
  return defaultArtworkAsset;
}

function getTrackKey(info: TrackInfo): string {
  const title = (info.title || '').trim();
  const artist = (info.artist || '').trim();
  const url = (info.trackUrl || '').trim();
  if (url) return url;
  if (!title) return '';
  return `${artist}::${title}`;
}

function toMprisTrackId(info: TrackInfo): string {
  const seed = getTrackKey(info) || 'unknown';
  const slug = seed
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 120);
  return `/org/mpris/MediaPlayer2/track/${slug || 'unknown'}`;
}

function buildMprisMetadata(info: TrackInfo, artworkUri: string): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    'mpris:trackid': toMprisTrackId(info),
    'xesam:title': info.title || 'Unknown Track',
    'xesam:artist': info.artist ? [info.artist] : [APP_NAME],
    'xesam:album': 'SoundCloud',
    'xesam:url': info.trackUrl || 'https://soundcloud.com',
    'mpris:artUrl': artworkUri,
  };
  if (info.duration > 0) {
    metadata['mpris:length'] = Math.round(info.duration * 1_000_000);
  }
  return metadata;
}

function executePlayerScript(win: BrowserWindow, script: string, action: string): void {
  if (win.isDestroyed()) return;
  win.webContents.executeJavaScript(script).catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(`[Linux] Failed to execute action "${action}": ${message}`);
  });
}

function getDesktopExecLine(): string {
  if (process.env.APPIMAGE) {
    return `"${process.env.APPIMAGE}" %U`;
  }
  if (process.defaultApp) {
    // argv can start with switches (electron --remote-debugging-port=... .), so
    // take the first non-switch argument as the app entry point.
    const entry = process.argv.slice(1).find((arg) => !arg.startsWith('-'));
    if (entry) return `"${process.execPath}" "${path.resolve(entry)}" %U`;
  }
  return `"${process.execPath}" %U`;
}

function writeDesktopEntry(): void {
  const dataHome = getXdgBaseDir('XDG_DATA_HOME', path.join('.local', 'share'));
  const applicationsDir = ensureDir(path.join(dataHome, 'applications'));
  const iconTargetDir = ensureDir(path.join(dataHome, 'icons', 'hicolor', '512x512', 'apps'));

  const desktopEntryPath = path.join(applicationsDir, 'SixteenCloud.desktop');
  const desktopIconPath = path.join(iconTargetDir, 'sixteencloud.png');

  const sourceIcon = getBundledIconPath();
  fs.copyFileSync(sourceIcon, desktopIconPath);

  const desktopEntry = [
    '[Desktop Entry]',
    'Type=Application',
    'Version=1.0',
    `Name=${APP_NAME}`,
    `X-GNOME-FullName=${APP_NAME}`,
    'GenericName=Music Player',
    'Comment=SoundCloud desktop client',
    `Exec=${getDesktopExecLine()}`,
    'Terminal=false',
    'Icon=sixteencloud',
    'Categories=AudioVideo;Player;',
    'MimeType=x-scheme-handler/sixteencloud;',
    'StartupNotify=true',
    `StartupWMClass=${APP_NAME}`,
    'X-DBUS-ServiceName=org.mpris.MediaPlayer2.sixteencloud',
    '',
  ].join('\n');

  fs.writeFileSync(desktopEntryPath, desktopEntry, { encoding: 'utf-8', mode: 0o644 });
  logInfo(`[Linux] Desktop entry updated: ${desktopEntryPath}`);
}

function getArtworkExtension(artworkUrl: string): string {
  try {
    const ext = path.extname(new URL(artworkUrl).pathname).toLowerCase();
    if (ext === '.png' || ext === '.webp' || ext === '.jpg' || ext === '.jpeg') return ext;
  } catch {
    // noop
  }
  return '.jpg';
}

function pruneArtworkDisk(dir: string): void {
  if (artworkDiskPruned) return;
  artworkDiskPruned = true;
  try {
    const entries = fs.readdirSync(dir)
      .map((name) => {
        const filePath = path.join(dir, name);
        try {
          const stat = fs.statSync(filePath);
          return stat.isFile() ? { filePath, mtime: stat.mtimeMs } : null;
        } catch {
          return null;
        }
      })
      .filter((entry): entry is { filePath: string; mtime: number } => entry !== null)
      .sort((a, b) => b.mtime - a.mtime);
    for (const entry of entries.slice(ARTWORK_DISK_LIMIT)) {
      try { fs.unlinkSync(entry.filePath); } catch { /* ignore */ }
    }
  } catch {
    // Cache pruning is best-effort and must never block playback metadata.
  }
}

async function resolveArtworkAsset(artworkUrl: string): Promise<ArtworkAsset | null> {
  const normalizedUrl = normalizeArtworkUrl(artworkUrl);
  if (!normalizedUrl) return null;

  const cached = artworkAssetCache.get(normalizedUrl);
  if (cached && fs.existsSync(cached.filePath)) {
    return cached;
  }

  const paths = getLinuxDesktopPaths();
  const hash = createHash('sha1').update(normalizedUrl).digest('hex');
  const filePath = path.join(paths.artworkDir, `${hash}${getArtworkExtension(normalizedUrl)}`);

  try {
    if (!fs.existsSync(filePath)) {
      const resp = await net.fetch(normalizedUrl);
      if (!resp.ok) {
        logWarn(`[Linux] Artwork fetch failed (${resp.status}) for ${normalizedUrl}`);
        return null;
      }
      const buffer = await readResponseBuffer(resp, 20 * 1024 * 1024);
      if (buffer.length === 0) return null;
      fs.writeFileSync(filePath, buffer, { mode: 0o644 });
    }

    let image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      const buf = fs.readFileSync(filePath);
      image = nativeImage.createFromBuffer(buf);
    }
    if (image.isEmpty()) {
      return null;
    }

    const asset: ArtworkAsset = {
      filePath,
      fileUri: createFileUri(filePath),
      image,
    };
    artworkAssetCache.set(normalizedUrl, asset);
    if (artworkAssetCache.size > ARTWORK_MEMORY_LIMIT) {
      const oldest = artworkAssetCache.keys().next().value as string | undefined;
      if (oldest) artworkAssetCache.delete(oldest);
    }
    pruneArtworkDisk(paths.artworkDir);
    return asset;
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(`[Linux] Artwork resolve error: ${message}`);
    return null;
  }
}

function createRoundedImage(image: NativeImage, size: number, radius: number): NativeImage {
  if (image.isEmpty()) return image;
  const resized = image.resize({ width: size, height: size, quality: 'best' });
  const { width, height } = resized.getSize();
  const bitmap = Buffer.from(resized.toBitmap());
  if (!width || !height || bitmap.length < width * height * 4) return resized;

  const r = Math.max(0, Math.min(radius, Math.floor(Math.min(width, height) / 2)));
  const rSq = r * r;
  for (let y = 0; y < r; y += 1) {
    for (let x = 0; x < r; x += 1) {
      const dx = r - x - 0.5;
      const dy = r - y - 0.5;
      if (dx * dx + dy * dy <= rSq) continue;

      const points: Array<[number, number]> = [
        [x, y],
        [width - 1 - x, y],
        [x, height - 1 - y],
        [width - 1 - x, height - 1 - y],
      ];
      for (const [px, py] of points) {
        const idx = (py * width + px) * 4;
        bitmap[idx + 3] = 0;
      }
    }
  }

  return nativeImage.createFromBitmap(bitmap, { width, height, scaleFactor: 1 });
}

function overlayImage(base: NativeImage, overlay: NativeImage, x: number, y: number): NativeImage {
  if (base.isEmpty() || overlay.isEmpty()) return base;

  const baseSize = base.getSize();
  const overlaySize = overlay.getSize();
  const baseBuf = Buffer.from(base.toBitmap());
  const overBuf = Buffer.from(overlay.toBitmap());
  if (!baseSize.width || !baseSize.height || !overlaySize.width || !overlaySize.height) return base;

  for (let oy = 0; oy < overlaySize.height; oy += 1) {
    const by = y + oy;
    if (by < 0 || by >= baseSize.height) continue;
    for (let ox = 0; ox < overlaySize.width; ox += 1) {
      const bx = x + ox;
      if (bx < 0 || bx >= baseSize.width) continue;

      const oIdx = (oy * overlaySize.width + ox) * 4;
      const bIdx = (by * baseSize.width + bx) * 4;

      const sa = overBuf[oIdx + 3] / 255;
      if (sa <= 0) continue;
      const da = baseBuf[bIdx + 3] / 255;
      const outA = sa + da * (1 - sa);
      if (outA <= 0) continue;

      for (let c = 0; c < 3; c += 1) {
        const src = overBuf[oIdx + c] / 255;
        const dst = baseBuf[bIdx + c] / 255;
        const out = (src * sa + dst * da * (1 - sa)) / outA;
        baseBuf[bIdx + c] = Math.round(out * 255);
      }
      baseBuf[bIdx + 3] = Math.round(outA * 255);
    }
  }

  return nativeImage.createFromBitmap(baseBuf, { width: baseSize.width, height: baseSize.height, scaleFactor: 1 });
}

function createBrandedNotificationIcon(trackImage: NativeImage): NativeImage {
  const base = createRoundedImage(trackImage, 256, 40);
  if (base.isEmpty()) return getDefaultArtworkAsset().image;

  const appLogo = getDefaultArtworkAsset().image;
  if (appLogo.isEmpty()) return base;

  const badge = createRoundedImage(appLogo, 64, 20);
  const { width, height } = base.getSize();
  const bx = Math.max(0, width - 64 - 10);
  const by = Math.max(0, height - 64 - 10);
  return overlayImage(base, badge, bx, by);
}

async function notifyTrackSwitch(win: BrowserWindow, info: TrackInfo, artwork: ArtworkAsset): Promise<void> {
  if (!Notification.isSupported()) return;

  const icon = createBrandedNotificationIcon(artwork.image);
  const trackTitle = (info.title || '').trim() || 'Unknown Track';
  const trackArtist = (info.artist || '').trim();
  const body = trackArtist ? `${trackTitle}\n${trackArtist}` : trackTitle;

  const notification = new Notification({
    title: APP_NAME,
    body,
    icon,
    silent: true,
    urgency: 'normal',
  });

  notification.on('click', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  notification.show();
}

function setupMpris(win: BrowserWindow): void {
  try {
    const createMprisPlayer = require('mpris-service') as MprisFactory;
    mprisPlayer = createMprisPlayer({
      name: 'sixteencloud',
      identity: APP_NAME,
      desktopEntry: 'sixteencloud',
      supportedUriSchemes: ['http', 'https', 'file'],
      supportedMimeTypes: ['audio/mpeg', 'audio/ogg', 'audio/flac', 'audio/aac', 'audio/mp4'],
      canRaise: true,
      canQuit: true,
      canControl: true,
      hasTrackList: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    logWarn(`[Linux] MPRIS init failed: ${message}`);
    mprisPlayer = null;
    return;
  }

  const fallback = getDefaultArtworkAsset();
  mprisPlayer.playbackStatus = 'Stopped';
  mprisPlayer.metadata = {
    'mpris:trackid': '/org/mpris/MediaPlayer2/track/idle',
    'xesam:title': APP_NAME,
    'xesam:artist': [APP_NAME],
    'mpris:artUrl': fallback.fileUri,
  };
  mprisPlayer.getPosition = () => Math.max(0, Math.round((currentTrack?.currentTime || 0) * 1_000_000));

  mprisPlayer.on('raise', () => {
    if (win.isDestroyed()) return;
    if (win.isMinimized()) win.restore();
    win.show();
    win.focus();
  });
  mprisPlayer.on('quit', () => app.quit());

  mprisPlayer.on('playpause', () => {
    executePlayerScript(win, `document.querySelector('.playControl')?.click();`, 'playpause');
  });
  mprisPlayer.on('play', () => {
    executePlayerScript(
      win,
      `var pc=document.querySelector('.playControl'); if (pc && !pc.classList.contains('playing')) pc.click();`,
      'play'
    );
  });
  mprisPlayer.on('pause', () => {
    executePlayerScript(
      win,
      `var pc=document.querySelector('.playControl'); if (pc && pc.classList.contains('playing')) pc.click();`,
      'pause'
    );
  });
  mprisPlayer.on('stop', () => {
    executePlayerScript(
      win,
      `var pc=document.querySelector('.playControl'); if (pc && pc.classList.contains('playing')) pc.click();`,
      'stop'
    );
  });
  mprisPlayer.on('next', () => {
    executePlayerScript(win, `document.querySelector('.skipControl__next')?.click();`, 'next');
  });
  mprisPlayer.on('previous', () => {
    executePlayerScript(win, `document.querySelector('.skipControl__previous')?.click();`, 'previous');
  });

  logInfo('[Linux] MPRIS service is active on D-Bus: org.mpris.MediaPlayer2.sixteencloud');
}

function updateMpris(track: TrackInfo, artworkUri: string): void {
  if (!mprisPlayer) return;
  const hasTitle = !!(track.title || '').trim();
  if (!hasTitle) {
    mprisPlayer.playbackStatus = 'Stopped';
    return;
  }
  mprisPlayer.playbackStatus = track.isPlaying ? 'Playing' : 'Paused';
  mprisPlayer.metadata = buildMprisMetadata(track, artworkUri);
}

function normalizeTrackInfo(info: TrackInfo): TrackInfo {
  const raw = info && typeof info === 'object' ? info as Partial<TrackInfo> : {};
  const text = (value: unknown, max: number): string => typeof value === 'string' ? value.trim().slice(0, max) : '';
  const artwork = text(raw.artworkUrl, 2048);
  const trackUrl = text(raw.trackUrl, 2048);
  return {
    title: text(raw.title, 500),
    artist: text(raw.artist, 500),
    artworkUrl: isAllowedMediaUrl(artwork) ? normalizeArtworkUrl(artwork) : '',
    duration: typeof raw.duration === 'number' && Number.isFinite(raw.duration) ? Math.max(0, Math.min(raw.duration, 86400)) : 0,
    currentTime: typeof raw.currentTime === 'number' && Number.isFinite(raw.currentTime) ? Math.max(0, Math.min(raw.currentTime, 86400)) : 0,
    isPlaying: !!raw.isPlaying,
    trackUrl: isTrustedSoundCloudUrl(trackUrl) ? trackUrl : '',
    trackId: text(raw.trackId, 256),
  };
}

function shouldEnrichTrackInfo(info: TrackInfo): boolean {
  return !info.title || !info.artist || !info.artworkUrl || !info.trackUrl;
}

async function enrichTrackInfoFromWindow(win: BrowserWindow, base: TrackInfo): Promise<TrackInfo> {
  if (win.isDestroyed()) return base;
  try {
    const raw = await win.webContents.executeJavaScript(`
      (function() {
        function extractUrlFromStyle(style) {
          if (!style) return '';
          var m = style.match(/url\\("?([^"\\)]+)"?\\)/);
          return m ? m[1] : '';
        }
        function readArtwork(el) {
          if (!el) return '';
          var src = el.getAttribute('src') || el.getAttribute('currentSrc') || el.getAttribute('data-src') || el.getAttribute('data-original-src') || '';
          if (src) return src;
          var style = el.getAttribute('style') || '';
          return extractUrlFromStyle(style);
        }

        var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
        var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
        var title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '') : '';
        var artist = artistEl ? (artistEl.getAttribute('title') || artistEl.textContent || '') : '';

        var artSelectors = [
          '.playbackSoundBadge__avatar .image__full',
          '.playbackSoundBadge__avatar span[style*="background-image"]',
          '.playbackSoundBadge__avatar img',
          '.playControls .sc-artwork span[style*="background-image"]',
          '.playControls .sc-artwork img',
          '.playbackSoundBadge img',
          '.playbackSoundBadge__avatar [style*="background-image"]'
        ];
        var artworkUrl = '';
        for (var i = 0; i < artSelectors.length; i++) {
          var el = document.querySelector(artSelectors[i]);
          artworkUrl = readArtwork(el);
          if (artworkUrl) break;
        }

        var trackUrl = '';
        if (titleEl && titleEl.getAttribute('href')) {
          trackUrl = titleEl.getAttribute('href');
          if (trackUrl && trackUrl.startsWith('/')) {
            trackUrl = 'https://soundcloud.com' + trackUrl;
          }
        }
        if (!trackUrl) trackUrl = location.href || '';

        var pc = document.querySelector('.playControl');
        var isPlaying = !!(pc && pc.classList.contains('playing'));
        return {
          title: String(title || '').trim(),
          artist: String(artist || '').trim(),
          artworkUrl: String(artworkUrl || '').trim(),
          trackUrl: String(trackUrl || '').trim(),
          isPlaying: isPlaying
        };
      })();
    `);

    if (!raw || typeof raw !== 'object') return base;
    const v = raw as Record<string, unknown>;

    const title = asString(v.title) || base.title;
    const artist = asString(v.artist) || base.artist;
    const artworkUrl = normalizeArtworkUrl(asString(v.artworkUrl) || base.artworkUrl);
    const trackUrl = asString(v.trackUrl) || base.trackUrl;
    const isPlaying = typeof v.isPlaying === 'boolean' ? v.isPlaying : base.isPlaying;

    return {
      ...base,
      title,
      artist,
      artworkUrl,
      trackUrl,
      isPlaying,
    };
  } catch {
    return base;
  }
}

const ARTWORK_RETRY_TIMEOUT_MS = 2000;
const ARTWORK_RETRY_INTERVAL_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isTrackInfoComplete(info: TrackInfo): boolean {
  return !!(info.title && info.artist && info.artworkUrl);
}

async function waitForCompleteTrackInfo(win: BrowserWindow, info: TrackInfo, sequence: number): Promise<TrackInfo> {
  if (isTrackInfoComplete(info)) return info;
  const deadline = Date.now() + ARTWORK_RETRY_TIMEOUT_MS;
  let current = info;
  while (Date.now() < deadline) {
    await delay(ARTWORK_RETRY_INTERVAL_MS);
    if (sequence !== trackUpdateSequence) return current;
    const enriched = await enrichTrackInfoFromWindow(win, current);
    current = {
      ...current,
      title: enriched.title || current.title,
      artist: enriched.artist || current.artist,
      artworkUrl: enriched.artworkUrl || current.artworkUrl,
      trackUrl: enriched.trackUrl || current.trackUrl,
    };
    if (isTrackInfoComplete(current)) return current;
  }
  return current;
}

async function handleTrackInfoUpdate(win: BrowserWindow, rawInfo: TrackInfo, sequence: number): Promise<void> {
  let info = normalizeTrackInfo(rawInfo);
  if (shouldEnrichTrackInfo(info)) {
    info = await enrichTrackInfoFromWindow(win, info);
  }
  if (sequence !== trackUpdateSequence) return;

  const key = getTrackKey(info);
  if (!key) return;

  const hasTrackChanged = hasSeenFirstTrack && lastTrackKey !== key;
  hasSeenFirstTrack = true;
  lastTrackKey = key;
  currentTrack = info;

  let artwork = (await resolveArtworkAsset(info.artworkUrl)) || null;
  if (sequence !== trackUpdateSequence) return;

  updateMpris(info, (artwork || getDefaultArtworkAsset()).fileUri);

  if (hasTrackChanged) {
    if (!artwork || !isTrackInfoComplete(info)) {
      const refreshed = await waitForCompleteTrackInfo(win, info, sequence);
      if (sequence !== trackUpdateSequence) return;
      const changed =
        refreshed.title !== info.title ||
        refreshed.artist !== info.artist ||
        refreshed.artworkUrl !== info.artworkUrl;
      if (changed) {
        info = refreshed;
        currentTrack = info;
        if (refreshed.artworkUrl) {
          artwork = (await resolveArtworkAsset(info.artworkUrl)) || artwork;
          if (sequence !== trackUpdateSequence) return;
        }
        if (artwork) updateMpris(info, artwork.fileUri);
      }
    }
    void notifyTrackSwitch(win, info, artwork || getDefaultArtworkAsset());
  }
}

export function configureLinuxPaths(): void {
  if (process.platform !== 'linux') return;
  const paths = getLinuxDesktopPaths();
  app.setName(APP_NAME);
  process.env.CHROME_DESKTOP = 'SixteenCloud.desktop';
  app.setPath('userData', paths.configDir);
  app.setPath('sessionData', paths.sessionDir);
  app.setAppLogsPath(paths.logsDir);
  logInfo(`[Linux] XDG paths configured (config=${paths.configDir}, cache=${paths.cacheDir}, data=${paths.dataDir}, state=${paths.stateDir})`);
}

export function setupLinuxDesktopIntegration(win: BrowserWindow): void {
  if (process.platform !== 'linux') return;

  // Pacman packages already ship a system desktop entry. Writing another user
  // entry there creates duplicate launchers; keep the user entry for AppImage
  // and development runs where no system installer owns it.
  if (process.env.APPIMAGE || process.defaultApp) {
    try {
      writeDesktopEntry();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      logWarn(`[Linux] Failed to write desktop entry: ${message}`);
    }
  }

  setupMpris(win);

  trackInfoListener = (event, rawInfo) => {
    if (event.sender !== win.webContents) return;
    const sequence = ++trackUpdateSequence;
    void handleTrackInfoUpdate(win, rawInfo, sequence);
  };
  ipcMain.on(IPC_CHANNELS.TRACK_INFO, trackInfoListener);
}

export function destroyLinuxDesktopIntegration(): void {
  if (trackInfoListener) {
    ipcMain.removeListener(IPC_CHANNELS.TRACK_INFO, trackInfoListener);
    trackInfoListener = null;
  }
  if (mprisPlayer) {
    mprisPlayer.removeAllListeners?.();
    mprisPlayer.destroy?.();
    mprisPlayer = null;
  }
  currentTrack = null;
  lastTrackKey = null;
  hasSeenFirstTrack = false;
  trackUpdateSequence = 0;
  artworkAssetCache.clear();
}

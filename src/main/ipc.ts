import { ipcMain, BrowserWindow, dialog, session, app, net } from 'electron';
import Store from 'electron-store';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { IPC_CHANNELS, STORE_DEFAULTS, SOUNDCLOUD_API_V2, CHROME_UA, emptyHistoryStats } from '../shared/constants';
import { logInfo, logWarn } from './logger';
import archiver from 'archiver';
import { StoreSchema, DownloadRequest } from '../shared/types';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../shared/security';
import { getCoverPalette } from './cover-palette';

// Converting needs a real ffmpeg. The bundled ffmpeg-static binary can be
// missing or built for another platform, so fall back to a system ffmpeg
// before giving up on the download.
function resolveFfmpegPath(): string {
  let staticPath = '';
  try {
    staticPath = (require('ffmpeg-static') as string) || '';
  } catch { /* ffmpeg-static not installed */ }
  const candidates = [
    process.env.SIXTEENCLOUD_FFMPEG,
    staticPath,
    '/usr/bin/ffmpeg',
    '/usr/local/bin/ffmpeg',
  ].filter((c): c is string => !!c);
  for (const candidate of candidates) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch { /* try next */ }
  }
  // Nothing on disk: let the spawn resolve "ffmpeg" through PATH.
  return 'ffmpeg';
}

/** True when the buffered response is an HLS playlist rather than audio bytes. */
function isHlsPlaylistBuffer(buf: Buffer): boolean {
  return buf.length > 6 && buf.slice(0, 7).toString('latin1') === '#EXTM3U';
}

// Optional provider key; never ship credentials in the client bundle.
const MUSIXMATCH_API_KEY = process.env.SIXTEENCLOUD_MUSIXMATCH_API_KEY || '';

const STORE_KEYS = new Set([
  'language', 'firstLaunch', 'geoBypass', 'geoBypass.enabled', 'geoBypass.proxyUrl', 'geoBypass.spoofCountry',
  'discordRp', 'discordRp.enabled', 'discordRp.showArtist', 'discordRp.showTime', 'discordRp.displayWhenPaused',
  'discordRp.displaySmallIcon', 'discordRp.displayButtons', 'discordRp.useArtistName', 'discordRp.enablePreview',
  'adblocker', 'adblocker.enabled', 'adblocker.blockedCount', 'adblocker.customRules', 'adblocker.whitelist',
  'adblocker.remoteDomains', 'adblocker.lastUpdated', 'downloader', 'downloader.outputDir', 'downloader.quality',
  'downloader.history', 'settings', 'settings.startMinimized', 'settings.launchOnStartup', 'settings.accentColor',
  'settings.autoUpdate', 'settings.keybinds', 'history', 'history.enabled', 'history.maxTracks', 'history.tracks', 'history.stats', 'lyrics',
  'lyrics.fontSize', 'themes', 'themes.active', 'themes.custom', 'customCss', 'customCss.code', 'equalizer', 'visualizer',
  'crossfade', 'crossfade.enabled', 'crossfade.duration', 'sidebar',
  'sidebar.bookmarks', 'offlineCache', 'offlineCache.enabled', 'offlineCache.autoCache', 'offlineCache.maxSizeMB',
  'offlineCache.tracks',
]);
const READ_ONLY_STORE_KEYS = new Set([
  'adblocker.blockedCount', 'adblocker.remoteDomains', 'adblocker.lastUpdated',
  'downloader', 'downloader.outputDir', 'downloader.history', 'history', 'offlineCache', 'offlineCache.tracks',
]);

export function assertMainRenderer(event: { sender: Electron.WebContents }, mainWindow: BrowserWindow): void {
  if (event.sender !== mainWindow.webContents) throw new Error('Unauthorized IPC sender');
}

function validateStoreKey(key: unknown): asserts key is string {
  if (typeof key !== 'string' || !STORE_KEYS.has(key)) throw new Error('Unknown store key');
}

function validateStoreValue(key: string, value: unknown): void {
  if (key === 'language' && value !== 'en' && value !== 'ru') throw new Error('Invalid language');
  if (key === 'downloader.quality' && value !== '128' && value !== '256' && value !== 'original') throw new Error('Invalid quality');
  if (key === 'geoBypass.proxyUrl' && value !== '' && (typeof value !== 'string' || value.length > 2048 || !/^(https?|socks5):\/\//i.test(value))) {
    throw new Error('Invalid proxy URL');
  }
  if (key === 'settings.accentColor' && (typeof value !== 'string' || !/^#[0-9a-f]{3,8}$/i.test(value))) {
    throw new Error('Invalid accent color');
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
  if (key === 'crossfade.duration' && (typeof value !== 'number' || !Number.isFinite(value) || value < 1 || value > 15)) {
    throw new Error('Invalid crossfade duration');
  }
  if ((key === 'crossfade.enabled') && typeof value !== 'boolean') throw new Error('Invalid crossfade state');
  if (key === 'equalizer') {
    const state = value as any;
    if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.enabled !== 'boolean' ||
        typeof state.preset !== 'string' || !Array.isArray(state.bands) || state.bands.length !== 10 ||
        state.bands.some((band: unknown) => typeof band !== 'number' || !Number.isFinite(band) || band < -12 || band > 12)) {
      throw new Error('Invalid equalizer state');
    }
  }
  if (key === 'visualizer') {
    const state = value as any;
    if (!state || typeof state !== 'object' || Array.isArray(state) || typeof state.enabled !== 'boolean' ||
        !['side', 'above', 'wave', 'glow'].includes(state.type)) {
      throw new Error('Invalid visualizer state');
    }
  }
  const serialized = (() => { try { return JSON.stringify(value); } catch { return ''; } })();
  if (!serialized || serialized.length > 2_000_000) throw new Error('Store value is too large');
}

function validateDownloadRequest(input: unknown): DownloadRequest {
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

export async function readResponseBuffer(response: Response, maxBytes: number): Promise<Buffer> {
  const declared = Number(response.headers.get('content-length') || 0);
  if (declared > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
  if (!response.body) {
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) throw new Error(`Response exceeds ${maxBytes} byte limit`);
    return buffer;
  }
  const reader = response.body.getReader();
  const chunks: Buffer[] = [];
  let total = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      const chunk = Buffer.from(part.value);
      total += chunk.length;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Response exceeds ${maxBytes} byte limit`);
      }
      chunks.push(chunk);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks, total);
}

let _encryptionKey: string | null = null;

export function getEncryptionKey(): string {
  if (_encryptionKey) return _encryptionKey;
  const keyPath = path.join(app.getPath('userData'), '.encryption-key');
  if (fs.existsSync(keyPath)) {
    _encryptionKey = fs.readFileSync(keyPath, 'utf-8').trim();
  } else {
    _encryptionKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, _encryptionKey, { encoding: 'utf-8', mode: 0o600 });
  }
  return _encryptionKey;
}

/** Use Electron's net.fetch — it respects session cookies, proxy, and user-agent */
function eFetch(url: string, opts: RequestInit = {}): Promise<Response> {
  const headers = new Headers(opts.headers);
  if (!headers.has('User-Agent')) {
    headers.set('User-Agent', CHROME_UA);
  }
  return net.fetch(url, { ...opts, headers });
}

let store: Store<StoreSchema>;
let cachedClientId: string | null = null;

export function getStore(): Store<StoreSchema> {
  return store;
}

async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;

  try {
    // Fetch SoundCloud main page to find script URLs
    const pageResp = await eFetch('https://soundcloud.com');
    const pageHtml = await pageResp.text();

    // Find all JS bundle URLs
    const scriptMatches = pageHtml.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9\-]+\.js/g);
    if (!scriptMatches) throw new Error('No scripts found');

    // Search last few scripts (client_id is usually in the last ones)
    const candidates = scriptMatches.slice(Math.max(0, scriptMatches.length - 5)).reverse();
    const scriptTexts = await Promise.all(candidates.map(async (scriptUrl) => {
      const scriptResp = await eFetch(scriptUrl);
      return scriptResp.ok ? scriptResp.text() : '';
    }));
    for (const scriptText of scriptTexts) {
      const cidMatch = scriptText.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (cidMatch) {
        cachedClientId = cidMatch[1];
        logInfo(`[Downloader] Found client_id: ${cachedClientId}`);
        return cachedClientId;
      }
    }
  } catch (err) {
    logInfo(`[Downloader] Failed to extract client_id: ${err}`);
  }

  throw new Error('Could not find SoundCloud client_id. Try logging in with OAuth token first.');
}

function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!win.isDestroyed()) win.webContents.send(channel, ...args);
}

export function setupIPC(mainWindow: BrowserWindow): void {
  try {
    store = new Store<StoreSchema>({
      defaults: STORE_DEFAULTS as StoreSchema,
      encryptionKey: getEncryptionKey(),
    });
    // Test that store is readable
    store.get('language');
  } catch (e: any) {
    logWarn('Store corrupted, resetting:', e?.message);
    // Preserve the broken config for diagnostics instead of deleting user data.
    const storePath = path.join(app.getPath('userData'), 'config.json');
    try { fs.renameSync(storePath, `${storePath}.corrupt-${Date.now()}`); } catch {}
    store = new Store<StoreSchema>({
      defaults: STORE_DEFAULTS as StoreSchema,
      encryptionKey: getEncryptionKey(),
    });
  }

  // Store get/set
  ipcMain.handle(IPC_CHANNELS.STORE_GET, (event, key: string) => {
    assertMainRenderer(event, mainWindow);
    validateStoreKey(key);
    return store.get(key);
  });

  ipcMain.handle(IPC_CHANNELS.STORE_SET, (event, key: string, value: unknown) => {
    assertMainRenderer(event, mainWindow);
    validateStoreKey(key);
    if (READ_ONLY_STORE_KEYS.has(key)) throw new Error('Store key is read-only');
    validateStoreValue(key, value);
    store.set(key, value);
  });

  // Cover-art palette for the player visualizer. Only SoundCloud artwork
  // hosts are accepted; matugen runs with an isolated config so the user's
  // desktop theme is never rewritten.
  ipcMain.handle(IPC_CHANNELS.COVER_PALETTE, async (event, url: unknown) => {
    assertMainRenderer(event, mainWindow);
    return getCoverPalette(url);
  });

  // Window controls
  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    assertMainRenderer(event, mainWindow);
    mainWindow.minimize();
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    assertMainRenderer(event, mainWindow);
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    assertMainRenderer(event, mainWindow);
    mainWindow.close();
  });

  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    assertMainRenderer(event, mainWindow);
    return mainWindow.isMaximized();
  });

  // Settings - clear cache
  ipcMain.handle(IPC_CHANNELS.SETTINGS_CLEAR_CACHE, async (event) => {
    assertMainRenderer(event, mainWindow);
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData();
  });

  // Adblocker toggle
  ipcMain.handle(IPC_CHANNELS.AD_TOGGLE, (event, enabled: boolean) => {
    assertMainRenderer(event, mainWindow);
    store.set('adblocker.enabled', enabled);
  });

  // Adblocker update lists
  ipcMain.handle(IPC_CHANNELS.AD_UPDATE_LISTS, async (event) => {
    assertMainRenderer(event, mainWindow);
    try {
      // Attempt to fetch from GitHub (replace with your own list URL if needed)
      const listUrl = 'https://raw.githubusercontent.com/ocb2016/ocbbio/main/adlist.json';
      const response = await eFetch(listUrl);
      let remoteDomains: string[] = [];
      if (response.ok) {
        const data = await response.json() as { domains?: string[], list?: string[] };
        remoteDomains = data.domains || data.list || [];
      }
      store.set('adblocker.remoteDomains', remoteDomains);
      store.set('adblocker.lastUpdated', new Date().toISOString());
      return { success: true, count: remoteDomains.length };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  // Geo-Bypass
  ipcMain.handle(IPC_CHANNELS.GEO_SET_PROXY, async (event, proxyUrl: string, country: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof proxyUrl !== 'string' || proxyUrl.length > 2048 || (proxyUrl && !/^(https?|socks5):\/\//i.test(proxyUrl))) throw new Error('Invalid proxy URL');
    if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) throw new Error('Invalid country');
    store.set('geoBypass.proxyUrl', proxyUrl);
    store.set('geoBypass.spoofCountry', country);
    if (proxyUrl) {
      await session.defaultSession.setProxy({ proxyRules: proxyUrl });
    } else {
      await session.defaultSession.setProxy({ proxyRules: '' });
    }
  });

  ipcMain.handle(IPC_CHANNELS.GEO_TEST_PROXY, async (event, proxyUrl: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof proxyUrl !== 'string' || proxyUrl.length > 2048 || (proxyUrl && !/^(https?|socks5):\/\//i.test(proxyUrl))) return false;
    try {
      if (proxyUrl) {
        await session.defaultSession.setProxy({ proxyRules: proxyUrl });
      }
      const response = await eFetch('https://api.ipify.org?format=json');
      return response.ok;
    } catch {
      return false;
    }
  });

  // Auth - set token and validate
  ipcMain.handle(IPC_CHANNELS.AUTH_SET_TOKEN, async (event, token: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof token !== 'string' || token.length < 8 || token.length > 512 || !/^[A-Za-z0-9._~-]+$/.test(token)) {
      return { success: false, error: 'Invalid token format' };
    }
    try {
      const response = await eFetch(`${SOUNDCLOUD_API_V2}/me`, {
        headers: { 'Authorization': `OAuth ${token}` },
      });
      if (!response.ok) {
        return { success: false, error: `API returned ${response.status}` };
      }
      const user = await response.json() as { username?: string; avatar_url?: string; id?: number };
      store.set('authToken.token', token);

      // Inject token into SoundCloud cookies
      const cookie = {
        url: 'https://soundcloud.com',
        name: 'oauth_token',
        value: token,
      };
      await session.defaultSession.cookies.set(cookie);

      // Also inject into page localStorage
      !mainWindow.isDestroyed() && mainWindow.webContents.executeJavaScript(
        `localStorage.setItem('oauth_token', ${JSON.stringify(token)});`
      ).catch(() => {});

      const authState = {
        isLoggedIn: true,
        username: user.username || '',
        avatarUrl: user.avatar_url || '',
        userId: String(user.id || ''),
      };
      safeSend(mainWindow,IPC_CHANNELS.AUTH_STATE, authState);
      return { success: true, user: authState };
    } catch (err) {
      return { success: false, error: String(err) };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_VALIDATE, async (event) => {
    assertMainRenderer(event, mainWindow);
    const token = store.get('authToken.token');
    if (!token) return { success: false };
    try {
      const response = await eFetch(`${SOUNDCLOUD_API_V2}/me`, {
        headers: { 'Authorization': `OAuth ${token}` },
      });
      if (!response.ok) return { success: false };
      const user = await response.json() as { username?: string; avatar_url?: string; id?: number };
      return {
        success: true,
        user: {
          isLoggedIn: true,
          username: user.username || '',
          avatarUrl: user.avatar_url || '',
          userId: String(user.id || ''),
        },
      };
    } catch {
      return { success: false };
    }
  });

  ipcMain.handle(IPC_CHANNELS.AUTH_LOGOUT, async (event) => {
    assertMainRenderer(event, mainWindow);
    store.set('authToken.token', '');
    await session.defaultSession.cookies.remove('https://soundcloud.com', 'oauth_token');
    !mainWindow.isDestroyed() && mainWindow.webContents.executeJavaScript(`
      localStorage.removeItem('oauth_token');
    `).catch(() => {});
    safeSend(mainWindow,IPC_CHANNELS.AUTH_STATE, { isLoggedIn: false });
  });

  // Escape special characters for FFmpeg metadata values
  function escMeta(val: string): string {
    return val.replace(/\\/g, '\\\\').replace(/=/g, '\\=').replace(/;/g, '\\;').replace(/\n/g, ' ');
  }

  // Download track
  // Core download logic — reused by single download and queue
  async function downloadTrackCore(request: DownloadRequest): Promise<void> {
    const token = (store.get('authToken.token') || '') as string;
    const outputDir = (store.get('downloader.outputDir') || path.join(app.getPath('music'), 'SixteenCloud')) as string;

    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      trackId: request.trackId,
      percent: 10,
      status: 'downloading',
    });

    let clientId = await getClientId();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `OAuth ${token}`;

    let resolveUrl = `${SOUNDCLOUD_API_V2}/resolve?url=${encodeURIComponent(request.trackUrl)}&client_id=${clientId}`;
    let resolveResp = await eFetch(resolveUrl, { headers });

    if (resolveResp.status === 401 || resolveResp.status === 403) {
      logInfo('[Downloader] Resolve returned ' + resolveResp.status + ', refreshing client_id...');
      cachedClientId = null;
      clientId = await getClientId();
      resolveUrl = `${SOUNDCLOUD_API_V2}/resolve?url=${encodeURIComponent(request.trackUrl)}&client_id=${clientId}`;
      resolveResp = await eFetch(resolveUrl, { headers });
    }
    if (!resolveResp.ok) throw new Error(`Resolve failed: ${resolveResp.status}`);
    const trackData = await resolveResp.json() as { id: number; genre?: string; created_at?: string; release_date?: string; user?: { username?: string }; media?: { transcodings?: Array<{ url: string; format: { protocol: string; mime_type: string } }> } };

    const transcodings = trackData.media?.transcodings || [];
    let streamInfo = transcodings.find((t: { format: { protocol: string } }) => t.format.protocol === 'progressive');
    if (!streamInfo) streamInfo = transcodings[0];
    if (!streamInfo) throw new Error('No stream URL found');

    const streamSep = streamInfo.url.includes('?') ? '&' : '?';
    const streamResp = await eFetch(streamInfo.url + streamSep + 'client_id=' + clientId, { headers });
    if (!streamResp.ok) throw new Error(`Stream URL fetch failed: ${streamResp.status}`);
    const streamData = await streamResp.json() as { url: string };
    if (!isAllowedMediaUrl(streamData.url)) throw new Error('SoundCloud returned an unsafe stream URL');

    safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      trackId: request.trackId,
      percent: 30,
      status: 'downloading',
    });

    const audioResp = await eFetch(streamData.url);
    if (!audioResp.ok) throw new Error(`Audio download failed: ${audioResp.status}`);
    const contentLength = parseInt(audioResp.headers.get('content-length') || '0', 10);
    if (contentLength > 500 * 1024 * 1024) throw new Error('File too large (>500MB)');
    const audioBuffer = await readResponseBuffer(audioResp, 500 * 1024 * 1024);

    const safeName = (request.artist + ' - ' + request.title).replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
    const tempFile = path.join(outputDir, safeName + '.tmp');
    const outputFile = path.join(outputDir, safeName + '.mp3');

    fs.writeFileSync(tempFile, audioBuffer);

    safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      trackId: request.trackId,
      percent: 70,
      status: 'converting',
    });

    const ffmpegPath = resolveFfmpegPath();

    // Download artwork for ID3 cover
    let coverFile: string | null = null;
    if (request.artworkUrl) {
      try {
        let artUrl = request.artworkUrl;
        artUrl = artUrl.replace(/-large\./, '-t500x500.').replace(/-[a-z0-9]+x[a-z0-9]+\./, '-t500x500.');
        if (!artUrl.includes('t500x500')) {
          artUrl = artUrl.replace(/\/artworks-/, '/artworks-').replace(/-\w+(\.\w+)$/, '-t500x500$1');
        }
        const coverResp = await eFetch(artUrl);
        if (coverResp.ok) {
          const coverBuf = await readResponseBuffer(coverResp, 20 * 1024 * 1024);
          coverFile = path.join(outputDir, safeName + '.cover.jpg');
          fs.writeFileSync(coverFile, coverBuf);
        }
      } catch { /* artwork download failed, continue without cover */ }
    }

    const bitrate = request.quality === 'original' ? '320k' : request.quality + 'k';
    // SoundCloud serves HLS-only for many tracks: the fetched bytes are an
    // m3u8 playlist whose segments ffmpeg must be allowed to fetch over https.
    const isHls = isHlsPlaylistBuffer(audioBuffer);
    const ffmpegArgs: string[] = isHls
      ? ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls', '-i', tempFile]
      : ['-i', tempFile];
    if (coverFile) {
      ffmpegArgs.push('-i', coverFile, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
    }

    // Extract year from release_date or created_at
    const dateSource = trackData.release_date || trackData.created_at || '';
    const year = dateSource ? dateSource.substring(0, 4) : '';
    const genre = trackData.genre || '';
    const album = request.album || request.artist;

    ffmpegArgs.push(
      '-c:a', 'libmp3lame', '-b:a', bitrate,
      '-id3v2_version', '3',
      '-metadata', `title=${escMeta(request.title)}`,
      '-metadata', `artist=${escMeta(request.artist)}`,
      '-metadata', `album=${escMeta(album)}`,
    );
    if (genre) ffmpegArgs.push('-metadata', `genre=${escMeta(genre)}`);
    if (year) ffmpegArgs.push('-metadata', `date=${year}`);
    if (request.trackNumber) ffmpegArgs.push('-metadata', `track=${request.trackNumber}`);
    ffmpegArgs.push('-y', outputFile);

    await new Promise<void>((resolve, reject) => {
      execFile(ffmpegPath, ffmpegArgs, (error) => {
        if (!error) { resolve(); return; }
        // No usable ffmpeg: progressive audio bytes are already a playable
        // file, an HLS playlist is not and must fail loudly.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !isHls) {
          try { fs.renameSync(tempFile, outputFile); resolve(); return; } catch (renameErr) { reject(renameErr); return; }
        }
        reject(error);
      });
    });

    try { fs.unlinkSync(tempFile); } catch {}
    if (coverFile) { try { fs.unlinkSync(coverFile); } catch {} }

    safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      trackId: request.trackId,
      percent: 95,
      status: 'tagging',
    });

    finishDownload(request, outputFile);
  }

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_TRACK, async (event, rawRequest: unknown) => {
    assertMainRenderer(event, mainWindow);
    let request: DownloadRequest;
    try {
      request = validateDownloadRequest(rawRequest);
      await downloadTrackCore(request);
    } catch (err) {
      safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_COMPLETE, {
        trackId: typeof rawRequest === 'object' && rawRequest && 'trackId' in rawRequest ? String((rawRequest as { trackId?: unknown }).trackId || '') : '',
        error: String(err),
      });
    }
  });

  // Canonical track metadata for the downloader panel (title/artist/artwork).
  // The modern SoundCloud track page carries no static title markup, so the
  // panel resolves the page URL through the API instead of scraping the DOM.
  ipcMain.handle(IPC_CHANNELS.DOWNLOADER_RESOLVE, async (event, trackUrl: unknown) => {
    assertMainRenderer(event, mainWindow);
    if (typeof trackUrl !== 'string' || !isTrustedSoundCloudUrl(trackUrl)) {
      throw new Error('Invalid track URL');
    }
    const token = (store.get('authToken.token') || '') as string;
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `OAuth ${token}`;
    const buildUrl = (cid: string) => `${SOUNDCLOUD_API_V2}/resolve?url=${encodeURIComponent(trackUrl)}&client_id=${cid}`;

    let clientId = await getClientId();
    let resp = await eFetch(buildUrl(clientId), { headers });
    if (resp.status === 401 || resp.status === 403) {
      cachedClientId = null;
      clientId = await getClientId();
      resp = await eFetch(buildUrl(clientId), { headers });
    }
    if (!resp.ok) throw new Error(`Resolve failed: ${resp.status}`);
    const data = await resp.json() as {
      id?: number; title?: string; artwork_url?: string | null; genre?: string;
      created_at?: string; release_date?: string | null;
      user?: { username?: string };
    };
    return {
      id: typeof data.id === 'number' ? data.id : null,
      title: typeof data.title === 'string' ? data.title : '',
      artist: data.user && typeof data.user.username === 'string' ? data.user.username : '',
      artworkUrl: typeof data.artwork_url === 'string' ? data.artwork_url : '',
      genre: data.genre || '',
      year: String(data.release_date || data.created_at || '').substring(0, 4),
    };
  });

  function finishDownload(request: DownloadRequest, outputFile: string): void {
    // Add to history
    const history = (store.get('downloader.history') || []) as Array<{ title: string; artist: string; date: string; path: string }>;
    history.push({
      title: request.title,
      artist: request.artist,
      date: new Date().toISOString().split('T')[0],
      path: outputFile,
    });
    store.set('downloader.history', history);

    safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_PROGRESS, {
      trackId: request.trackId,
      percent: 100,
      status: 'complete',
    });
    safeSend(mainWindow,IPC_CHANNELS.DOWNLOAD_COMPLETE, {
      trackId: request.trackId,
      filePath: outputFile,
    });
  }

  // === Download Queue ===
  interface QueueItem {
    request: DownloadRequest;
    status: 'pending' | 'downloading' | 'paused' | 'done' | 'error';
  }
  const downloadQueue: QueueItem[] = [];
  let queuePaused = false;
  let queueProcessing = false;

  function sendQueueState(): void {
    safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_QUEUE_STATE, {
      items: downloadQueue.map(q => ({
        trackId: q.request.trackId,
        title: q.request.title,
        artist: q.request.artist,
        status: q.status,
      })),
      paused: queuePaused,
    });
  }

  async function processQueue(): Promise<void> {
    if (queueProcessing || queuePaused) return;
    const next = downloadQueue.find(q => q.status === 'pending');
    if (!next) return;

    queueProcessing = true;
    next.status = 'downloading';
    sendQueueState();

    try {
      await downloadTrackCore(next.request);
      next.status = 'done';
    } catch {
      next.status = 'error';
    }

    queueProcessing = false;
    sendQueueState();

    if (!queuePaused) processQueue();
  }

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_ADD, async (event, rawRequest: unknown) => {
    assertMainRenderer(event, mainWindow);
    const request = validateDownloadRequest(rawRequest);
    // Don't add duplicates
    if (downloadQueue.some(q => q.request.trackId === request.trackId && q.status === 'pending')) return;
    downloadQueue.push({ request, status: 'pending' });
    sendQueueState();
    processQueue();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_REMOVE, async (event, trackId: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof trackId !== 'string' || trackId.length > 256) return;
    const idx = downloadQueue.findIndex(q => q.request.trackId === trackId);
    if (idx !== -1) {
      downloadQueue.splice(idx, 1);
      sendQueueState();
    }
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_PAUSE, async (event) => {
    assertMainRenderer(event, mainWindow);
    queuePaused = true;
    sendQueueState();
  });

  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_QUEUE_RESUME, async (event) => {
    assertMainRenderer(event, mainWindow);
    queuePaused = false;
    sendQueueState();
    processQueue();
  });

  // Download liked tracks
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_LIKED, async (event) => {
    assertMainRenderer(event, mainWindow);
    const token = (store.get('authToken.token') || '') as string;
    if (!token) throw new Error('auth: OAuth token required');

    let clientId = await getClientId();
    const headers: Record<string, string> = { 'Authorization': `OAuth ${token}` };

    const likesResp = await eFetch(
      `${SOUNDCLOUD_API_V2}/me/likes?limit=100&offset=0&client_id=${clientId}`,
      { headers }
    );
    if (!likesResp.ok) throw new Error(`Failed to fetch likes: ${likesResp.status}`);
    const likesData = await likesResp.json() as { collection: Array<{ track?: { permalink_url: string; title: string; user: { username: string }; artwork_url: string } }> };

    const quality = (store.get('downloader.quality') || '128') as string;
    let added = 0;
    for (const item of likesData.collection) {
      if (!item.track) continue;
      const track = item.track;
      const trackId = track.permalink_url.replace('https://soundcloud.com/', '');
      // Add to queue
      if (!downloadQueue.some(q => q.request.trackId === trackId && q.status === 'pending')) {
        downloadQueue.push({
          request: {
            trackUrl: track.permalink_url,
            trackId,
            title: track.title || 'Unknown',
            artist: track.user?.username || 'Unknown',
            artworkUrl: track.artwork_url || '',
            quality: quality as '128' | '256' | 'original',
          },
          status: 'pending',
        });
        added++;
      }
    }
    sendQueueState();
    if (added > 0) processQueue();
  });

  // Download - set output dir
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_SET_DIR, async (event) => {
    assertMainRenderer(event, mainWindow);
    const result = await dialog.showOpenDialog(mainWindow, {
      properties: ['openDirectory'],
      title: 'Select download directory',
    });
    if (!result.canceled && result.filePaths.length > 0) {
      store.set('downloader.outputDir', result.filePaths[0]);
      return result.filePaths[0];
    }
    return store.get('downloader.outputDir');
  });

  // History
  ipcMain.handle(IPC_CHANNELS.HISTORY_GET, (event) => {
    assertMainRenderer(event, mainWindow);
    return store.get('history.tracks') || [];
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, (event) => {
    assertMainRenderer(event, mainWindow);
    store.set('history.tracks', []);
    // The panel statistics come from these lifetime counters, so clearing the
    // history has to reset them as well or the top numbers would linger.
    store.set('history.stats', emptyHistoryStats());
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (event, query: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof query !== 'string' || query.length > 500) return [];
    const tracks = (store.get('history.tracks') || []) as Array<{ title: string; artist: string }>;
    const q = query.toLowerCase();
    return tracks.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q));
  });

  // Lyrics — multi-source parallel search with caching.
  // Synced-capable: lrclib.net, NetEase, QQ Music. Plain-only: Genius, lyrics.ovh,
  // Musixmatch, AZLyrics, lyrist, ChartLyrics. lrclib always ranks first.
  const lyricsCache = new Map<string, { lyrics: string | null; syncedLyrics?: string; source?: string }>();
  const LYRICS_TIMEOUT = 4000;

  function fetchWithTimeout(url: string, timeoutMs: number, opts: RequestInit = {}): Promise<Response> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs);
      eFetch(url, opts).then(r => { clearTimeout(timer); resolve(r); }).catch(e => { clearTimeout(timer); reject(e); });
    });
  }

  /** Strip LRC timing tags and metadata lines, leaving readable plain text. */
  function lrcToPlain(lrc: string): string {
    return lrc
      .replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')
      .replace(/^\s*\[(?:ar|ti|al|by|re|ve|offset):[^\]]*\]\s*$/gim, '')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  }

  function parseLrclibResult(data: { plainLyrics?: string; syncedLyrics?: string }): { lyrics: string; syncedLyrics?: string; source: string } | null {
    if (data.syncedLyrics) {
      return { lyrics: lrcToPlain(data.syncedLyrics) || data.syncedLyrics.trim(), syncedLyrics: data.syncedLyrics, source: 'lrclib' };
    }
    if (data.plainLyrics) return { lyrics: data.plainLyrics, source: 'lrclib' };
    return null;
  }

  interface LrclibEntry { plainLyrics?: string; syncedLyrics?: string; duration?: number }

  /** Pick the best lrclib entry: synced beats plain, closest duration breaks ties. */
  function pickLrclib(entries: Array<LrclibEntry | null>, duration?: number): { lyrics: string; syncedLyrics?: string; source: string } | null {
    const list = entries.filter((e): e is LrclibEntry => !!e && !!(e.syncedLyrics || e.plainLyrics));
    if (!list.length) return null;
    const dist = (e: LrclibEntry): number =>
      (typeof duration === 'number' && duration > 0 && typeof e.duration === 'number') ? Math.abs(e.duration - duration) : 0;
    const withSynced = list.filter(e => e.syncedLyrics).sort((a, b) => dist(a) - dist(b));
    if (withSynced.length) return parseLrclibResult(withSynced[0]);
    const plain = list.slice().sort((a, b) => dist(a) - dist(b));
    return parseLrclibResult(plain[0]);
  }

  /** NetEase Cloud Music — deep RU/JA/KR catalogue with time-synced LRC. */
  async function fetchNetease(query: string, duration?: number): Promise<{ lyrics: string; syncedLyrics?: string; source: string } | null> {
    try {
      const headers = { 'User-Agent': CHROME_UA, 'Referer': 'https://music.163.com/' };
      const searchResp = await fetchWithTimeout(
        `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&limit=8`,
        LYRICS_TIMEOUT, { headers }
      );
      if (!searchResp.ok) return null;
      const searchData = await searchResp.json() as { result?: { songs?: Array<{ id?: number; duration?: number }> } };
      const songs = searchData.result?.songs || [];
      if (!songs.length) return null;
      let song = songs[0];
      if (typeof duration === 'number' && duration > 0) {
        // NetEase reports durations in milliseconds.
        song = songs.slice().sort((a, b) =>
          Math.abs((a.duration || 1e9) / 1000 - duration) - Math.abs((b.duration || 1e9) / 1000 - duration)
        )[0] || song;
      }
      if (!song?.id) return null;
      const lyricResp = await fetchWithTimeout(
        `https://music.163.com/api/song/lyric?id=${song.id}&lv=-1&kv=-1&tv=-1`,
        LYRICS_TIMEOUT, { headers }
      );
      if (!lyricResp.ok) return null;
      const lyricData = await lyricResp.json() as { lrc?: { lyric?: string } };
      const lrc = (lyricData.lrc?.lyric || '').trim();
      if (lrc.length < 20) return null;
      if (/\[\d{1,3}:\d{1,2}/.test(lrc)) return { lyrics: lrcToPlain(lrc) || lrc, syncedLyrics: lrc, source: 'netease' };
      return { lyrics: lrc, source: 'netease' };
    } catch { return null; }
  }

  /** QQ Music — time-synced LRC; search rows carry durations in seconds. */
  async function fetchQQMusic(query: string, duration?: number): Promise<{ lyrics: string; syncedLyrics?: string; source: string } | null> {
    try {
      const headers = { 'User-Agent': CHROME_UA, 'Referer': 'https://y.qq.com/' };
      const searchResp = await fetchWithTimeout(
        `https://c.y.qq.com/soso/fcgi-bin/client_search_cp?p=1&n=5&w=${encodeURIComponent(query)}&format=json&new_json=1`,
        LYRICS_TIMEOUT, { headers }
      );
      if (!searchResp.ok) return null;
      const searchData = await searchResp.json() as { data?: { song?: { list?: Array<{ mid?: string; interval?: number }> } } };
      const songs = searchData.data?.song?.list || [];
      if (!songs.length) return null;
      let song = songs[0];
      if (typeof duration === 'number' && duration > 0) {
        song = songs.slice().sort((a, b) =>
          Math.abs((a.interval || 1e9) - duration) - Math.abs((b.interval || 1e9) - duration)
        )[0] || song;
      }
      if (!song?.mid) return null;
      const lyricResp = await fetchWithTimeout(
        `https://c.y.qq.com/lyric/fcgi-bin/fcg_query_lyric_new.fcg?songmid=${encodeURIComponent(song.mid)}&format=json&nobase64=1&g_tk=5381`,
        LYRICS_TIMEOUT, { headers: { ...headers, 'Referer': 'https://y.qq.com/portal/player.html' } }
      );
      if (!lyricResp.ok) return null;
      const lyricData = await lyricResp.json() as { lyric?: string };
      let lrc = (lyricData.lyric || '').trim();
      if (lrc.length < 20) return null;
      // QQ escapes entities and pads credit lines we do not want in the reel.
      lrc = lrc
        .replace(/&#(\d+);/g, (_s, d: string) => String.fromCharCode(Number(d)))
        .replace(/&apos;/g, "'")
        .replace(/&quot;/g, '"')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/^\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\].*(?:Lyrics by|Composed by|Produced by|作词|作曲|编曲).*$/gim, '')
        .replace(/\n{2,}/g, '\n')
        .trim();
      if (!/\[\d{1,3}:\d{1,2}/.test(lrc)) return null;
      return { lyrics: lrcToPlain(lrc) || lrc, syncedLyrics: lrc, source: 'qqmusic' };
    } catch { return null; }
  }

  /** lyrist — small public lyrics API, plain text only. */
  async function fetchLyrist(artist: string, title: string): Promise<{ lyrics: string; source: string } | null> {
    try {
      const resp = await fetchWithTimeout(
        `https://lyrist.vercel.app/api/${encodeURIComponent(title)}/${encodeURIComponent(artist)}`,
        LYRICS_TIMEOUT
      );
      if (!resp.ok) return null;
      const data = await resp.json() as { lyrics?: string };
      const text = (data.lyrics || '').trim();
      return text.length > 20 ? { lyrics: text, source: 'lyrist' } : null;
    } catch { return null; }
  }

  function cleanGeniusLyrics(raw: string): string {
    let lyrics = raw
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/\d+\s*Contributor[s]?/g, '')
      .replace(/Embed$/gm, '')
      .replace(/\d+Embed$/gm, '')
      .replace(/You might also like/g, '')
      .replace(/See .+ LiveGet tickets as low as \$\d+/g, '')
      .replace(/Produced by .+$/gm, '')
      .replace(/Written by .+$/gm, '');
    // Remove Genius page title: "Song Title Lyrics[...]" or "Song Title LyricsText"
    lyrics = lyrics.replace(/^[^\n]*Lyrics\s*\[[^\]]*\]\s*/i, '');
    lyrics = lyrics.replace(/^[^\n]*Lyrics(?=\s*[\r\n])/i, '');
    lyrics = lyrics.replace(/^[^\n]*Lyrics(?=[A-ZА-ЯЁ\[])/i, '');
    // Remove Genius localized header markers like "[Текст песни «Title»]" / "[Paroles de «Title»]"
    lyrics = lyrics.replace(/^\s*\[(?:Текст песни|Paroles de|Letra de|Songtext zu|Testo di|Lirik dari)[^\]]*\]\s*/i, '');
    // Remove trailing "Embed" or number lines
    lyrics = lyrics.replace(/\n\d+$/g, '');
    lyrics = lyrics.replace(/\n{3,}/g, '\n\n').trim();
    return lyrics;
  }

  /** Strip <div data-exclude-from-selection="true">...</div> blocks (Genius headers, song bio, contributors). */
  function stripExcludedBlocks(html: string): string {
    const marker = 'data-exclude-from-selection="true"';
    let result = html;
    while (true) {
      const attrIdx = result.indexOf(marker);
      if (attrIdx === -1) break;
      const tagStart = result.lastIndexOf('<div', attrIdx);
      if (tagStart === -1) break;
      const tagEnd = result.indexOf('>', attrIdx);
      if (tagEnd === -1) break;
      let depth = 1;
      let pos = tagEnd + 1;
      while (depth > 0 && pos < result.length) {
        const nextOpen = result.indexOf('<div', pos);
        const nextClose = result.indexOf('</div>', pos);
        if (nextClose === -1) return result.substring(0, tagStart);
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            result = result.substring(0, tagStart) + result.substring(nextClose + 6);
            break;
          }
          pos = nextClose + 6;
        }
      }
      if (depth > 0) break;
    }
    return result;
  }

  /** Scrape Genius page for lyrics containers */
  function extractGeniusLyrics(html: string): string | null {
    const lyricsMatches: string[] = [];
    let searchPos = 0;
    while (true) {
      const marker = 'data-lyrics-container="true"';
      const idx = html.indexOf(marker, searchPos);
      if (idx === -1) break;
      const tagEnd = html.indexOf('>', idx);
      if (tagEnd === -1) break;
      let depth = 1;
      let pos = tagEnd + 1;
      while (depth > 0 && pos < html.length) {
        const nextOpen = html.indexOf('<div', pos);
        const nextClose = html.indexOf('</div>', pos);
        if (nextClose === -1) break;
        if (nextOpen !== -1 && nextOpen < nextClose) {
          depth++;
          pos = nextOpen + 4;
        } else {
          depth--;
          if (depth === 0) {
            const inner = stripExcludedBlocks(html.substring(tagEnd + 1, nextClose));
            lyricsMatches.push(inner);
          }
          pos = nextClose + 6;
        }
      }
      searchPos = pos;
    }
    if (lyricsMatches.length > 0) {
      const lyrics = cleanGeniusLyrics(lyricsMatches.join('\n\n'));
      if (lyrics.length > 20) return lyrics;
    }
    return null;
  }

  /** Parse AZLyrics HTML — lyrics are inside a div with no class/id after the comment "Usage of azlyrics..." */
  function extractAZLyrics(html: string): string | null {
    // AZLyrics puts lyrics in a div that follows <!-- Usage of azlyrics.com content... -->
    const marker = '<!-- Usage of azlyrics.com content';
    const idx = html.indexOf(marker);
    if (idx === -1) return null;
    const divStart = html.indexOf('<div>', idx);
    if (divStart === -1) return null;
    const divEnd = html.indexOf('</div>', divStart);
    if (divEnd === -1) return null;
    let lyrics = html.substring(divStart + 5, divEnd);
    lyrics = lyrics
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&#x27;/g, "'")
      .replace(/&#39;/g, "'")
      .replace(/\n{3,}/g, '\n\n')
      .trim();
    return lyrics.length > 20 ? lyrics : null;
  }

  /** Parse ChartLyrics XML response */
  function extractChartLyrics(xml: string): string | null {
    const match = xml.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
    if (!match || !match[1]) return null;
    const lyrics = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
    return lyrics.length > 20 ? lyrics : null;
  }

  ipcMain.handle(IPC_CHANNELS.LYRICS_FETCH, async (event, artist: string, title: string, duration?: number) => {
    assertMainRenderer(event, mainWindow);
    if (typeof artist !== 'string' || typeof title !== 'string' || artist.length > 500 || title.length > 500) throw new Error('Invalid lyrics query');
    // Duration comes from the playing audio element; it sharpens source matching.
    const dur = (typeof duration === 'number' && Number.isFinite(duration) && duration > 1 && duration < 24 * 3600) ? duration : undefined;
    const cacheKey = (artist + '|' + title + (dur ? '|d' + Math.round(dur) : '')).toLowerCase();
    if (lyricsCache.has(cacheKey)) return lyricsCache.get(cacheKey);

    function clean(t: string): string {
      return t
        .replace(/\s*[\(\[][^)\]]*(?:official|audio|video|lyric|lyrics|visualizer|music video|hd|hq|4k|remix|edit|original mix|extended|prod\.?)[^)\]]*[\)\]]/gi, '')
        .replace(/\s*(?:ft\.?|feat\.?|featuring)\s+.+$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }
    function cleanArtist(a: string): string {
      return a.replace(/\s*(?:ft\.?|feat\.?|featuring|&|,)\s+.+$/i, '').replace(/\s+/g, ' ').trim();
    }

    const variations: Array<{ artist: string; title: string }> = [];
    const seen = new Set<string>();
    function addVar(a: string, t: string) {
      a = a.trim(); t = t.trim();
      if (!a || !t) return;
      const k = a.toLowerCase() + '|' + t.toLowerCase();
      if (seen.has(k)) return;
      seen.add(k);
      variations.push({ artist: a, title: t });
    }

    if (title.includes(' - ')) {
      const parts = title.split(' - ');
      const splitArtist = parts[0].trim();
      const splitTitle = parts.slice(1).join(' - ').trim();
      addVar(splitArtist, clean(splitTitle));
      addVar(cleanArtist(splitArtist), clean(splitTitle));
      addVar(artist, clean(splitTitle));
    }

    addVar(cleanArtist(artist), clean(title));
    addVar(artist, title);
    addVar(artist, clean(title));
    addVar(cleanArtist(artist), title);

    const v0 = variations[0] || { artist, title };
    const searchQ = v0.artist + ' ' + v0.title;

    // ===== Phase 1: synced-capable sources, all in parallel =====
    // lrclib (exact gets incl. duration + two search flavours), NetEase LRC, QQ Music LRC.
    // Any synced result wins; lrclib ranks above the rest, then NetEase, then QQ Music.
    try {
      const lrclibPromises = variations.map(v =>
        fetchWithTimeout(
          `https://lrclib.net/api/get?artist_name=${encodeURIComponent(v.artist)}&track_name=${encodeURIComponent(v.title)}${dur ? '&duration=' + Math.round(dur) : ''}`,
          LYRICS_TIMEOUT
        ).then(async resp => (resp.ok ? await resp.json() as LrclibEntry : null)).catch(() => null)
      );

      const lrclibSearchPromises = [
        `https://lrclib.net/api/search?q=${encodeURIComponent(searchQ)}`,
        `https://lrclib.net/api/search?track_name=${encodeURIComponent(v0.title)}&artist_name=${encodeURIComponent(v0.artist)}`,
      ].map(url =>
        fetchWithTimeout(url, LYRICS_TIMEOUT)
          .then(async resp => (resp.ok ? await resp.json() as LrclibEntry[] : []))
          .catch(() => [] as LrclibEntry[])
      );

      const [exactEntries, searchLists, netease, qqmusic] = await Promise.all([
        Promise.all(lrclibPromises),
        Promise.all(lrclibSearchPromises),
        fetchNetease(searchQ, dur),
        fetchQQMusic(searchQ, dur),
      ]);

      const lrclib = pickLrclib(exactEntries.concat(...searchLists), dur);

      const synced = [lrclib, netease, qqmusic].find(r => r && r.syncedLyrics);
      if (synced) { lyricsCache.set(cacheKey, synced); return synced; }

      const earlyPlain = lrclib || netease;
      if (earlyPlain && earlyPlain.lyrics) { lyricsCache.set(cacheKey, earlyPlain); return earlyPlain; }
    } catch (e: any) { logWarn('Lyrics phase 1 failed:', e?.message); }

    // ===== Phase 2: plain-text sources (all parallel) =====
    try {
      // --- Genius scrape ---
      const geniusPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          const searchResp = await fetchWithTimeout(
            `https://genius.com/api/search/song?q=${encodeURIComponent(searchQ)}`,
            LYRICS_TIMEOUT + 2000, { headers: { 'User-Agent': CHROME_UA } }
          );
          if (!searchResp.ok) return null;
          const searchData = await searchResp.json() as { response?: { sections?: Array<{ hits?: Array<{ result?: { url?: string } }> }> } };
          const hits = searchData.response?.sections?.[0]?.hits || [];
          if (!hits.length || !hits[0].result?.url) return null;
          const pageResp = await fetchWithTimeout(hits[0].result.url, LYRICS_TIMEOUT + 2000, {
            headers: { 'User-Agent': CHROME_UA },
          });
          if (!pageResp.ok) return null;
          const lyrics = extractGeniusLyrics(await pageResp.text());
          return lyrics ? { lyrics, source: 'genius' } : null;
        } catch { return null; }
      })();

      // --- Musixmatch (macro API — used by desktop apps, no key needed) ---
      const musixmatchPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          if (!MUSIXMATCH_API_KEY) return null;
          // Step 1: search for the track
          const searchResp = await fetchWithTimeout(
            `https://api.musixmatch.com/ws/1.1/track.search?q_track=${encodeURIComponent(v0.title)}&q_artist=${encodeURIComponent(v0.artist)}&page_size=1&page=1&s_track_rating=desc&apikey=${MUSIXMATCH_API_KEY}`,
            LYRICS_TIMEOUT
          );
          if (!searchResp.ok) return null;
          const searchData = await searchResp.json() as any;
          const trackList = searchData?.message?.body?.track_list;
          if (!trackList || !trackList.length) return null;
          const trackId = trackList[0]?.track?.track_id;
          if (!trackId) return null;

          // Step 2: get lyrics
          const lyricsResp = await fetchWithTimeout(
            `https://api.musixmatch.com/ws/1.1/track.lyrics.get?track_id=${trackId}&apikey=${MUSIXMATCH_API_KEY}`,
            LYRICS_TIMEOUT
          );
          if (!lyricsResp.ok) return null;
          const lyricsData = await lyricsResp.json() as any;
          const lyricsBody = lyricsData?.message?.body?.lyrics?.lyrics_body;
          if (!lyricsBody || lyricsBody.length < 20) return null;
          // Musixmatch appends a commercial notice — remove it
          const cleaned = lyricsBody
            .replace(/\*{7,}.*$/s, '')
            .replace(/This Lyrics is NOT for Commercial use.*/s, '')
            .replace(/\.\.\.\s*$/, '')
            .trim();
          return cleaned.length > 20 ? { lyrics: cleaned, source: 'musixmatch' } : null;
        } catch { return null; }
      })();

      // --- lyrics.ovh ---
      const ovhPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          const resp = await fetchWithTimeout(
            `https://api.lyrics.ovh/v1/${encodeURIComponent(v0.artist)}/${encodeURIComponent(v0.title)}`,
            LYRICS_TIMEOUT
          );
          if (!resp.ok) return null;
          const data = await resp.json() as { lyrics?: string };
          if (data.lyrics && data.lyrics.trim().length > 10) return { lyrics: data.lyrics.trim(), source: 'lyrics.ovh' };
          return null;
        } catch { return null; }
      })();

      // --- AZLyrics scrape ---
      const azlyricsPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          // AZLyrics URL pattern: azlyrics.com/lyrics/artistname/songname.html
          const azArtist = v0.artist.toLowerCase().replace(/[^a-z0-9]/g, '');
          const azTitle = v0.title.toLowerCase().replace(/[^a-z0-9]/g, '');
          if (!azArtist || !azTitle) return null;
          const resp = await fetchWithTimeout(
            `https://www.azlyrics.com/lyrics/${azArtist}/${azTitle}.html`,
            LYRICS_TIMEOUT,
            { headers: { 'User-Agent': CHROME_UA } }
          );
          if (!resp.ok) return null;
          const lyrics = extractAZLyrics(await resp.text());
          return lyrics ? { lyrics, source: 'azlyrics' } : null;
        } catch { return null; }
      })();

      // --- ChartLyrics API (XML) ---
      const chartlyricsPromise = (async (): Promise<{ lyrics: string; source: string } | null> => {
        try {
          const resp = await fetchWithTimeout(
            `https://api.chartlyrics.com/apiv1.asmx/SearchLyricDirect?artist=${encodeURIComponent(v0.artist)}&song=${encodeURIComponent(v0.title)}`,
            LYRICS_TIMEOUT
          );
          if (!resp.ok) return null;
          const lyrics = extractChartLyrics(await resp.text());
          return lyrics ? { lyrics, source: 'chartlyrics' } : null;
        } catch { return null; }
      })();

      const results = await Promise.all([
        geniusPromise, musixmatchPromise, ovhPromise, azlyricsPromise, chartlyricsPromise,
        fetchLyrist(v0.artist, v0.title),
      ]);

      // Pick the best result — prefer longest lyrics (usually most complete)
      const valid = results.filter((r): r is { lyrics: string; source: string } => r !== null && r.lyrics.length > 20);
      if (valid.length > 0) {
        valid.sort((a, b) => b.lyrics.length - a.lyrics.length);
        const best = valid[0];
        lyricsCache.set(cacheKey, best);
        return best;
      }
    } catch (e: any) { logWarn('Lyrics phase 2 failed:', e?.message); }

    const noResult = { lyrics: null };
    lyricsCache.set(cacheKey, noResult);
    return noResult;
  });

  // Playlist batch download
  ipcMain.handle(IPC_CHANNELS.DOWNLOAD_PLAYLIST, async (event, playlistUrl: string, pageToken?: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof playlistUrl !== 'string' || !isTrustedSoundCloudUrl(playlistUrl) || playlistUrl.length > 2048) {
      throw new Error('Playlist URL must be an HTTPS SoundCloud URL');
    }
    if (pageToken !== undefined && (typeof pageToken !== 'string' || pageToken.length > 4096)) {
      throw new Error('Invalid page token');
    }
    logInfo(`[Playlist] Starting playlist download: ${playlistUrl}`);
    try {
      // Try to get OAuth token: store → page token → session cookies
      let token = (store.get('authToken.token') || '') as string;
      if (!token && pageToken) {
        token = pageToken;
        logInfo(`[Playlist] Using page token`);
      }
      if (!token) {
        try {
          const cookies = await session.defaultSession.cookies.get({ url: 'https://soundcloud.com', name: 'oauth_token' });
          if (cookies.length > 0) { token = cookies[0].value; logInfo(`[Playlist] Token from oauth_token cookie`); }
        } catch {}
      }
      if (!token) {
        try {
          const allCookies = await session.defaultSession.cookies.get({ url: 'https://soundcloud.com' });
          // Do not log cookie names or values: this session may contain auth tokens.
          logInfo(`[Playlist] Session cookies available: ${allCookies.length}`);
        } catch {}
      }
      logInfo(`[Playlist] OAuth token available: ${token ? 'yes' : 'no'}`);
      const headers: Record<string, string> = {};
      if (token) headers['Authorization'] = `OAuth ${token}`;

      let clientId = await getClientId();
      logInfo(`[Playlist] Using client_id: ${clientId}`);
      const resolveUrl = `${SOUNDCLOUD_API_V2}/resolve?url=${encodeURIComponent(playlistUrl)}&client_id=${clientId}`;
      logInfo(`[Playlist] Resolving: ${resolveUrl}`);
      let resolveResp = await eFetch(resolveUrl, { headers });
      logInfo(`[Playlist] Resolve response: ${resolveResp.status}`);

      let playlist: any = null;

      // If 404/403, try extracting playlist data from page hydration (works for private playlists)
      if (!resolveResp.ok && mainWindow && !mainWindow.isDestroyed()) {
        logInfo(`[Playlist] Resolve failed (${resolveResp.status}), trying page hydration...`);
        try {
          const pageData = await mainWindow.webContents.executeJavaScript(`
            (function() {
              try {
                var el = document.querySelector('#__sc_hydration');
                if (el) {
                  var data = JSON.parse(el.textContent || '[]');
                  var pl = data.find(function(e) { return e.hydratable === 'playlist'; });
                  if (pl && pl.data) return JSON.stringify(pl.data);
                }
              } catch(e) {}
              return null;
            })();
          `);
          if (pageData) {
            playlist = JSON.parse(pageData);
            logInfo(`[Playlist] Got playlist from hydration: "${playlist.title}", ${(playlist.tracks || []).length} tracks, secret token available: ${playlist.secret_token ? 'yes' : 'no'}`);

            // If we have secret_token, retry API with it
            if (playlist.secret_token) {
              const secretUrl = `${SOUNDCLOUD_API_V2}/playlists/${playlist.id}?secret_token=${playlist.secret_token}&client_id=${clientId}`;
              logInfo(`[Playlist] Retrying API with secret_token...`);
              const secretResp = await eFetch(secretUrl, { headers });
              if (secretResp.ok) {
                playlist = await secretResp.json();
                logInfo(`[Playlist] Secret API resolved: ${(playlist.tracks || []).length} tracks`);
              }
            }
          }
        } catch (e: any) {
          logInfo(`[Playlist] Page extraction failed: ${e?.message}`);
        }
        if (!playlist) throw new Error(`Resolve failed: ${resolveResp.status} — playlist may be private. Try logging in via OAuth Token.`);
      } else if (resolveResp.ok) {
        playlist = await resolveResp.json();
      } else {
        throw new Error(`Resolve failed: ${resolveResp.status}`);
      }

      // SoundCloud returns "mini" track objects for large playlists — need to fetch full tracks by ID
      let tracks = (playlist.tracks || []).filter((t: any) => t && t.id);
      logInfo(`[Playlist] Resolved ${tracks.length} tracks (track_count: ${playlist.track_count || '?'})`);
      if (tracks.length > 0) {
        logInfo(`[Playlist] First track sample: id=${tracks[0].id}, title=${tracks[0].title}, user=${tracks[0].user?.username}`);
      }

      // If tracks have no title, they are mini objects — fetch full info in batches of 50
      const miniTracks = tracks.filter((t: any) => !t.title);
      if (miniTracks.length > 0) {
        logInfo(`[Playlist] Fetching ${miniTracks.length} mini tracks in batches...`);
        for (let b = 0; b < miniTracks.length; b += 50) {
          const batch = miniTracks.slice(b, b + 50);
          const ids = batch.map((t: any) => t.id).join(',');
          try {
            const batchResp = await eFetch(`${SOUNDCLOUD_API_V2}/tracks?ids=${ids}&client_id=${clientId}`, { headers });
            logInfo(`[Playlist] Batch ${b/50 + 1} response: ${batchResp.status}`);
            if (batchResp.ok) {
              const fullTracks = await batchResp.json() as Array<any>;
              logInfo(`[Playlist] Got ${fullTracks.length} full tracks in batch`);
              const fullMap = new Map(fullTracks.map((ft: any) => [ft.id, ft]));
              for (const mt of batch) {
                const full = fullMap.get(mt.id);
                if (full) Object.assign(mt, full);
              }
            }
          } catch (e: any) {
            logInfo(`[Playlist] Batch fetch failed: ${e?.message}`);
          }
        }
      }

      // Create output directory and temp playlist subfolder
      const outputDir = (store.get('downloader.outputDir') || path.join(app.getPath('music'), 'SixteenCloud')) as string;
      if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });

      const playlistName = (playlist.title || 'playlist').replace(/[<>:"/\\|?*]/g, '_').substring(0, 100);
      const playlistTempDir = path.join(outputDir, '.' + playlistName + '_temp_' + Date.now());
      fs.mkdirSync(playlistTempDir, { recursive: true });
      const downloadedFiles: string[] = [];

      logInfo(`[Playlist] Starting download of ${tracks.length} tracks to ${playlistTempDir}`);
      for (let i = 0; i < tracks.length; i++) {
        const track = tracks[i];
        safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
          trackId: 'playlist-' + track.id,
          percent: 0,
          status: 'downloading',
          playlistIndex: i,
          playlistTotal: tracks.length,
          trackName: (track.title || 'Track ' + (i + 1)) + (track.user?.username ? ' — ' + track.user.username : ''),
        });

        logInfo(`[Playlist] Downloading track ${i + 1}/${tracks.length}: ${track.title || track.id}`);
        try {
          const request: DownloadRequest = {
            trackUrl: track.permalink_url || `https://soundcloud.com/track/${track.id}`,
            trackId: String(track.id),
            title: track.title || `Track ${i + 1}`,
            artist: track.user?.username || 'Unknown',
            artworkUrl: track.artwork_url || '',
            quality: (store.get('downloader.quality') || '128') as '128' | '256' | 'original',
            album: playlist.title || 'SoundCloud',
            trackNumber: i + 1,
          };

          const trackApiUrl = `${SOUNDCLOUD_API_V2}/tracks/${track.id}?client_id=${clientId}`;
          logInfo(`[Playlist] Fetching track API: ${trackApiUrl}`);
          const trackResp = await eFetch(trackApiUrl, { headers });
          logInfo(`[Playlist] Track API response: ${trackResp.status}`);
          if (!trackResp.ok) { logInfo(`[Playlist] Skipping track ${track.id}: API returned ${trackResp.status}`); continue; }
          const trackData = await trackResp.json() as { genre?: string; created_at?: string; release_date?: string; media?: { transcodings?: Array<{ url: string; format: { protocol: string } }> } };

          const transcodings = trackData.media?.transcodings || [];
          logInfo(`[Playlist] Found ${transcodings.length} transcodings for track ${track.id}`);
          let streamInfo = transcodings.find((t: { format: { protocol: string } }) => t.format.protocol === 'progressive');
          if (!streamInfo) streamInfo = transcodings[0];
          if (!streamInfo) { logInfo(`[Playlist] No transcodings for track ${track.id}, skipping`); continue; }

          const streamSep = streamInfo.url.includes('?') ? '&' : '?';
          const streamFetchUrl = streamInfo.url + streamSep + 'client_id=' + clientId;
          logInfo(`[Playlist] Fetching stream URL for track ${track.id}`);
          const streamResp = await eFetch(streamFetchUrl, { headers });
          logInfo(`[Playlist] Stream URL response: ${streamResp.status}`);
          if (!streamResp.ok) { logInfo(`[Playlist] Stream URL failed for track ${track.id}`); continue; }
          const streamData = await streamResp.json() as { url: string };
          if (!isAllowedMediaUrl(streamData.url)) { logInfo(`[Playlist] Unsafe stream URL for track ${track.id}, skipping`); continue; }

          safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
            trackId: 'playlist-' + track.id, percent: 50, status: 'downloading',
            playlistIndex: i, playlistTotal: tracks.length,
            trackName: request.title + ' — ' + request.artist,
          });

          logInfo(`[Playlist] Downloading audio for track ${track.id}`);
          const audioResp = await eFetch(streamData.url);
          logInfo(`[Playlist] Audio response: ${audioResp.status}`);
          if (!audioResp.ok) { logInfo(`[Playlist] Audio download failed for track ${track.id}`); continue; }
          const audioBuffer = await readResponseBuffer(audioResp, 500 * 1024 * 1024);
          logInfo(`[Playlist] Downloaded ${audioBuffer.length} bytes for track ${track.id}`);

          const safeName = (request.artist + ' - ' + request.title).replace(/[<>:"/\\|?*]/g, '_').substring(0, 200);
          const tempFile = path.join(playlistTempDir, safeName + '.tmp');
          const outputFile = path.join(playlistTempDir, safeName + '.mp3');
          fs.writeFileSync(tempFile, audioBuffer);

          safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
            trackId: 'playlist-' + track.id, percent: 80, status: 'converting',
            playlistIndex: i, playlistTotal: tracks.length,
            trackName: request.title + ' — ' + request.artist,
          });

          let ffmpegPath: string;
          try {
            ffmpegPath = resolveFfmpegPath();
            const bitrate = request.quality === 'original' ? '320k' : request.quality + 'k';

            // Download artwork for cover
            let coverFile: string | null = null;
            if (request.artworkUrl) {
              try {
                let artUrl = request.artworkUrl;
                artUrl = artUrl.replace(/-large\./, '-t500x500.').replace(/-[a-z0-9]+x[a-z0-9]+\./, '-t500x500.');
                if (!artUrl.includes('t500x500')) {
                  artUrl = artUrl.replace(/-\w+(\.\w+)$/, '-t500x500$1');
                }
                const coverResp = await eFetch(artUrl);
                if (coverResp.ok) {
                  const coverBuf = await readResponseBuffer(coverResp, 20 * 1024 * 1024);
                  coverFile = path.join(playlistTempDir, safeName + '.cover.jpg');
                  fs.writeFileSync(coverFile, coverBuf);
                }
              } catch { /* artwork failed, continue without */ }
            }

            const isHls = isHlsPlaylistBuffer(audioBuffer);
            const ffmpegArgs: string[] = isHls
              ? ['-protocol_whitelist', 'file,http,https,tcp,tls,crypto', '-f', 'hls', '-i', tempFile]
              : ['-i', tempFile];
            if (coverFile) {
              ffmpegArgs.push('-i', coverFile, '-map', '0:a', '-map', '1:v', '-c:v', 'copy', '-disposition:v:0', 'attached_pic');
            }

            const dateSource = trackData.release_date || trackData.created_at || '';
            const year = dateSource ? dateSource.substring(0, 4) : '';
            const genre = trackData.genre || '';

            ffmpegArgs.push(
              '-c:a', 'libmp3lame', '-b:a', bitrate,
              '-id3v2_version', '3',
              '-metadata', `title=${escMeta(request.title)}`,
              '-metadata', `artist=${escMeta(request.artist)}`,
              '-metadata', `album=${escMeta(request.album || request.artist)}`,
            );
            if (genre) ffmpegArgs.push('-metadata', `genre=${escMeta(genre)}`);
            if (year) ffmpegArgs.push('-metadata', `date=${year}`);
            if (request.trackNumber) ffmpegArgs.push('-metadata', `track=${request.trackNumber}`);
            ffmpegArgs.push('-y', outputFile);

            await new Promise<void>((resolve, reject) => {
              execFile(ffmpegPath, ffmpegArgs, (error) => {
                if (!error) { resolve(); return; }
                if ((error as NodeJS.ErrnoException).code === 'ENOENT' && !isHls) {
                  try { fs.renameSync(tempFile, outputFile); resolve(); return; } catch (renameErr) { reject(renameErr); return; }
                }
                reject(error);
              });
            });
            try { fs.unlinkSync(tempFile); } catch {}
            if (coverFile) { try { fs.unlinkSync(coverFile); } catch {} }
          } catch {
            fs.renameSync(tempFile, outputFile);
          }

          downloadedFiles.push(outputFile);
          safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
            trackId: 'playlist-' + track.id,
            percent: 100,
            status: 'complete',
            playlistIndex: i,
            playlistTotal: tracks.length,
            trackName: (request.title || 'Track ' + (i + 1)) + ' — ' + (request.artist || ''),
          });
          logInfo(`[Playlist] Track ${i + 1} done: ${request.title}`);
        } catch (err) {
          logInfo(`[Playlist] Track ${i + 1} error: ${err}`);
          safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
            trackId: 'playlist-' + track.id,
            percent: 0,
            status: 'error',
            error: String(err),
            playlistIndex: i,
            playlistTotal: tracks.length,
          });
        }
      }

      // Pack downloaded tracks into zip archive
      if (downloadedFiles.length > 0) {
        const zipPath = path.join(outputDir, playlistName + '.zip');
        logInfo(`[Playlist] Creating zip: ${zipPath} (${downloadedFiles.length} files)`);

        safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_PROGRESS, {
          trackId: 'playlist-zip', percent: 99, status: 'zipping',
          playlistIndex: tracks.length - 1, playlistTotal: tracks.length,
          trackName: playlistName + '.zip',
        });

        await new Promise<void>((resolve, reject) => {
          const output = fs.createWriteStream(zipPath);
          const archive = archiver('zip', { zlib: { level: 1 } }); // fast compression
          output.on('close', () => resolve());
          archive.on('error', (err: Error) => reject(err));
          archive.pipe(output);

          for (const filePath of downloadedFiles) {
            if (fs.existsSync(filePath)) {
              archive.file(filePath, { name: path.basename(filePath) });
            }
          }
          archive.finalize();
        });

        logInfo(`[Playlist] Zip created! Cleaning up temp dir...`);
        // Remove temp directory
        for (const filePath of downloadedFiles) {
          try { fs.unlinkSync(filePath); } catch {}
        }
        try { fs.rmdirSync(playlistTempDir); } catch {}
      }

      logInfo(`[Playlist] All done! ${downloadedFiles.length}/${tracks.length} tracks`);
      safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_COMPLETE, { playlistDone: true, total: downloadedFiles.length });
    } catch (err) {
      logInfo(`[Playlist] Fatal error: ${err}`);
      safeSend(mainWindow, IPC_CHANNELS.DOWNLOAD_COMPLETE, { error: String(err) });
    }
  });

  // Sidebar navigate
  ipcMain.on(IPC_CHANNELS.SIDEBAR_NAVIGATE, (event, url: string) => {
    assertMainRenderer(event, mainWindow);
    if (!isTrustedSoundCloudUrl(url)) return;
    if (!mainWindow.isDestroyed()) mainWindow.loadURL(url);
  });

  // Updater check
  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async (event) => {
    assertMainRenderer(event, mainWindow);
    try {
      const { checkForUpdatesManual } = require('./updater');
      return await checkForUpdatesManual();
    } catch {
      return { available: false };
    }
  });

  // Media controls
  ipcMain.on(IPC_CHANNELS.MEDIA_PLAY_PAUSE, (event) => {
    assertMainRenderer(event, mainWindow);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`document.querySelector('.playControl')?.click();`);
    }
  });

  ipcMain.on(IPC_CHANNELS.MEDIA_NEXT, (event) => {
    assertMainRenderer(event, mainWindow);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`document.querySelector('.skipControl__next')?.click();`);
    }
  });

  ipcMain.on(IPC_CHANNELS.MEDIA_PREV, (event) => {
    assertMainRenderer(event, mainWindow);
    if (!mainWindow.isDestroyed()) {
      mainWindow.webContents.executeJavaScript(`document.querySelector('.skipControl__previous')?.click();`);
    }
  });

  // Watch for launch-on-startup setting changes
  store.onDidChange('settings', (newVal) => {
    const settings = newVal as StoreSchema['settings'] | undefined;
    if (settings) {
      app.setLoginItemSettings({
        openAtLogin: settings.launchOnStartup,
      });
    }
  });
}

import { ipcMain, session, type BrowserWindow } from 'electron';
import { CHROME_UA, IPC_CHANNELS } from '../../shared/constants';
import { isTrustedSoundCloudUrl } from '../../shared/security';
import { clickScript } from '../../shared/sc-selectors';
import { getCoverPalette } from '../cover-palette';
import { checkForUpdatesManual } from '../updater';
import { assertMainRenderer } from './guard';
import { eFetch } from './net';
import { getStore } from './store';

const PROXY_RE = /^(https?|socks5):\/\//i;

/** Window chrome, cache, adblock lists, geo proxy, navigation, updater and media keys. */
export function setupAppIPC(mainWindow: BrowserWindow): void {
  const store = getStore();
  const runInMain = (script: string) => {
    if (!mainWindow.isDestroyed()) mainWindow.webContents.executeJavaScript(script).catch(() => {});
  };

  // Cover-art palette for the player visualizer (SoundCloud artwork hosts only).
  ipcMain.handle(IPC_CHANNELS.COVER_PALETTE, async (event, url: unknown) => {
    assertMainRenderer(event, mainWindow);
    return getCoverPalette(url);
  });

  ipcMain.on(IPC_CHANNELS.WINDOW_MINIMIZE, (event) => {
    assertMainRenderer(event, mainWindow);
    mainWindow.minimize();
  });
  ipcMain.on(IPC_CHANNELS.WINDOW_MAXIMIZE, (event) => {
    assertMainRenderer(event, mainWindow);
    if (mainWindow.isMaximized()) mainWindow.unmaximize(); else mainWindow.maximize();
  });
  ipcMain.on(IPC_CHANNELS.WINDOW_CLOSE, (event) => {
    assertMainRenderer(event, mainWindow);
    mainWindow.close();
  });
  ipcMain.handle(IPC_CHANNELS.WINDOW_IS_MAXIMIZED, (event) => {
    assertMainRenderer(event, mainWindow);
    return mainWindow.isMaximized();
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_CLEAR_CACHE, async (event) => {
    assertMainRenderer(event, mainWindow);
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData();
  });

  ipcMain.handle(IPC_CHANNELS.AD_TOGGLE, (event, enabled: boolean) => {
    assertMainRenderer(event, mainWindow);
    store.set('adblocker.enabled', enabled === true);
  });

  ipcMain.handle(IPC_CHANNELS.AD_UPDATE_LISTS, async (event) => {
    assertMainRenderer(event, mainWindow);
    try {
      const response = await eFetch('https://raw.githubusercontent.com/ocb2016/ocbbio/main/adlist.json');
      let remoteDomains: string[] = [];
      if (response.ok) {
        const data = await response.json() as { domains?: unknown; list?: unknown };
        const list = Array.isArray(data.domains) ? data.domains : Array.isArray(data.list) ? data.list : [];
        remoteDomains = list.filter((d): d is string => typeof d === 'string' && d.length < 256).slice(0, 20000);
      }
      store.set('adblocker.remoteDomains', remoteDomains);
      store.set('adblocker.lastUpdated', new Date().toISOString());
      return { success: true, count: remoteDomains.length };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.GEO_SET_PROXY, async (event, proxyUrl: string, country: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof proxyUrl !== 'string' || proxyUrl.length > 2048 || (proxyUrl && !PROXY_RE.test(proxyUrl))) throw new Error('Invalid proxy URL');
    if (typeof country !== 'string' || !/^[A-Za-z]{2}$/.test(country)) throw new Error('Invalid country');
    store.set('geoBypass.proxyUrl', proxyUrl);
    store.set('geoBypass.spoofCountry', country);
    await session.defaultSession.setProxy({ proxyRules: proxyUrl || '' });
  });

  ipcMain.handle(IPC_CHANNELS.GEO_TEST_PROXY, async (event, proxyUrl: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof proxyUrl !== 'string' || proxyUrl.length > 2048 || !proxyUrl || !PROXY_RE.test(proxyUrl)) return false;
    // Test through a throwaway session: changing defaultSession here would
    // reroute the whole app through a proxy the user only meant to probe.
    const testSession = session.fromPartition(`geo-proxy-test-${Date.now()}`, { cache: false });
    try {
      await testSession.setProxy({ proxyRules: proxyUrl });
      const response = await testSession.fetch('https://api.ipify.org?format=json', {
        headers: { 'User-Agent': CHROME_UA },
        signal: AbortSignal.timeout(8000),
      });
      return response.ok;
    } catch {
      return false;
    } finally {
      try { await testSession.setProxy({ proxyRules: '' }); } catch { /* session is disposable */ }
      try { await testSession.clearStorageData(); } catch { /* session is disposable */ }
      try { await testSession.closeAllConnections(); } catch { /* already closed */ }
    }
  });

  ipcMain.on(IPC_CHANNELS.SIDEBAR_NAVIGATE, (event, url: string) => {
    assertMainRenderer(event, mainWindow);
    if (!isTrustedSoundCloudUrl(url)) return;
    if (!mainWindow.isDestroyed()) mainWindow.loadURL(url);
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_CHECK, async (event) => {
    assertMainRenderer(event, mainWindow);
    try {
      return await checkForUpdatesManual();
    } catch {
      return { available: false };
    }
  });

  ipcMain.on(IPC_CHANNELS.MEDIA_PLAY_PAUSE, (event) => {
    assertMainRenderer(event, mainWindow);
    runInMain(clickScript('PLAY'));
  });
  ipcMain.on(IPC_CHANNELS.MEDIA_NEXT, (event) => {
    assertMainRenderer(event, mainWindow);
    runInMain(clickScript('NEXT'));
  });
  ipcMain.on(IPC_CHANNELS.MEDIA_PREV, (event) => {
    assertMainRenderer(event, mainWindow);
    runInMain(clickScript('PREV'));
  });
}

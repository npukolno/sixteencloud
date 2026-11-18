import { BrowserWindow, session, shell } from 'electron';
import path from 'path';
import { CHROME_UA, SOUNDCLOUD_URL, WINDOW_CONFIG } from '../shared/constants';
import { UA_SUMMARY } from '../shared/user-agent';
import { isSafeExternalUrl, isTrustedOAuthUrl, isTrustedSoundCloudUrl } from '../shared/security';
import { getStore } from './ipc';
import { AUTH_PRELOAD, trackAuthWindow } from './auth-windows';
import { logInfo, logWarn } from './logger';
import { runInPage } from './page';

const SPLASH_MIN_MS = 1200; // logo, wordmark and spinner are in by ~1.1 s (splash.html)
const SPLASH_FADE_MS = 320; // .fade-out in splash.html runs 0.3 s
const REVEAL_FALLBACK_MS = 4000; // error pages may never get overlays
const FORCE_SHOW_MS = 12000;

export function createSplash(): BrowserWindow {
  const splashPath = path.join(__dirname, '../../src/renderer/splash.html');
  const splash = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    center: true,
    backgroundColor: '#111',
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  splash.webContents.setUserAgent(CHROME_UA);
  splash.loadFile(splashPath).catch((e: any) => logWarn('Splash load error:', e?.message));
  return splash;
}

function fadeOutSplash(splash: BrowserWindow | null): void {
  if (!splash || splash.isDestroyed()) return;
  // The splash is always on top: let it fade out over the main window
  // instead of vanishing in one frame.
  splash.webContents.executeJavaScript("document.getElementById('splash').classList.add('fade-out')").catch(() => {});
  setTimeout(() => { if (!splash.isDestroyed()) splash.close(); }, SPLASH_FADE_MS);
}

function openAuthPopup(win: BrowserWindow, url: string): void {
  const authWin = new BrowserWindow({
    width: 500,
    height: 700,
    parent: win,
    modal: false,
    autoHideMenuBar: true,
    webPreferences: { preload: AUTH_PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  trackAuthWindow(authWin.webContents, authWin, win);
  authWin.loadURL(url);
  // When OAuth redirects back to SoundCloud, finish in the main window.
  const onNavigate = (event: Electron.Event, navUrl: string, external: boolean) => {
    if (isTrustedSoundCloudUrl(navUrl)) {
      win.loadURL(navUrl);
      authWin.close();
    } else if (!isTrustedOAuthUrl(navUrl)) {
      event.preventDefault();
      if (external && isSafeExternalUrl(navUrl)) shell.openExternal(navUrl).catch(() => {});
    }
  };
  authWin.webContents.on('will-navigate', (event, navUrl) => onNavigate(event, navUrl, true));
  authWin.webContents.on('will-redirect', (event, navUrl) => onNavigate(event, navUrl, false));
}

function installNavigationGuards(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(({ url }) => {
    // about:blank popups are intermediate OAuth steps that SoundCloud later
    // navigates to the provider. They must not inherit the privileged preload.
    if (url === 'about:blank') {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: {
          autoHideMenuBar: true,
          webPreferences: { preload: AUTH_PRELOAD, nodeIntegration: false, contextIsolation: true, sandbox: true },
        },
      };
    }
    try {
      if (isTrustedSoundCloudUrl(url)) {
        win.loadURL(url);
        return { action: 'deny' };
      }
      if (isTrustedOAuthUrl(url)) {
        openAuthPopup(win, url);
        return { action: 'deny' };
      }
    } catch (e: any) {
      logWarn('Invalid URL in window open handler:', e?.message);
    }
    if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Never let the privileged main window navigate to arbitrary content.
  win.webContents.on('will-navigate', (event, url) => {
    if (url === 'about:blank' || isTrustedSoundCloudUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
  });

  // about:blank popups that later navigate to an OAuth provider.
  win.webContents.on('did-create-window', (childWindow) => {
    trackAuthWindow(childWindow.webContents, childWindow, win);
    childWindow.webContents.on('will-navigate', (_event, navUrl) => {
      if (isTrustedOAuthUrl(navUrl)) return;
      if (isTrustedSoundCloudUrl(navUrl)) win.loadURL(navUrl);
      childWindow.close();
    });
  });
}

function installLoadRecovery(win: BrowserWindow): void {
  let loadFailureCount = 0;
  win.webContents.on('did-fail-load', (_event, errorCode, _desc, validatedURL, isMainFrame) => {
    // Aborted requests (user navigated away) and subframe errors are normal.
    if (errorCode === -3 || !isMainFrame) return;
    loadFailureCount += 1;
    // Give up after a few attempts (e.g. offline) instead of reloading forever.
    if (loadFailureCount > 5) {
      logWarn(`[SixteenCloud] Page load keeps failing (${errorCode}) after ${loadFailureCount} attempts; not retrying.`);
      return;
    }
    logInfo(`[SixteenCloud] Page load failed (${errorCode}), attempt ${loadFailureCount}/5: ${validatedURL}`);
    setTimeout(() => { if (!win.isDestroyed()) win.loadURL(SOUNDCLOUD_URL); }, 2000);
  });
  // A non-SoundCloud page (e.g. Electron's default) means something went wrong.
  win.webContents.on('did-finish-load', () => {
    loadFailureCount = 0;
    const url = win.webContents.getURL();
    if (!isTrustedSoundCloudUrl(url)) {
      logInfo(`[SixteenCloud] Non-SoundCloud page loaded (${url}), redirecting...`);
      win.loadURL(SOUNDCLOUD_URL);
    }
  });
}

export interface MainWindowOptions {
  splash: BrowserWindow | null;
  /**
   * Called on every dom-ready. Queue all page injections here, in order:
   * the window is revealed once everything queued has run.
   */
  injectPage: (win: BrowserWindow) => void;
}

export function createMainWindow(opts: MainWindowOptions): BrowserWindow {
  const iconFile = process.platform === 'win32' ? 'icon.ico' : 'icon.png';
  const win = new BrowserWindow({
    width: WINDOW_CONFIG.width,
    height: WINDOW_CONFIG.height,
    minWidth: WINDOW_CONFIG.minWidth,
    minHeight: WINDOW_CONFIG.minHeight,
    title: 'SixteenCloud',
    icon: path.join(__dirname, '../../assets/icons', iconFile),
    webPreferences: {
      preload: path.join(__dirname, '../preload/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      spellcheck: false,
      enableWebSQL: false,
      // Let Chromium throttle hidden UI work while keeping media playback alive.
      backgroundThrottling: true,
    },
    frame: false,
    show: false,
    backgroundColor: '#111',
  });
  win.setMenu(null);
  win.webContents.setUserAgent(CHROME_UA);
  session.defaultSession.setUserAgent(CHROME_UA);
  logInfo(`[SixteenCloud] Browser fingerprint: ${UA_SUMMARY}`);
  win.webContents.setMaxListeners(20);

  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      const src = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : '';
      logWarn(`[page:${details.level}] ${details.message}${src}`);
    }
  });

  win.loadURL(SOUNDCLOUD_URL);
  installLoadRecovery(win);
  installNavigationGuards(win);

  // The splash stays up until SoundCloud has painted and our overlays are in,
  // but never shorter than its intro animation. startMinimized is honoured.
  let splash = opts.splash;
  const shownAt = Date.now();
  let painted = false;
  let overlaysReady = false;
  let revealed = false;
  const reveal = () => {
    if (revealed || win.isDestroyed()) return;
    revealed = true;
    fadeOutSplash(splash);
    splash = null;
    if (getStore()?.get('settings.startMinimized')) {
      win.hide();
      return;
    }
    win.show();
    win.focus();
  };
  const revealWhenReady = () => {
    if (painted && overlaysReady) setTimeout(reveal, Math.max(0, shownAt + SPLASH_MIN_MS - Date.now()));
  };
  win.once('ready-to-show', () => {
    logInfo(`[SixteenCloud] ready-to-show fired after ${Date.now() - shownAt} ms`);
    painted = true;
    revealWhenReady();
    setTimeout(reveal, REVEAL_FALLBACK_MS);
  });
  setTimeout(() => {
    if (!revealed) logInfo('[SixteenCloud] Fallback: forcing window visible');
    reveal();
  }, FORCE_SHOW_MS);

  // One ordered pipeline per page load. dom-ready, not did-finish-load: the
  // latter also waits for every ad and tracker script on the page.
  win.webContents.on('dom-ready', () => {
    opts.injectPage(win);
    if (overlaysReady) return;
    // Scripts run in the order they were queued, so this resolves once
    // everything injectPage queued has executed.
    setImmediate(() => {
      if (win.isDestroyed()) return;
      runInPage(win, '0').catch(() => {}).finally(() => {
        logInfo(`[SixteenCloud] Overlays injected after ${Date.now() - shownAt} ms`);
        overlaysReady = true;
        revealWhenReady();
      });
    });
  });

  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle('SixteenCloud');
  });

  // Mouse back/forward buttons (Windows app-command).
  win.on('app-command' as any, (_event: unknown, cmd: string) => {
    const history = win.webContents.navigationHistory;
    if (cmd === 'browser-backward' && history.canGoBack()) history.goBack();
    else if (cmd === 'browser-forward' && history.canGoForward()) history.goForward();
  });

  return win;
}

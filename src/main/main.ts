import { app, BrowserWindow, session, globalShortcut, ipcMain, shell, screen } from 'electron';
import path from 'path';
import fs from 'fs';
import { spawn, execFile } from 'child_process';
import { SOUNDCLOUD_URL, WINDOW_CONFIG, IPC_CHANNELS, AD_DOMAINS, AD_CSS_SELECTORS, AD_URL_PATTERNS, CHROME_UA } from '../shared/constants';
import { applyUserAgentHeaders, UA_SUMMARY } from '../shared/user-agent';
import { setupIPC, getStore, getEncryptionKey } from './ipc';
import { createTray, destroyTray, setMiniPlayerToggle } from './tray';
import { checkForUpdates, setupUpdaterIPC } from './updater';
import { setupDiscordRPC, destroyDiscordRPC } from './discord';
import { setupOfflineCache } from './offline-cache';
import { configureLinuxPaths, setupLinuxDesktopIntegration, destroyLinuxDesktopIntegration } from './linux-integration';
import { setLanguage, t } from '../shared/i18n';
import { logInfo, logWarn } from './logger';
import { getAdblockerOverlayHTML, getAdblockerOverlayScript } from '../renderer/overlays/adblocker';
import { getAuthTokenOverlayHTML, getAuthTokenOverlayScript } from '../renderer/overlays/auth-token';
import { getGeoBypassOverlayHTML, getGeoBypassOverlayScript } from '../renderer/overlays/geo-bypass';
import { getDownloaderOverlayHTML, getDownloaderOverlayScript } from '../renderer/overlays/downloader';
import { getDiscordRpOverlayHTML, getDiscordRpOverlayScript } from '../renderer/overlays/discord-rp';
import { getSettingsOverlayHTML, getSettingsOverlayScript } from '../renderer/overlays/settings';
import { getHistoryOverlayHTML, getHistoryOverlayScript } from '../renderer/overlays/history';
import { getLyricsOverlayHTML, getLyricsOverlayScript } from '../renderer/overlays/lyrics';
import { getThemesOverlayHTML, getThemesOverlayScript } from '../renderer/overlays/themes';
import { getCustomCssOverlayHTML, getCustomCssOverlayScript } from '../renderer/overlays/custom-css';
import { getSidebarOverlayHTML, getSidebarOverlayScript } from '../renderer/overlays/sidebar';
import { getTitlebarScript } from '../renderer/overlays/titlebar';
import { getOfflineOverlayHTML, getOfflineOverlayScript } from '../renderer/overlays/offline';
import { getEqualizerOverlayHTML, getEqualizerOverlayScript } from '../renderer/overlays/equalizer';
import { getVisualizerScript } from '../renderer/overlays/visualizer';
import { isSafeExternalUrl, isTrustedOAuthUrl, isTrustedSoundCloudUrl } from '../shared/security';
import { matchesCombo, resolveKeybinds, type KeybindAction } from '../shared/keybinds';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;
let miniPlayerWindow: BrowserWindow | null = null;

configureLinuxPaths();

// The volume mixer and MPRIS read the app identity from the PulseAudio client,
// where Chromium hardcodes its own name and icon. Force ours; the desktop entry
// (with icon_name=sixteencloud) is written by linux-integration on startup.
if (process.platform === 'linux') {
  app.setDesktopName('SixteenCloud.desktop');
  if (!process.env.PULSE_PROP_OVERRIDE) {
    process.env.PULSE_PROP_OVERRIDE =
      'application.name=SixteenCloud application.icon_name=sixteencloud media.role=Music';
  }
}

// Every session and net.request inherits this UA unless set explicitly, so the
// splash/mini-player/auth windows never advertise Electron to SoundCloud.
app.userAgentFallback = CHROME_UA;

// Chromium flags — set before app is ready
app.commandLine.appendSwitch('enable-features', 'DnsOverHttps,GlobalShortcutsPortal');
app.commandLine.appendSwitch('dns-over-https-mode', 'automatic');
app.commandLine.appendSwitch('dns-over-https-server', 'https://1.1.1.1/dns-query');

function createWindow(): BrowserWindow {
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

  // Remove default menu
  win.setMenu(null);

  // Set user agent to regular Chrome BEFORE loading
  win.webContents.setUserAgent(CHROME_UA);
  session.defaultSession.setUserAgent(CHROME_UA);
  logInfo(`[SixteenCloud] Browser fingerprint: ${UA_SUMMARY}`);

  // Increase max listeners — we attach many event handlers for overlays, keybinds, etc.
  win.webContents.setMaxListeners(20);

  // Surface page and preload console errors in the app log.
  win.webContents.on('console-message', (details) => {
    if (details.level === 'error' || details.level === 'warning') {
      const src = details.sourceId ? ` (${details.sourceId}:${details.lineNumber})` : '';
      logWarn(`[page:${details.level}] ${details.message}${src}`);
    }
  });

  // Load SoundCloud
  win.loadURL(SOUNDCLOUD_URL);

  // Auto-reload on load failures (fixes pages not loading on first try)
  let loadFailureCount = 0;
  win.webContents.on('did-fail-load', (_event, errorCode, _errorDescription, validatedURL, isMainFrame) => {
    // Ignore aborted requests (user navigated away) and subframe errors
    if (errorCode === -3 || !isMainFrame) return;
    loadFailureCount += 1;
    // Give up after a few attempts on a persistent failure (e.g. offline) so we
    // do not hammer the network with an endless reload loop every 2 seconds.
    if (loadFailureCount > 5) {
      logWarn(`[SixteenCloud] Page load keeps failing (${errorCode}) after ${loadFailureCount} attempts; not retrying.`);
      return;
    }
    logInfo(`[SixteenCloud] Page load failed (${errorCode}), attempt ${loadFailureCount}/5: ${validatedURL}`);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        win.loadURL(SOUNDCLOUD_URL);
      }
    }, 2000);
  });

  // If page loaded but URL is not SoundCloud (e.g. default Electron page), reload
  win.webContents.on('did-finish-load', () => {
    loadFailureCount = 0;
    const url = win.webContents.getURL();
    if (!isTrustedSoundCloudUrl(url)) {
      logInfo(`[SixteenCloud] Non-SoundCloud page loaded (${url}), redirecting...`);
      win.loadURL(SOUNDCLOUD_URL);
    }
  });

  // Show when ready (respect startMinimized)
  const splashMinTime = Date.now() + 3000; // splash visible for at least 6.5 seconds
  win.once('ready-to-show', () => {
    logInfo('[SixteenCloud] ready-to-show fired');
    const closeSplashAndShow = () => {
      if (splashWindow && !splashWindow.isDestroyed()) {
        splashWindow.close();
        splashWindow = null;
      }
      const Store = require('electron-store');
      try {
        const s = new Store({ encryptionKey: getEncryptionKey() });
        if (s.get('settings.startMinimized')) {
          win.hide();
          return;
        }
      } catch (e: any) { logWarn('Failed to check startMinimized:', e?.message); }
      win.show();
      win.focus();
    };
    const remaining = splashMinTime - Date.now();
    if (remaining > 0) {
      setTimeout(closeSplashAndShow, remaining);
    } else {
      closeSplashAndShow();
    }
  });

  // Fallback: if window still not visible after 12s, force show
  setTimeout(() => {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    if (!win.isDestroyed() && !win.isVisible()) {
      logInfo('[SixteenCloud] Fallback: forcing window visible');
      win.show();
      win.focus();
    }
  }, 12000);

  // Override title on every page to "SixteenCloud"
  win.on('page-title-updated', (event) => {
    event.preventDefault();
    win.setTitle('SixteenCloud');
  });

  // Handle new window requests (popups, OAuth, external links)
  win.webContents.setWindowOpenHandler(({ url }) => {
    // about:blank popups are intermediate OAuth steps — allow them as a new window
    if (url === 'about:blank') {
      return { action: 'allow' };
    }

    try {
      // SoundCloud URLs — load in main window
      if (isTrustedSoundCloudUrl(url)) {
        win.loadURL(url);
        return { action: 'deny' };
      }

      // OAuth provider URLs — open in a child BrowserWindow
      if (isTrustedOAuthUrl(url)) {
        const authWin = new BrowserWindow({
          width: 500,
          height: 700,
          parent: win,
          modal: false,
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            sandbox: true,
          },
        });
        authWin.loadURL(url);

        // When OAuth redirects back to SoundCloud, load it in main window and close popup
        authWin.webContents.on('will-navigate', (event, navUrl) => {
          if (isTrustedSoundCloudUrl(navUrl)) {
            win.loadURL(navUrl);
            authWin.close();
          } else if (!isTrustedOAuthUrl(navUrl)) {
            event.preventDefault();
            if (isSafeExternalUrl(navUrl)) shell.openExternal(navUrl).catch(() => {});
          }
        });
        authWin.webContents.on('will-redirect', (event, navUrl) => {
          if (isTrustedSoundCloudUrl(navUrl)) {
            win.loadURL(navUrl);
            authWin.close();
          } else if (!isTrustedOAuthUrl(navUrl)) {
            event.preventDefault();
          }
        });

        return { action: 'deny' };
      }
    } catch (e: any) {
      // Invalid URL — fall through to open in external browser
      logWarn('Invalid URL in window open handler:', e?.message);
    }

    // Everything else — open in system browser
    if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
    return { action: 'deny' };
  });

  // Never let the privileged main window navigate to arbitrary content.
  win.webContents.on('will-navigate', (event, url) => {
    if (url === 'about:blank' || isTrustedSoundCloudUrl(url)) return;
    event.preventDefault();
    if (isSafeExternalUrl(url)) shell.openExternal(url).catch(() => {});
  });

  // Also handle about:blank popups that get navigated to OAuth URLs after creation
  win.webContents.on('did-create-window', (childWindow) => {
    childWindow.webContents.on('will-navigate', (_event, navUrl) => {
      try {
        if (isTrustedOAuthUrl(navUrl)) {
          // Let it navigate — it's an OAuth flow
          return;
        }
        if (isTrustedSoundCloudUrl(navUrl)) {
          win.loadURL(navUrl);
          childWindow.close();
        } else {
          childWindow.close();
        }
      } catch { /* ignore */ }
    });
  });

  // Mouse back/forward buttons via app-command (Windows)
  win.on('app-command' as any, (_event: any, cmd: string) => {
    if (cmd === 'browser-backward' && win.webContents.canGoBack()) {
      win.webContents.goBack();
    } else if (cmd === 'browser-forward' && win.webContents.canGoForward()) {
      win.webContents.goForward();
    }
  });

  // Inject overlay CSS and keybind listener once DOM is ready
  win.webContents.on('did-finish-load', () => {
    injectOverlaySystem(win);
    injectSpaLoadWatcher(win);
  });


  return win;
}

function injectSpaLoadWatcher(win: BrowserWindow): void {
  win.webContents.executeJavaScript(`
    (function() {
      if (window.__scLoadWatcher) return;
      window.__scLoadWatcher = true;

      // Only watch for stalled navigation — much less aggressive to avoid random reloads
      // Only triggers on actual URL changes (SPA navigation), NOT on any DOM mutation
      var lastUrl = location.href;
      var stallTimer = null;

      setInterval(function() {
        if (document.hidden) return;
        if (location.href !== lastUrl) {
          lastUrl = location.href;
          if (stallTimer) clearTimeout(stallTimer);

          // After a URL change, check if content loaded after 15s
          stallTimer = setTimeout(function() {
            var main = document.querySelector('.l-main');
            if (!main) return;
            // Only consider it stalled if the ONLY child is a loading spinner
            var children = main.querySelectorAll(':scope > *');
            var onlyLoading = children.length <= 2 && main.querySelector('.loading, .sc-loading');
            if (onlyLoading) {
              // page-world code: main-process logInfo is not available here
              console.warn('[SixteenCloud] Navigation stalled, soft retry...');
              window.history.replaceState(null, '', location.href);
              window.dispatchEvent(new PopStateEvent('popstate'));
            }
          }, 15000);
        }
      }, 5000);
    })();
  `).catch((e: any) => logWarn('executeJS error:', e?.message));
}

function injectOverlaySystem(win: BrowserWindow): void {
  // Initialize language from store before generating any overlay HTML
  const store = getStore();
  if (store) {
    const lang = store.get('language') as 'en' | 'ru' | undefined;
    if (lang) setLanguage(lang);
  }

  // Inject overlay CSS via insertCSS
  const cssPath = path.join(__dirname, '../../assets/overlay.css');
  try {
    const css = fs.readFileSync(cssPath, 'utf-8');
    win.webContents.insertCSS(css);
  } catch (e: any) {
    logWarn('Could not load overlay CSS:', e?.message);
  }

  // Bundled Google Sans (inlined as base64 so it works from the https page).
  const fontsPath = path.join(__dirname, '../../assets/fonts.css');
  try {
    const fontsCss = fs.readFileSync(fontsPath, 'utf-8');
    win.webContents.insertCSS(fontsCss);
  } catch (e: any) {
    logWarn('Could not load bundled fonts:', e?.message);
  }

  // Inject ad-block CSS
  injectAdBlockCSS(win);

  // Inject overlay container and toggle logic
  const initScript = getOverlayInitScript();
  win.webContents.executeJavaScript(initScript).catch((e: any) => logWarn('executeJS error:', e?.message));

  // Inject overlay panel contents
  injectOverlayPanels(win);

  // Welcome screen on first launch
  injectWelcomeScreen(win);
}


function injectWelcomeScreen(win: BrowserWindow): void {
  const store = getStore();
  if (!store) return;
  const isFirst = store.get('firstLaunch');
  logInfo('[Tour] firstLaunch value:', isFirst);
  if (isFirst === false) {
    logInfo('[Tour] Not first launch, skipping tour');
    return;
  }
  logInfo('[Tour] Showing welcome tour');

  const tourIcon = (pathData: string) =>
    `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="${pathData}"/></svg>`;

  // Brand mark in the user's accent colour; the "16" is knocked out with a mask
  // so it reads correctly on the blurred backplate instead of a hard-coded fill.
  const tourLogo = (() => {
    try {
      const svg = fs.readFileSync(path.join(__dirname, '../../assets/logo-mark.svg'), 'utf-8');
      return svg.replace('<svg ', '<svg class="sc-tour-logo" aria-hidden="true" focusable="false" ');
    } catch (err) {
      logWarn('[Tour] logo asset missing, using fallback icon:', err);
      return tourIcon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z');
    }
  })();

  // Static illustration of the left rail: expands on hover like the real one.
  const tourRailDemo = `
    <div class="sc-tour-demo">
      <div class="sc-tour-demo-arrow" aria-hidden="true">
        <svg viewBox="0 0 24 24"><path d="M17.5 2.5 5.5 14.5"/><path d="M5.5 8v6.5H12"/></svg>
      </div>
      <div class="sc-tour-demo-frame">
        <div class="sc-tour-demo-rail">
          <div class="sc-tour-demo-item is-active"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
          <div class="sc-tour-demo-item"><i></i><b></b></div>
        </div>
        <div class="sc-tour-demo-body">
          <div class="sc-tour-demo-line" style="width: 56%"></div>
          <div class="sc-tour-demo-line" style="width: 82%"></div>
          <div class="sc-tour-demo-line" style="width: 44%"></div>
          <div class="sc-tour-demo-line" style="width: 68%"></div>
        </div>
      </div>
      <div class="sc-tour-demo-hint">${t('tour.step2_hint')}</div>
    </div>
  `;

  const tourSteps = [
    {
      icon: tourLogo,
      title: t('tour.step1_title'),
      desc: t('tour.step1_desc'),
    },
    {
      icon: tourRailDemo,
      title: t('tour.step2_title'),
      desc: t('tour.step2_desc'),
    },
    {
      icon: tourIcon('M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18ZM5.6 5.6l12.8 12.8'),
      title: t('tour.step3_title'),
      desc: t('tour.step3_desc'),
    },
    {
      icon: tourIcon('M12 3v11M7 10l5 5 5-5M5 20h14'),
      title: t('tour.step4_title'),
      desc: t('tour.step4_desc'),
    },
    {
      icon: tourIcon('M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3.1 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3A8.9 8.9 0 0 0 12 3ZM7 11h.01M8.5 7.5h.01M13 6h.01M17 9h.01'),
      title: t('tour.step5_title'),
      desc: t('tour.step5_desc'),
    },
    {
      icon: tourIcon('m12 3 1.6 5.4L19 10l-5.4 1.6L12 17l-1.6-5.4L5 10l5.4-1.6L12 3ZM19 16l.7 2.3L22 19l-2.3.7L19 22l-.7-2.3L16 19l2.3-.7L19 16Z'),
      title: t('tour.step6_title'),
      desc: t('tour.step6_desc'),
    },
  ];

  const tourHTML = `
    <div id="sc-welcome-overlay">
      <div class="sc-welcome-card">
        <div class="sc-welcome-progress"><span id="sc-tour-step">1</span>/6</div>
        <div class="sc-welcome-icon" id="sc-tour-icon">${tourSteps[0].icon}</div>
        <h2 class="sc-welcome-title" id="sc-tour-title">${tourSteps[0].title}</h2>
        <p class="sc-welcome-desc" id="sc-tour-desc">${tourSteps[0].desc}</p>
        <div class="sc-welcome-actions">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-tour-skip">${t('tour.skip')}</button>
          <div style="display: flex; gap: 8px;">
            <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-tour-prev" style="display: none;">${t('tour.back')}</button>
            <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-tour-next">${t('tour.next')}</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const escaped = tourHTML.replace(/\\/g, '\\\\').replace(/`/g, '\\`');
  const stepsJson = JSON.stringify(tourSteps);

  win.webContents.executeJavaScript(`
    (function() {
      if (document.getElementById('sc-welcome-overlay')) return;
      var steps = ${stepsJson};
      var currentStep = 0;

      var d = document.createElement('div');
      d.innerHTML = \`${escaped}\`;
      var overlay = d.firstElementChild;
      document.body.appendChild(overlay);

      var stepEl = document.getElementById('sc-tour-step');
      var iconEl = document.getElementById('sc-tour-icon');
      var titleEl = document.getElementById('sc-tour-title');
      var descEl = document.getElementById('sc-tour-desc');
      var nextBtn = document.getElementById('sc-tour-next');
      var prevBtn = document.getElementById('sc-tour-prev');
      var skipBtn = document.getElementById('sc-tour-skip');

      function updateStep() {
        stepEl.textContent = currentStep + 1;
        iconEl.innerHTML = steps[currentStep].icon;
        titleEl.textContent = steps[currentStep].title;
        descEl.textContent = steps[currentStep].desc;
        prevBtn.style.display = currentStep > 0 ? 'block' : 'none';
        nextBtn.textContent = currentStep === steps.length - 1 ? '${t('tour.get_started')}' : '${t('tour.next')}';
      }

      function finish() {
        overlay.style.animation = 'sc-welcome-fadeout 300ms ease-out forwards';
        setTimeout(function() { overlay.remove(); }, 300);
        if (window.sixteenCloud) {
          window.sixteenCloud.storeSet('firstLaunch', false);
        }
      }

      nextBtn.addEventListener('click', function() {
        if (currentStep < steps.length - 1) {
          currentStep++;
          updateStep();
        } else {
          finish();
        }
      });

      prevBtn.addEventListener('click', function() {
        if (currentStep > 0) {
          currentStep--;
          updateStep();
        }
      });

      skipBtn.addEventListener('click', finish);
    })();
  `).catch((e: any) => logWarn('executeJS error:', e?.message));
}

function getOverlayInitScript(): string {
  // Feather icons (MIT), embedded locally to avoid font/network dependencies.
  const icon = (pathData: string, extra = '') => {
    // Akar Icons (MIT), sourced from icon-sets.iconify.design/akar-icons.
    const akar: Record<string, string> = {
      globe: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><circle cx="12" cy="12" r="10"/><ellipse cx="12" cy="12" rx="10" ry="4" transform="rotate(90 12 12)"/><path d="M2 12h20"/></g>',
      discord: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-width="2"><path stroke-linejoin="round" d="M14 19c3.771 0 5.657 0 6.828-1.172S22 14.771 22 11s0-5.657-1.172-6.828S17.771 3 14 3h-4C6.229 3 4.343 3 3.172 4.172S2 7.229 2 11s0 5.657 1.172 6.828c.653.654 1.528.943 2.828 1.07"/><path d="M12 11v.01M8 11v.01m8-.01v.01M14 19c-1.236 0-2.598.5-3.841 1.145c-1.998 1.037-2.997 1.556-3.489 1.225s-.399-1.355-.212-3.404L6.5 17.5"/></g>',
      shield: '<g fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path stroke-linecap="round" d="M8 12h8"/></g>',
      key: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2"><path d="m8 18 2-2h2l1.36-1.36a6.5 6.5 0 1 0-3.997-3.992L2 18v4h4l2-2z"/><circle cx="17" cy="7" r="1"/></g>',
      download: '<path fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15V3m0 12-4-4m4 4 4-4M2 17l.621 2.485A2 2 0 0 0 4.561 21h14.877a2 2 0 0 0 1.94-1.515L22 17"/>',
      history: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M12 7.2V12l3.4 2"/></g>',
      music: '<g fill="none" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 4v14"/><path d="M19 7.674v-.657a4 4 0 0 0-2.901-3.846l-2.824-.807A1 1 0 0 0 12 3.326V7l5.725 1.636A1 1 0 0 0 19 7.674Z"/><path stroke-linecap="round" stroke-linejoin="round" d="M12 18a3 3 0 1 1-6 0c0-1.657 1.343-2 3-2s3 .343 3 2"/></g>',
      palette: '<g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.7"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="10" r="1.6"/><path d="M20.5 17.5 15 12l-8.5 7.5"/></g>',
      code: '<path fill="none" stroke="currentColor" stroke-width="2" d="M9.3 17.85a3.15 3.15 0 1 1-3.15-3.15h11.7a3.15 3.15 0 1 1-3.15 3.15V6.15a3.15 3.15 0 1 1 3.15 3.15H6.15A3.15 3.15 0 1 1 9.3 6.15z"/>',
      settings: '<g fill="none" stroke="currentColor" stroke-width="2"><path d="M14 3.269C14 2.568 13.432 2 12.731 2H11.27C10.568 2 10 2.568 10 3.269c0 .578-.396 1.074-.935 1.286q-.128.052-.253.106c-.531.23-1.162.16-1.572-.249a1.27 1.27 0 0 0-1.794 0L4.412 5.446a1.27 1.27 0 0 0 0 1.794c.41.41.48 1.04.248 1.572a8 8 0 0 0-.105.253c-.212.539-.708.935-1.286.935C2.568 10 2 10.568 2 11.269v1.462C2 13.432 2.568 14 3.269 14c.578 0 1.074.396 1.286.935q.052.128.105.253c.231.531.161 1.162-.248 1.572a1.27 1.27 0 0 0 0 1.794l1.034 1.034a1.27 1.27 0 0 0 1.794 0c.41-.41 1.04-.48 1.572-.249q.125.055.253.106c.539.212.935.708.935 1.286c0 .701.568 1.269 1.269 1.269h1.462c.701 0 1.269-.568 1.269-1.269c0-.578.396-1.074.935-1.287q.128-.05.253-.104c.531-.232 1.162-.161 1.571.248a1.27 1.27 0 0 0 1.795 0l1.034-1.034a1.27 1.27 0 0 0 0-1.794c-.41-.41-.48-1.04-.249-1.572q.055-.125.106-.253c.212-.539.708-.935 1.286-.935c.701 0 1.269-.568 1.269-1.269V11.27c0-.701-.568-1.269-1.269-1.269c-.578 0-1.074-.396-1.287-.935a8 8 0 0 0-.105-.253c-.23-.531-.16-1.162.249-1.572a1.27 1.27 0 0 0 0-1.794l-1.034-1.034a1.27 1.27 0 0 0-1.794 0c-.41.41-1.04.48-1.572.249a8 8 0 0 0-.253-.106C14.396 4.343 14 3.847 14 3.27Z"/><path d="M16 12a4 4 0 1 1-8 0a4 4 0 0 1 8 0Z"/></g>',
    };
    let body = pathData;
    if (pathData.startsWith('M12 21a9 9')) body = akar.globe;
    else if (pathData.startsWith('M7.3')) body = akar.discord;
    else if (pathData.startsWith('M12 3 20')) body = akar.shield;
    else if (pathData.startsWith('M15 7')) body = akar.key;
    else if (pathData.startsWith('M12 3v11')) body = akar.download;
    else if (pathData.startsWith('M4 5.5')) body = akar.history;
    else if (pathData.startsWith('M9 18V6')) body = akar.music;
    else if (pathData.startsWith('M12 3a9 9')) body = akar.palette;
    else if (pathData.startsWith('M8 8')) body = akar.code;
    else if (pathData.startsWith('M12 8.5')) body = akar.settings;
    return `<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extra}>${body}</svg>`;
  };

  const NAV_ITEMS = [
    { id: 'geo-bypass', icon: icon('M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3c2.2 2.4 3.3 5.4 3.3 9s-1.1 6.6-3.3 9c-2.2-2.4-3.3-5.4-3.3-9S9.8 5.4 12 3Z'), label: t('nav.geo_bypass') },
      { id: 'discord-rp', icon: '<svg class="sc-icon-discord" viewBox="0 0 32 25" aria-hidden="true" focusable="false"><path d="M26.8121 2.052C24.7632 1.09338 22.5725 0.396698 20.2821 0C20.0008 0.508553 19.6722 1.19257 19.4456 1.7367C17.0109 1.37055 14.5985 1.37055 12.2086 1.7367C11.982 1.19257 11.646 0.508553 11.3622 0C9.06931 0.396698 6.87603 1.09594 4.82715 2.05708C0.69455 8.30199 -0.425731 14.3918 0.13441 20.3951C2.87537 22.442 5.53169 23.6854 8.14318 24.4991C8.78798 23.6116 9.36304 22.6683 9.85845 21.6741C8.91493 21.3156 8.01124 20.8732 7.15736 20.3595C7.38389 20.1917 7.60547 20.0162 7.81955 19.8357C13.0276 22.2716 18.6863 22.2716 23.8321 19.8357C24.0487 20.0162 24.2703 20.1917 24.4943 20.3595C23.6379 20.8757 22.7318 21.3181 21.7883 21.6767C22.2837 22.6683 22.8563 23.6142 23.5035 24.5016C26.1175 23.6879 28.7763 22.4445 31.5173 20.3951C32.1745 13.4357 30.3945 7.40185 26.8121 2.052ZM10.568 16.7031C9.00457 16.7031 7.72245 15.2436 7.72245 13.4662C7.72245 11.6889 8.97719 10.2268 10.568 10.2268C12.1588 10.2268 13.4409 11.6863 13.4135 13.4662C13.416 15.2436 12.1588 16.7031 10.568 16.7031ZM21.0837 16.7031C19.5203 16.7031 18.2382 15.2436 18.2382 13.4662C18.2382 11.6889 19.4929 10.2268 21.0837 10.2268C22.6745 10.2268 23.9566 11.6863 23.9292 13.4662C23.9292 15.2436 22.6745 16.7031 21.0837 16.7031Z" fill="currentColor"/></svg>', label: t('nav.discord_rp') },
    { id: 'adblocker', icon: icon('M12 3 20 6v5c0 5.1-3.3 8.4-8 10-4.7-1.6-8-4.9-8-10V6l8-3ZM8.5 12l2.2 2.2 4.8-4.8'), label: t('nav.adblocker') },
    { id: 'auth-token', icon: icon('M15 7a4 4 0 1 0-7.2 2.4L4 13.2V17h3v2h3v-2.8l2.4-2.4A4 4 0 0 0 15 7Zm-4 0h.01M16 4l4 4'), label: t('nav.auth_token') },
    { id: 'downloader', icon: icon('M12 3v11M7 10l5 5 5-5M5 20h14'), label: t('nav.downloader') },
    { id: 'history', icon: icon('M4 5.5A2.5 2.5 0 0 1 6.5 3H19v17H6.5A2.5 2.5 0 0 1 4 17.5v-12ZM4 17.5A2.5 2.5 0 0 1 6.5 15H19M8 7h7M8 10h7'), label: t('nav.history') },
    { id: 'offline-cache', icon: icon('M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9.5a3.5 3.5 0 0 1 .5 6.96M12 12v6m0 0-2.5-2.5M12 18l2.5-2.5'), label: t('nav.offline') },
    { id: 'lyrics', icon: icon('M9 18V6l10-2v12M9 18a3 3 0 1 1-3-3 3 3 0 0 1 3 3Zm10-2a3 3 0 1 1-3-3 3 3 0 0 1 3 3Z'), label: t('nav.lyrics') },
    { id: 'equalizer', icon: icon('<line x1="4" y1="21" x2="4" y2="14"/><line x1="4" y1="10" x2="4" y2="3"/><line x1="12" y1="21" x2="12" y2="12"/><line x1="12" y1="8" x2="12" y2="3"/><line x1="20" y1="21" x2="20" y2="16"/><line x1="20" y1="12" x2="20" y2="3"/><line x1="1" y1="14" x2="7" y2="14"/><line x1="9" y1="8" x2="15" y2="8"/><line x1="17" y1="16" x2="23" y2="16"/>'), label: t('nav.equalizer') },
    { id: 'themes', icon: icon('M12 3a9 9 0 1 0 0 18h1.2a1.8 1.8 0 0 0 1.3-3.1 1.8 1.8 0 0 1 1.3-3.1H18a3 3 0 0 0 3-3A8.9 8.9 0 0 0 12 3ZM7 11h.01M8.5 7.5h.01M13 6h.01M17 9h.01'), label: t('nav.themes') },
    { id: 'custom-css', icon: icon('M8 8 4 12l4 4M16 8l4 4-4 4M14 5l-4 14'), label: t('nav.custom_css') },
    { id: 'settings', icon: icon('M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7ZM19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-1.5 1.5-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-2.1v-.2a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1-1.5-1.5.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H7v-2.1h.2a1.7 1.7 0 0 0 1.6-1 1.7 1.7 0 0 0-.3-1.9l-.1-.1 1.5-1.5.1.1a1.7 1.7 0 0 0 1.9.3 1.7 1.7 0 0 0 1-1.6V5h2.1v.2a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1 1.5 1.5-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v2.1h-.2a1.7 1.7 0 0 0-1.6 1Z'), label: t('nav.settings') },
  ];

  const navHTML = NAV_ITEMS.map(n =>
    `<div class="sc-nav-item" data-target="${n.id}" role="button" tabindex="0" aria-pressed="false" aria-controls="sc-panel-${n.id}"><span class="sc-nav-icon">${n.icon}</span><span class="sc-nav-label">${n.label}</span></div>`
  ).join('');

  const panelsHTML = NAV_ITEMS.map(n =>
    `<div class="sc-overlay-panel" id="sc-panel-${n.id}" data-overlay="${n.id}"></div>`
  ).join('');

  return `
    (function() {
      if (document.getElementById('sc-overlay-container')) return;

      // ---- Accent colour (single source of truth, used app-wide) ----
      // Derives the rgb triplet, hover shade and a WCAG-contrast foreground so
      // text on accent surfaces (badges, primary buttons) never vanishes.
      window.scApplyAccent = function(hex) {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return;
        var raw = m[1];
        if (raw.length === 3) raw = raw[0]+raw[0]+raw[1]+raw[1]+raw[2]+raw[2];
        var r = parseInt(raw.slice(0,2), 16);
        var g = parseInt(raw.slice(2,4), 16);
        var b = parseInt(raw.slice(4,6), 16);
        var full = '#' + raw.toLowerCase();
        var lin = function(c) { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        var lum = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
        var mix = function(c, t) { return Math.round(c + (255 - c) * t); };
        var hover = '#' + [mix(r, 0.12), mix(g, 0.12), mix(b, 0.12)]
          .map(function(v) { return ('0' + v.toString(16)).slice(-2); }).join('');
        var st = document.documentElement.style;
        st.setProperty('--sc-accent', full);
        st.setProperty('--sc-accent-rgb', r + ', ' + g + ', ' + b);
        st.setProperty('--sc-accent-hover', hover);
        st.setProperty('--sc-focus', 'rgba(' + r + ', ' + g + ', ' + b + ', 0.3)');
        st.setProperty('--sc-accent-foreground', lum > 0.55 ? '#0b0c0e' : '#ffffff');
        window.__scAccentColor = full;
      };

      // Re-apply the stored accent on every page load (not only when the
      // settings panel happens to be open).
      if (window.sixteenCloud && typeof window.sixteenCloud.storeGet === 'function') {
        window.sixteenCloud.storeGet('settings').then(function(s) {
          if (s && s.accentColor) window.scApplyAccent(s.accentColor);
        }).catch(function() {});
      }

      window.__scEscapeHtml = function(value) {
        return String(value == null ? '' : value).replace(/[&<>'"]/g, function(ch) {
          return {'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch];
        });
      };

      // Replace native <select> widgets with the custom dropdown used in the
      // settings panel. The original <select> stays in the DOM (hidden) as the
      // source of truth, so existing value reads, change listeners and
      // programmatic value writes keep working untouched.
      window.__scEnhanceSelects = function(root) {
        var scope = root && root.querySelectorAll ? root : document;
        var selects = scope.querySelectorAll('select');
        for (var i = 0; i < selects.length; i++) {
          (function(select) {
            if (select.dataset.scEnhanced) return;
            if (select.closest && select.closest('.sc-custom-dropdown')) return;
            select.dataset.scEnhanced = 'true';

            var wrap = document.createElement('div');
            wrap.className = 'sc-custom-dropdown';

            var trigger = document.createElement('div');
            trigger.className = 'sc-custom-dropdown-trigger';
            trigger.setAttribute('tabindex', '0');
            trigger.setAttribute('role', 'button');
            trigger.setAttribute('aria-haspopup', 'listbox');

            var label = document.createElement('span');
            label.className = 'sc-custom-dropdown-label';

            var arrow = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
            arrow.setAttribute('class', 'sc-custom-dropdown-arrow');
            arrow.setAttribute('width', '12');
            arrow.setAttribute('height', '12');
            arrow.setAttribute('viewBox', '0 0 12 12');
            var arrowPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
            arrowPath.setAttribute('fill', 'currentColor');
            arrowPath.setAttribute('d', 'M6 8L1 3h10z');
            arrow.appendChild(arrowPath);

            trigger.appendChild(label);
            trigger.appendChild(arrow);

            var menu = document.createElement('div');
            menu.className = 'sc-custom-dropdown-menu';
            menu.setAttribute('role', 'listbox');

            function sync() {
              var opts = select.options;
              var current = null;
              while (menu.firstChild) menu.removeChild(menu.firstChild);
              for (var o = 0; o < opts.length; o++) {
                (function(opt, index) {
                  var item = document.createElement('div');
                  item.className = 'sc-custom-dropdown-item';
                  item.setAttribute('data-value', opt.value);
                  item.setAttribute('role', 'option');
                  item.textContent = opt.textContent;
                  if (opt.selected) { current = opt; item.classList.add('selected'); }
                  item.addEventListener('click', function() {
                    select.value = opt.value;
                    close();
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                  });
                  menu.appendChild(item);
                })(opts[o], o);
              }
              label.textContent = current ? current.textContent : '';
              trigger.classList.toggle('sc-custom-dropdown-disabled', !!select.disabled);
              trigger.setAttribute('aria-expanded', wrap.classList.contains('open') ? 'true' : 'false');
            }

            function close() {
              wrap.classList.remove('open');
              trigger.setAttribute('aria-expanded', 'false');
            }
            function toggle() {
              if (select.disabled) return;
              var wasOpen = wrap.classList.contains('open');
              var open = document.querySelectorAll('.sc-custom-dropdown.open');
              for (var k = 0; k < open.length; k++) open[k].classList.remove('open');
              if (!wasOpen) {
                wrap.classList.add('open');
                trigger.setAttribute('aria-expanded', 'true');
                var sel = menu.querySelector('.sc-custom-dropdown-item.selected');
                if (sel && sel.scrollIntoView) sel.scrollIntoView({ block: 'nearest' });
              }
            }

            trigger.addEventListener('click', function(e) { e.stopPropagation(); toggle(); });
            trigger.addEventListener('keydown', function(e) {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
              else if (e.key === 'Escape') close();
            });
            document.addEventListener('click', function(e) { if (!wrap.contains(e.target)) close(); });
            document.addEventListener('keydown', function(e) { if (e.key === 'Escape') close(); });

            // Keep the custom UI in sync with programmatic value/disabled writes.
            var proto = HTMLSelectElement.prototype;
            var valueDesc = Object.getOwnPropertyDescriptor(proto, 'value');
            var disabledDesc = Object.getOwnPropertyDescriptor(proto, 'disabled');
            if (valueDesc && valueDesc.set) {
              Object.defineProperty(select, 'value', {
                configurable: true,
                get: function() { return valueDesc.get.call(this); },
                set: function(v) { valueDesc.set.call(this, v); sync(); }
              });
            }
            if (disabledDesc && disabledDesc.set) {
              Object.defineProperty(select, 'disabled', {
                configurable: true,
                get: function() { return disabledDesc.get.call(this); },
                set: function(v) { disabledDesc.set.call(this, v); sync(); }
              });
            }
            select.addEventListener('change', sync);
            select.style.display = 'none';
            sync();

            if (select.parentNode) select.parentNode.insertBefore(wrap, select.nextSibling);
            wrap.appendChild(trigger);
            wrap.appendChild(menu);
          })(selects[i]);
        }
      };
      (function() {
        window.__scEnhanceSelects(document);
        if (window.MutationObserver) {
          var pending = false;
          var observer = new MutationObserver(function(mutations) {
            var hit = false;
            for (var i = 0; i < mutations.length && !hit; i++) {
              var added = mutations[i].addedNodes;
              for (var j = 0; j < added.length; j++) {
                var node = added[j];
                if (node.nodeType === 1 && (node.tagName === 'SELECT' || (node.querySelector && node.querySelector('select')))) {
                  hit = true;
                  break;
                }
              }
            }
            if (hit && !pending) {
              pending = true;
              setTimeout(function() {
                pending = false;
                window.__scEnhanceSelects(document);
              }, 100);
            }
          });
          observer.observe(document.documentElement, { childList: true, subtree: true });
        }
      })();
      window.__scIsTrustedSoundCloudUrl = function(value) {
        try {
          var u = new URL(String(value || ''));
          var h = u.hostname.toLowerCase().replace(/\\.$/, '');
          return u.protocol === 'https:' && (h === 'soundcloud.com' || h.endsWith('.soundcloud.com'));
        } catch (e) { return false; }
      };

      // Router-aware navigation. A hard location change reloads the whole
      // SoundCloud document, which stops playback and re-runs Cloudflare's
      // check; pushing the route keeps the running app intact. If the SPA
      // router ignores the route we fall back to a real navigation, so a
      // bookmark always ends up somewhere.
      window.__scNavigate = function(url) {
        try {
          if (!window.__scIsTrustedSoundCloudUrl(url)) return false;
          var target = new URL(String(url));
          // Close the drawer even when the target is the page we are already
          // on, so the click always feels acknowledged.
          if (typeof window.__scCloseSidebar === 'function') window.__scCloseSidebar();
          if (target.href === window.location.href) return true;
          if (target.origin !== window.location.origin) {
            window.location.assign(target.href);
            return true;
          }
          var beforeHref = window.location.href;
          var beforeTitle = document.title;
          try {
            window.history.pushState({}, '', target.pathname + target.search + target.hash);
            window.dispatchEvent(new PopStateEvent('popstate', { state: {} }));
          } catch (e) {
            window.location.assign(target.href);
            return true;
          }
          var attempts = 0;
          var verify = function() {
            // The router acknowledged the route by changing the URL or the
            // document title. Silence means it ignored us -> hard navigate.
            if (window.location.href !== beforeHref || document.title !== beforeTitle) return;
            if (++attempts >= 12) {
              window.location.assign(target.href);
              return;
            }
            setTimeout(verify, 100);
          };
          setTimeout(verify, 100);
          return true;
        } catch (e) {
          return false;
        }
      };

      // SoundCloud's sliders are div[role=slider] nodes that only react to
      // real pointer drags; there is no input[type=range] to nudge. One shared
      // synthetic press/move/release drives volume and timeline alike.
      window.__scSliderDrag = function(target, x, y) {
        var base = { bubbles: true, cancelable: true, view: window, clientX: x, clientY: y, button: 0 };
        target.dispatchEvent(new MouseEvent('mousedown', Object.assign({ buttons: 1 }, base)));
        document.dispatchEvent(new MouseEvent('mousemove', Object.assign({ buttons: 1 }, base)));
        document.dispatchEvent(new MouseEvent('mouseup', Object.assign({ buttons: 0 }, base)));
      };

      window.__scVolumeStep = function(delta) {
        try {
          var wrapper = document.querySelector('.volume__sliderWrapper');
          if (!wrapper) return false;
          var current = parseFloat(wrapper.getAttribute('aria-valuenow'));
          if (!isFinite(current)) current = 0.4;
          return window.__scPlayerSetVolume(current + (Number(delta) || 0));
        } catch (e) {
          return false;
        }
      };

      window.__scPlayerSetVolume = function(fraction) {
        try {
          var wrapper = document.querySelector('.volume__sliderWrapper');
          if (!wrapper) return false;
          // The wrapper collapses to 0px until hover, but the slider track
          // keeps its layout box; drive the drag against the track.
          var track = wrapper.querySelector('.volume__sliderBackground') || wrapper;
          var rect = track.getBoundingClientRect();
          if (!rect.height) return false;
          var next = Math.max(0, Math.min(1, Number(fraction) || 0));
          // The pointer->value mapping is offset ~4px from the painted track
          // (measured against SoundCloud's progress bar); keep that constant.
          window.__scSliderDrag(
            wrapper,
            rect.left + rect.width / 2,
            rect.bottom + 4 - next * rect.height
          );
          return true;
        } catch (e) {
          return false;
        }
      };

      window.__scPlayerAction = function(action) {
        var bySelector = function(selector) {
          var el = document.querySelector(selector);
          if (!el) return false;
          el.click();
          return true;
        };
        if (action === 'play-pause') return bySelector('.playControl');
        if (action === 'next') return bySelector('.playControls__next') || bySelector('.skipControl__next');
        if (action === 'prev') return bySelector('.playControls__prev') || bySelector('.skipControl__previous');
        if (action === 'mute') return bySelector('.volume__button');
        return false;
      };

      window.__scPlayerSeek = function(fraction) {
        try {
          var wrapper = document.querySelector('.playbackTimeline__progressWrapper');
          if (!wrapper) return false;
          var rect = wrapper.getBoundingClientRect();
          if (!rect.width) return false;
          var next = Math.max(0, Math.min(1, Number(fraction) || 0));
          window.__scSliderDrag(
            wrapper,
            rect.left + rect.width * next,
            rect.top + rect.height / 2
          );
          return true;
        } catch (e) {
          return false;
        }
      };

      window.__scPlayerSeekBy = function(deltaSeconds) {
        try {
          var wrapper = document.querySelector('.playbackTimeline__progressWrapper');
          if (!wrapper) return false;
          var current = parseFloat(wrapper.getAttribute('aria-valuenow'));
          var total = parseFloat(wrapper.getAttribute('aria-valuemax'));
          if (!isFinite(current) || !isFinite(total) || total <= 0) return false;
          return window.__scPlayerSeek((current + (Number(deltaSeconds) || 0)) / total);
        } catch (e) {
          return false;
        }
      };

      // One snapshot for every surface that mirrors playback state (mini
      // player, media session, integrations). Keeps selector churn in one place.
      window.__scPlayerState = function() {
        try {
          var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
          var title = titleEl ? (titleEl.getAttribute('title') || titleEl.textContent || '').trim() : '';
          title = title.replace(/^Current track:\\s*/i, '');
          var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
          var artist = artistEl
            ? (artistEl.getAttribute('title') || artistEl.textContent || '').trim()
            : '';
          var artEl = document.querySelector('.playbackSoundBadge__avatar .image__full, .playbackSoundBadge__avatar span[style*="background-image"]');
          var artworkUrl = '';
          if (artEl) {
            var style = artEl.getAttribute('style') || '';
            var match = style.match(/url\\("?([^"\\)]+)"?\\)/);
            if (match) artworkUrl = match[1];
          }
          var playControl = document.querySelector('.playControl');
          var isPlaying = playControl ? playControl.classList.contains('playing') : false;
          var progress = document.querySelector('.playbackTimeline__progressWrapper');
          var position = progress ? parseFloat(progress.getAttribute('aria-valuenow')) : 0;
          var duration = progress ? parseFloat(progress.getAttribute('aria-valuemax')) : 0;
          var volumeEl = document.querySelector('.volume__sliderWrapper');
          var volume = volumeEl ? parseFloat(volumeEl.getAttribute('aria-valuenow')) : 1;
          if (!isFinite(position) || position < 0) position = 0;
          if (!isFinite(duration) || duration < 0) duration = 0;
          if (!isFinite(volume)) volume = 1;
          return {
            title: title,
            artist: artist,
            artworkUrl: artworkUrl,
            isPlaying: isPlaying,
            position: position,
            duration: duration,
            volume: Math.max(0, Math.min(1, volume)),
            trackUrl: titleEl ? (titleEl.href || '') : ''
          };
        } catch (e) {
          return null;
        }
      };

      // Akar Icons (MIT), used for all dynamic controls as well as navigation.
      window.__scIcon = function(name) {
        var paths = {
          x: '<path d="m6 6 12 12M18 6 6 18"/>',
          play: '<path d="M8.5 5.6v12.8a1 1 0 0 0 1.53.85l9.2-6.4a1 1 0 0 0 0-1.7L10.03 4.75A1 1 0 0 0 8.5 5.6Z"/>',
          pause: '<path d="M9.6 5.5v13M14.4 5.5v13"/>',
          up: '<path d="m6 15 6-6 6 6"/>',
          down: '<path d="m6 9 6 6 6-6"/>',
          music: '<path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>',
          list: '<path d="M4 6h16M4 12h16M4 18h16"/>',
          user: '<circle cx="12" cy="8" r="3"/><path d="M5 21a7 7 0 0 1 14 0"/>',
        };
        return '<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">' + (paths[name] || paths.x) + '</svg>';
      };
      window.__scIconify = function(root) {
        root = root || document;
        root.querySelectorAll('[data-sc-icon]').forEach(function(el) {
          if (el.dataset.scIconReady === 'true') return;
          el.innerHTML = window.__scIcon(el.getAttribute('data-sc-icon'));
          el.dataset.scIconReady = 'true';
        });
        root.querySelectorAll('.sc-overlay-btn-icon').forEach(function(btn) {
          if (btn.dataset.scIconReady === 'true') return;
          var value = (btn.textContent || '').trim();
          if (value === '×' || value === '✕' || value === '✖' || value === '') {
            btn.innerHTML = window.__scIcon('x');
            btn.dataset.scIconReady = 'true';
          }
        });
      };

      var container = document.createElement('div');
      container.id = 'sc-overlay-container';
      container.innerHTML = '<div class="sc-overlay-backdrop"></div>' +
        '<div class="sc-overlay-window">' +
          '<div class="sc-window-titlebar">' +
            '<div class="sc-traffic-lights">' +
              '<span class="sc-tl sc-tl-close" id="sc-window-close" role="button" tabindex="0" aria-label="${t('common.close')}"></span>' +
              '<span class="sc-tl sc-tl-min"></span>' +
              '<span class="sc-tl sc-tl-max"></span>' +
            '</div>' +
            '<div class="sc-window-title" id="sc-window-title"></div>' +
          '</div>' +
          '<div class="sc-overlay-content">${panelsHTML.replace(/'/g, "\\'")}</div>' +
        '</div>';
      document.body.appendChild(container);
      window.__scIconify(container);
      new MutationObserver(function() { window.__scIconify(container); }).observe(container, { childList: true, subtree: true });

      // Persistent left rail — always visible, expands on hover.
      var rail = document.createElement('div');
      rail.id = 'sc-overlay-rail';
      rail.innerHTML = '${navHTML.replace(/'/g, "\\'")}';
      document.body.appendChild(rail);
      window.__scIconify(rail);
      new MutationObserver(function() { window.__scIconify(rail); }).observe(rail, { childList: true, subtree: true });

      var currentSection = null;
      var navItems = rail.querySelectorAll('.sc-nav-item');
      var panels = container.querySelectorAll('.sc-overlay-panel');
      var windowTitle = container.querySelector('#sc-window-title');

      function sectionLabel(id) {
        var found = '';
        navItems.forEach(function(n) {
          if (n.getAttribute('data-target') === id) {
            var lbl = n.querySelector('.sc-nav-label');
            found = lbl ? lbl.textContent.trim() : '';
          }
        });
        return found;
      }

      function activateSection(id) {
        navItems.forEach(function(n) {
          var selected = n.getAttribute('data-target') === id;
          n.classList.toggle('active', selected);
          n.setAttribute('aria-pressed', selected ? 'true' : 'false');
        });
        panels.forEach(function(p) {
          p.classList.toggle('active', p.getAttribute('data-overlay') === id);
        });
        var label = sectionLabel(id);
        if (windowTitle && label) windowTitle.textContent = label;
        currentSection = id;
      }

      navItems.forEach(function(item) {
        function activateFromItem() {
          activateSection(item.getAttribute('data-target'));
          window.__scOpenOverlay();
          // Drop focus so the rail is not pinned open by :focus-within after a click.
          if (item.blur) item.blur();
        }
        item.addEventListener('click', activateFromItem);
        item.addEventListener('keydown', function(event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            activateFromItem();
          }
        });
      });

      window.__scOpenOverlay = function() {
        container.classList.add('open');
        document.body.classList.add('sc-overlay-open');
      };

      window.__scCloseOverlay = function() {
        container.classList.remove('open');
        document.body.classList.remove('sc-overlay-open');
        // Clear the rail selection so nothing stays highlighted after closing.
        navItems.forEach(function(n) {
          n.classList.remove('active');
          n.setAttribute('aria-pressed', 'false');
        });
        currentSection = null;
      };

      window.__scToggleOverlay = function() {
        if (container.classList.contains('open')) {
          window.__scCloseOverlay();
        } else {
          window.__scOpenOverlay();
          if (!currentSection) activateSection('geo-bypass');
        }
      };

      // Red traffic light closes the sheet, like macOS.
      var windowCloseBtn = container.querySelector('#sc-window-close');
      if (windowCloseBtn) {
        windowCloseBtn.addEventListener('click', function() { window.__scCloseOverlay(); });
        windowCloseBtn.addEventListener('keydown', function(e) {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); window.__scCloseOverlay(); }
        });
      }

      // Click backdrop to close
      container.querySelector('.sc-overlay-backdrop').addEventListener('click', function() {
        window.__scCloseOverlay();
      });

      // Escape to close
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape' && container.classList.contains('open')) {
          window.__scCloseOverlay();
        }
      });

      // Sidebar container (left side, separate)
      if (!document.getElementById('sc-sidebar-container')) {
        var sidebar = document.createElement('div');
        sidebar.id = 'sc-sidebar-container';
        sidebar.innerHTML = '<div class="sc-sidebar-panel"></div>';
        document.body.appendChild(sidebar);

        var sidebarOpen = false;
        window.__scToggleSidebar = function() {
          sidebarOpen = !sidebarOpen;
          sidebar.classList.toggle('open', sidebarOpen);
        };
        window.__scCloseSidebar = function() {
          sidebarOpen = false;
          sidebar.classList.remove('open');
        };

        if (window.sixteenCloud) {
          window.sixteenCloud.onSidebarToggle(function() {
            window.__scToggleSidebar();
          });
        }
      }
    })();
  `;
}

function injectOverlayPanels(win: BrowserWindow): void {
  const panels: Record<string, { html: string; script: string }> = {
    'geo-bypass': { html: getGeoBypassOverlayHTML(), script: getGeoBypassOverlayScript() },
    'discord-rp': { html: getDiscordRpOverlayHTML(), script: getDiscordRpOverlayScript() },
    'adblocker': { html: getAdblockerOverlayHTML(), script: getAdblockerOverlayScript() },
    'auth-token': { html: getAuthTokenOverlayHTML(), script: getAuthTokenOverlayScript() },
    'downloader': { html: getDownloaderOverlayHTML(), script: getDownloaderOverlayScript() },
    'settings': { html: getSettingsOverlayHTML(), script: getSettingsOverlayScript() },
    'history': { html: getHistoryOverlayHTML(), script: getHistoryOverlayScript() },
    'lyrics': { html: getLyricsOverlayHTML(), script: getLyricsOverlayScript() },
    'equalizer': { html: getEqualizerOverlayHTML(), script: getEqualizerOverlayScript() },
    'themes': { html: getThemesOverlayHTML(), script: getThemesOverlayScript() },
    'custom-css': { html: getCustomCssOverlayHTML(), script: getCustomCssOverlayScript() },
    'offline-cache': { html: getOfflineOverlayHTML(), script: getOfflineOverlayScript() },
  };

  // Fill all panels and initialize their scripts in one renderer roundtrip.
  // Keep the explicit order: sidebar first, then panels as listed above.
  const panelEntries = [
    {
      selector: '#sc-sidebar-container .sc-sidebar-panel',
      html: getSidebarOverlayHTML(),
      script: getSidebarOverlayScript(),
    },
    ...Object.entries(panels).map(([id, panel]) => ({
      selector: `[data-overlay="${id}"]`,
      html: panel.html,
      script: panel.script,
    })),
  ];

  const htmlInjection = panelEntries.map(({ selector, html }) => `
    (function() {
      var panel = document.querySelector(${JSON.stringify(selector)});
      if (panel && !panel.dataset.filled) {
        panel.innerHTML = ${JSON.stringify(html)};
        panel.dataset.filled = 'true';
      }
    })();
  `).join('\n');

  // Each overlay script is already an IIFE. Keep try/catch around each one so
  // a panel-specific runtime error cannot prevent later panels from starting.
  const scriptInjection = panelEntries.map(({ script }, index) => `
    try { ${script} } catch (e) {
      console.warn('[SixteenCloud] overlay panel ${index} initialization failed', e);
    }
  `).join('\n');

  win.webContents.executeJavaScript(`
    (function() {
      ${htmlInjection}
      ${scriptInjection}
    })();
  `).catch((e: any) => logWarn('executeJS error:', e?.message));

  win.webContents.executeJavaScript(getVisualizerScript())
    .catch((e: any) => logWarn('visualizer inject error:', e?.message));
}

// --- Geo-Bypass ---

const COUNTRY_LANGS: Record<string, string> = {
  'US': 'en-US,en;q=0.9',
  'GB': 'en-GB,en;q=0.9',
  'DE': 'de-DE,de;q=0.9,en;q=0.8',
  'FR': 'fr-FR,fr;q=0.9,en;q=0.8',
  'JP': 'ja-JP,ja;q=0.9,en;q=0.8',
  'CA': 'en-CA,en;q=0.9',
  'AU': 'en-AU,en;q=0.9',
  'NL': 'nl-NL,nl;q=0.9,en;q=0.8',
  'SE': 'sv-SE,sv;q=0.9,en;q=0.8',
  'BR': 'pt-BR,pt;q=0.9,en;q=0.8',
};

async function setupGeoBypass(): Promise<void> {
  // DNS-over-HTTPS flags are set at top-level before app.ready

  // Auto-apply saved proxy on startup
  const store = getStore();
  if (store && store.get('geoBypass.enabled')) {
    const proxyUrl = (store.get('geoBypass.proxyUrl') || '') as string;
    if (proxyUrl) {
      let safeProxy = '[configured]';
      try { const parsed = new URL(proxyUrl); safeProxy = `${parsed.protocol}//${parsed.hostname}:${parsed.port || ''}`; } catch {}
      logInfo(`[Geo-Bypass] Applying saved proxy: ${safeProxy}`);
      await session.defaultSession.setProxy({ proxyRules: proxyUrl });
    }
  }

  // Cache geo-bypass state
  let geoEnabled = false;
  let geoLang = 'en-US,en;q=0.9';
  function refreshGeoState(): void {
    const s = getStore();
    if (!s) return;
    geoEnabled = !!s.get('geoBypass.enabled');
    const country = (s.get('geoBypass.spoofCountry') || 'US') as string;
    geoLang = COUNTRY_LANGS[country] || COUNTRY_LANGS['US'];
  }
  refreshGeoState();
  setInterval(refreshGeoState, 10000);

  // Spoof Accept-Language header to match selected country
  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // Electron advertises its own product through the User-Agent and through
    // Chromium client hints even when the UA is replaced, and a UA that claims
    // a different OS than the hints is an automation tell. Rewrite the whole
    // identity block from one platform profile (see shared/user-agent.ts).
    if (isTrustedSoundCloudUrl(details.url) || /(^|\.)sndcdn\.com$/i.test(safeHostname(details.url))) {
      if (applyUserAgentHeaders(details.requestHeaders)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
    }
    if (!geoEnabled) {
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    details.requestHeaders['Accept-Language'] = geoLang;
    callback({ requestHeaders: details.requestHeaders });
  });
}

function safeHostname(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return '';
  }
}

// --- Adblocker ---
let adBlockedCount = 0;
let adBlockEnabled = true;
let adCustomRules: string[] = [];
let adWhitelist: string[] = [];
let adCountNotifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyAdBlockCount(win: BrowserWindow): void {
  // Network bursts can block many resources at once; coalesce renderer IPC.
  if (adCountNotifyTimer) return;
  adCountNotifyTimer = setTimeout(() => {
    adCountNotifyTimer = null;
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.AD_BLOCK_COUNT, adBlockedCount);
  }, 100);
}

function setupAdblocker(win: BrowserWindow): void {
  const ses = session.defaultSession;

  // Pre-build a Set of ad domains for O(1) hostname lookup — rebuilt on refresh to include remote domains
  let adDomainSet = new Set(AD_DOMAINS);

  // Cache store values — refresh periodically instead of on every request
  function refreshAdBlockState(): void {
    const store = getStore();
    if (!store) return;
    adBlockEnabled = !!store.get('adblocker.enabled');
    adCustomRules = store.get('adblocker.customRules') || [];
    adWhitelist = store.get('adblocker.whitelist') || [];
    // Merge hardcoded + remote domains
    const remoteDomains = (store.get('adblocker.remoteDomains') || []) as string[];
    adDomainSet = new Set([...AD_DOMAINS, ...remoteDomains]);
  }
  function isBlockedDomain(hostname: string): boolean {
    const labels = hostname.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      if (adDomainSet.has(labels.slice(i).join('.'))) return true;
    }
    return false;
  }
  refreshAdBlockState();
  setInterval(refreshAdBlockState, 10000);

  ses.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (!adBlockEnabled || win.isDestroyed()) {
      callback({ cancel: false });
      return;
    }

    const url = details.url;

    // Fast path: extract hostname
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { callback({ cancel: false }); return; }

    // Whitelist is an explicit user override and should short-circuit all rules.
    if (adWhitelist.length > 0 && adWhitelist.some(w => url.includes(w))) {
      callback({ cancel: false });
      return;
    }

    // Block SoundCloud's own ad/promoted URLs by pattern
    const isSoundCloudHost = hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com');
    const isCdnHost = hostname === 'sndcdn.com' || hostname.endsWith('.sndcdn.com');
    if (isSoundCloudHost || isCdnHost) {
      if (AD_URL_PATTERNS.some(p => url.includes(p))) {
        adBlockedCount++;
        notifyAdBlockCount(win);
        callback({ cancel: true });
        return;
      }
      callback({ cancel: false });
      return;
    }

    // Check against ad domains
    if (isBlockedDomain(hostname)) {
      adBlockedCount++;
      if (adBlockedCount % 50 === 0) {
        const store = getStore();
        if (store) store.set('adblocker.blockedCount', adBlockedCount);
      }
      notifyAdBlockCount(win);
      callback({ cancel: true });
      return;
    }

    // Custom rules
    if (adCustomRules.length > 0 && adCustomRules.some(rule => url.includes(rule))) {
      adBlockedCount++;
      notifyAdBlockCount(win);
      callback({ cancel: true });
      return;
    }

    callback({ cancel: false });
  });
}

function injectAdBlockCSS(win: BrowserWindow): void {
  const css = AD_CSS_SELECTORS.map(s => `${s} { display: none !important; }`).join('\n');
  win.webContents.insertCSS(css);
}

function registerNavigation(win: BrowserWindow): void {
  // Use before-input-event instead of globalShortcut — only fires when window is focused
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;

    // Ctrl+R = reload (code-based for layout independence)
    if (input.code === 'KeyR' && input.control && !input.shift && !input.alt && !input.meta) {
      win.webContents.reload();
    }
    // Ctrl+Shift+R = hard reload
    if (input.code === 'KeyR' && input.control && input.shift && !input.alt && !input.meta) {
      win.webContents.reloadIgnoringCache();
    }
    // Alt+Left = back
    if (input.key === 'ArrowLeft' && input.alt && !input.control && !input.meta) {
      if (win.webContents.canGoBack()) win.webContents.goBack();
    }
    // Alt+Right = forward
    if (input.key === 'ArrowRight' && input.alt && !input.control && !input.meta) {
      if (win.webContents.canGoForward()) win.webContents.goForward();
    }
  });
}

function registerKeybinds(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const stored = getStore()?.get('settings.keybinds');
    const binds = resolveKeybinds(stored, process.platform);
    const match = (action: KeybindAction) => matchesCombo(binds[action], {
      code: input.code,
      key: input.key,
      control: input.control,
      alt: input.alt,
      shift: input.shift,
      meta: input.meta,
    });

    if (match('sidebar')) {
      event.preventDefault();
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.SIDEBAR_TOGGLE);
      return;
    }

    if (match('playPause')) {
      event.preventDefault();
      win.webContents.executeJavaScript(`
        (function() {
          var el = document.activeElement;
          if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
            if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
              var start = el.selectionStart || 0;
              el.value = el.value.substring(0, start) + ' ' + el.value.substring(el.selectionEnd || start);
              el.selectionStart = el.selectionEnd = start + 1;
              el.dispatchEvent(new Event('input', { bubbles: true }));
            }
            return;
          }
          document.querySelector('.playControl')?.click();
        })();
      `).catch((e: any) => logWarn('executeJS error:', e?.message));
      return;
    }

    if (match('miniPlayer')) {
      event.preventDefault();
      toggleMiniPlayer();
      return;
    }

    if (match('volumeUp')) {
      event.preventDefault();
      win.webContents.executeJavaScript('window.__scVolumeStep && window.__scVolumeStep(0.05)')
        .catch((e: any) => logWarn('volume step error:', e?.message));
      return;
    }
    if (match('volumeDown')) {
      event.preventDefault();
      win.webContents.executeJavaScript('window.__scVolumeStep && window.__scVolumeStep(-0.05)')
        .catch((e: any) => logWarn('volume step error:', e?.message));
      return;
    }
  });
}

function getMiniPlayerHTML(): string {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>SixteenCloud Mini Player</title><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin><link href="https://fonts.googleapis.com/css2?family=Google+Sans+Text:wght@400;500;700&display=swap" rel="stylesheet"><style>
:root{--bg:#0f0f10;--fg:#f2f2f4;--muted:#8a8a90;--line:rgba(255,255,255,.07);--accent:#ff5500}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:var(--bg);overflow:hidden}
body{font-family:'Google Sans Text','Google Sans',-apple-system,'Segoe UI',Inter,sans-serif;color:var(--fg);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility;user-select:none}
.card{display:flex;flex-direction:column;width:100%;height:100%;background:var(--bg)}
.header{position:relative;height:34px;flex-shrink:0;display:flex;align-items:center;padding:0 14px;border-bottom:1px solid rgba(255,255,255,.06);-webkit-app-region:drag}
.header-title{position:absolute;left:0;right:0;text-align:center;font-size:11px;font-weight:500;letter-spacing:.2px;color:#7d7d84;pointer-events:none}
.dots{display:flex;gap:8px;align-items:center;z-index:1;-webkit-app-region:no-drag}
.tl{width:11px;height:11px;border-radius:50%;cursor:pointer;transition:filter .12s}
.tl:hover{filter:brightness(1.15)}
.tl-close{background:#ff5f57}
.tl-min{background:#febc2e}
.tl-max{background:#28c840}
.content{display:flex;flex-direction:column;flex:1;min-height:0;padding:10px 14px}
.top{display:flex;align-items:center;gap:12px;flex:1;min-height:0}
.art{position:relative;width:56px;height:56px;border-radius:8px;overflow:hidden;flex-shrink:0;background:#1a1a1c;cursor:pointer;-webkit-app-region:no-drag}
.art img{width:100%;height:100%;object-fit:cover;display:block}
.ph{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:#4a4a50}
.ph svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.info{flex:1;min-width:0}
.title{font-size:13px;font-weight:600;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;-webkit-app-region:no-drag}
.artist{font-size:11px;color:var(--muted);line-height:1.3;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;-webkit-app-region:no-drag}
.controls{display:flex;align-items:center;gap:2px;flex-shrink:0;-webkit-app-region:no-drag}
button{font:inherit;color:inherit;background:none;border:0;cursor:pointer;outline:none;padding:0}
.icon-btn{width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;color:#9a9aa0;transition:color .12s,background .12s}
.icon-btn svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.icon-btn:hover{color:#fff;background:rgba(255,255,255,.06)}
.play{width:34px;height:34px;border-radius:50%;margin:0 3px;display:flex;align-items:center;justify-content:center;color:#fff;background:var(--accent);transition:background .12s,transform .1s}
.play svg{width:22px;height:22px;fill:currentColor;stroke:none}
.play:hover{background:#ff6a1f}
.play:active{transform:scale(.95)}
.bottom{display:flex;align-items:center;gap:8px;padding-top:8px;flex-shrink:0}
.time{font-size:9.5px;color:#77777e;font-variant-numeric:tabular-nums;min-width:26px;text-align:center}
.prog{flex:1;height:14px;display:flex;align-items:center;cursor:pointer;-webkit-app-region:no-drag;touch-action:none}
.track{position:relative;width:100%;height:2px;border-radius:1px;background:rgba(255,255,255,.12)}
.fill{position:absolute;left:0;top:0;height:100%;width:0;border-radius:1px;background:var(--accent)}
.fill::after{content:'';position:absolute;right:-3px;top:50%;width:6px;height:6px;border-radius:50%;background:#fff;transform:translateY(-50%) scale(0);transition:transform .1s}
.prog:hover .fill::after,.prog.dragging .fill::after{transform:translateY(-50%) scale(1)}
.vol{display:flex;align-items:center;gap:6px;flex-shrink:0;-webkit-app-region:no-drag}
.mute{width:18px;height:18px;display:flex;align-items:center;justify-content:center;color:#8a8a90;transition:color .12s}
.mute svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:1.7;stroke-linecap:round;stroke-linejoin:round}
.mute:hover{color:#fff}
.vol input{-webkit-appearance:none;appearance:none;width:60px;height:2px;border-radius:1px;outline:none;cursor:pointer;background:rgba(255,255,255,.12)}
.vol input::-webkit-slider-thumb{-webkit-appearance:none;width:8px;height:8px;border-radius:50%;background:#fff;border:0}
</style></head><body>
<div class="card">
  <div class="header">
    <div class="dots">
      <span class="tl tl-close" id="dotClose" role="button" tabindex="0" aria-label="Закрыть"></span>
      <span class="tl tl-min" id="dotMin" role="button" tabindex="0" aria-label="Скрыть"></span>
      <span class="tl tl-max" id="dotMax" role="button" tabindex="0" aria-label="Открыть SixteenCloud"></span>
    </div>
    <div class="header-title">Мини-плеер</div>
  </div>
  <div class="content">
  <div class="top">
    <div class="art" id="art" aria-label="Открыть страницу трека">
      <div class="ph" id="ph"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/></svg></div>
      <img id="artImg" alt="" style="display:none">
    </div>
    <div class="info">
      <div class="title" id="title">Ничего не играет</div>
      <div class="artist" id="artist">Включи трек в SixteenCloud</div>
    </div>
    <div class="controls">
      <button class="icon-btn" id="prev" title="Предыдущий трек" aria-label="Предыдущий трек"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 5v14"/><path d="M19 5 9 12l10 7V5Z"/></svg></button>
      <button class="play" id="play" title="Играть" aria-label="Играть или пауза"></button>
      <button class="icon-btn" id="next" title="Следующий трек" aria-label="Следующий трек"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 5v14"/><path d="m5 5 10 7L5 19V5Z"/></svg></button>
    </div>
  </div>
  <div class="bottom">
    <div class="time" id="tcur">0:00</div>
    <div class="prog" id="prog"><div class="track"><div class="fill" id="fill"></div></div></div>
    <div class="time" id="tdur">0:00</div>
    <div class="vol">
      <button class="mute" id="mute" title="Звук" aria-label="Звук"><svg viewBox="0 0 24 24" aria-hidden="true" id="muteIcon"></svg></button>
      <input type="range" id="vol" min="0" max="100" value="100" aria-label="Громкость">
    </div>
  </div>
  </div>
</div>
<script>
  var api = window.sixteenCloudMini;
  var SPK_ON = '<path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="M14.5 9.3a4 4 0 0 1 0 5.4"/><path d="M17.2 6.8a7.5 7.5 0 0 1 0 10.4"/>';
  var SPK_OFF = '<path d="M4 10v4h3l4 3V7l-4 3H4Z"/><path d="m15.5 9.5 5 5m0-5-5 5"/>';
  var ICON_PLAY = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.5 19 12 7.5 19.5Z"/></svg>';
  var ICON_PAUSE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.5h3.4v15H7.5zM13.1 4.5h3.4v15h-3.4z"/></svg>';
  var $ = function(id) { return document.getElementById(id); };
  var state = null;
  var duration = 0;
  var displayPos = 0;
  var lastTick = 0;
  var dragging = false;
  var dragFrac = 0;
  var volDragging = false;
  var pendingSeekUntil = 0;
  var pendingVolumeUntil = 0;
  var pendingPlayUntil = 0;
  var lastVolume = 1;
  var lastSent = {};

  function send(action, value, force) {
    var now = Date.now();
    var gap = action === 'volume' ? 70 : action === 'seek' ? 90 : 160;
    if (!force && lastSent[action] && now - lastSent[action] < gap) return;
    lastSent[action] = now;
    api.sendAction(action, value);
  }

  function fmt(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var m = Math.floor(seconds / 60);
    var s = Math.floor(seconds % 60);
    return m + ':' + (s < 10 ? '0' : '') + s;
  }

  function artUrl(url) {
    if (!url) return '';
    return String(url)
      .replace(/-t\\d+x\\d+\\./, '-t200x200.')
      .replace(/-large\\./, '-t200x200.')
      .replace(/-(?:mini|small|tiny|badge|original|large)\\./, '-t200x200.');
  }

  function paintMute(volume) {
    var muted = volume <= 0.001;
    $('muteIcon').innerHTML = muted ? SPK_OFF : SPK_ON;
    $('mute').title = muted ? 'Включить звук' : 'Выключить звук';
  }

  function paintProgress(position, total) {
    var pct = total > 0 ? Math.max(0, Math.min(100, (position / total) * 100)) : 0;
    $('fill').style.width = pct + '%';
    $('tcur').textContent = fmt(position);
    $('tdur').textContent = fmt(total);
  }

  function paintBars() {
    var total = duration;
    var pos = dragging ? dragFrac * total : displayPos;
    paintProgress(pos, total);
  }

  function paintPlay(isPlaying) {
    $('play').innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
    $('play').title = isPlaying ? 'Пауза' : 'Играть';
    $('play').setAttribute('aria-label', isPlaying ? 'Пауза' : 'Играть');
  }

  api.onUpdate(function(info) {
    if (!info) return;
    var previousTitle = state ? state.title : '';
    var previousDuration = duration;
    var now = performance.now();
    var trackChanged = info.title !== previousTitle || Math.abs((info.duration || 0) - previousDuration) > 0.5;

    state = info;
    duration = info.duration || 0;

    $('title').textContent = info.title || 'Ничего не играет';
    $('title').title = info.title || '';
    $('artist').textContent = info.artist || (info.title ? '' : 'Включи трек в SixteenCloud');

    if (now >= pendingPlayUntil) paintPlay(!!info.isPlaying);

    var url = artUrl(info.artworkUrl);
    var img = $('artImg');
    if (url) {
      if (img.getAttribute('data-src') !== url) {
        img.setAttribute('data-src', url);
        img.src = url;
      }
      img.style.display = 'block';
      $('ph').style.display = 'none';
    } else {
      img.style.display = 'none';
      $('ph').style.display = 'flex';
    }

    var volume = info.volume == null ? 1 : info.volume;
    if (volume > 0.01) lastVolume = volume;
    if (!volDragging && now >= pendingVolumeUntil) {
      $('vol').value = Math.round(volume * 100);
      paintMute(volume);
    } else if (now >= pendingVolumeUntil) {
      paintMute(volume);
    }

    if (!dragging && now >= pendingSeekUntil) {
      var server = info.position || 0;
      var drift = Math.abs(server - displayPos);
      if (trackChanged || !info.isPlaying || drift > 1.5) {
        displayPos = server;
      }
    }
    if (trackChanged) {
      displayPos = info.position || 0;
      pendingSeekUntil = 0;
    }

    lastTick = now;
    paintBars();
  });

  function frame(timestamp) {
    if (!dragging && state && state.isPlaying) {
      if (!lastTick) lastTick = timestamp;
      var dt = (timestamp - lastTick) / 1000;
      if (dt > 0 && dt < 2) displayPos += dt;
      if (duration > 0) displayPos = Math.min(displayPos, duration);
      paintBars();
    }
    lastTick = timestamp;
    requestAnimationFrame(frame);
  }
  paintPlay(false);
  paintMute(1);
  requestAnimationFrame(frame);

  function togglePlayOptimistic() {
    if (state) {
      state.isPlaying = !state.isPlaying;
      paintPlay(!!state.isPlaying);
      pendingPlayUntil = performance.now() + 1400;
    }
    send('play-pause', null, true);
  }

  function openTrack() {
    if (state && state.trackUrl) send('open-track', state.trackUrl, true);
    else send('focus', null, true);
  }

  $('prev').addEventListener('click', function() { send('prev', null, true); });
  $('play').addEventListener('click', togglePlayOptimistic);
  $('next').addEventListener('click', function() { send('next', null, true); });
  $('mute').addEventListener('click', function() {
    var current = parseInt($('vol').value, 10) || 0;
    var next = current > 0 ? 0 : Math.max(1, Math.round(lastVolume * 100));
    $('vol').value = next;
    paintMute(next / 100);
    pendingVolumeUntil = performance.now() + 1800;
    send('mute', null, true);
  });
  $('art').addEventListener('click', openTrack);
  $('title').addEventListener('click', openTrack);
  $('artist').addEventListener('click', openTrack);
  $('dotClose').addEventListener('click', function() { send('close', null, true); });
  $('dotMin').addEventListener('click', function() { send('hide', null, true); });
  $('dotMax').addEventListener('click', function() { send('focus', null, true); });

  $('vol').addEventListener('pointerdown', function() { volDragging = true; });
  $('vol').addEventListener('input', function() {
    volDragging = true;
    pendingVolumeUntil = performance.now() + 600;
    paintMute(parseInt(this.value, 10) / 100);
    send('volume', parseInt(this.value, 10));
  });
  $('vol').addEventListener('change', function() {
    volDragging = false;
    pendingVolumeUntil = performance.now() + 700;
    paintMute(parseInt(this.value, 10) / 100);
    send('volume', parseInt(this.value, 10), true);
  });
  window.addEventListener('pointerup', function() { volDragging = false; });

  var prog = $('prog');
  function fractionFromEvent(event) {
    var rect = prog.getBoundingClientRect();
    if (!rect.width) return 0;
    return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  }
  prog.addEventListener('pointerdown', function(event) {
    dragging = true;
    prog.classList.add('dragging');
    try { prog.setPointerCapture(event.pointerId); } catch (e) {}
    dragFrac = fractionFromEvent(event);
    paintBars();
  });
  prog.addEventListener('pointermove', function(event) {
    if (!dragging) return;
    dragFrac = fractionFromEvent(event);
    paintBars();
  });
  prog.addEventListener('pointerup', function(event) {
    if (!dragging) return;
    dragging = false;
    prog.classList.remove('dragging');
    var frac = fractionFromEvent(event);
    if (duration > 0) displayPos = frac * duration;
    pendingSeekUntil = performance.now() + 2000;
    paintBars();
    send('seek', frac, true);
  });
  prog.addEventListener('pointercancel', function() {
    dragging = false;
    prog.classList.remove('dragging');
    if (state && !state.isPlaying) displayPos = state.position || displayPos;
    paintBars();
  });

  document.addEventListener('keydown', function(event) {
    if (event.key === ' ') {
      event.preventDefault();
      togglePlayOptimistic();
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      displayPos = Math.max(0, displayPos - 5);
      pendingSeekUntil = performance.now() + 2000;
      paintBars();
      send('seek-by', -5, true);
    } else if (event.key === 'ArrowRight') {
      event.preventDefault();
      displayPos = duration > 0 ? Math.min(duration, displayPos + 5) : displayPos + 5;
      pendingSeekUntil = performance.now() + 2000;
      paintBars();
      send('seek-by', 5, true);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      event.preventDefault();
      var step = event.key === 'ArrowUp' ? 5 : -5;
      var next = Math.max(0, Math.min(100, parseInt($('vol').value, 10) + step));
      $('vol').value = next;
      paintMute(next / 100);
      pendingVolumeUntil = performance.now() + 700;
      send('volume-step', step, true);
    } else if (event.key === 'Escape') {
      send('close', null, true);
    }
  });
</script>
</body></html>`;
}

const MINI_PLAYER_WIDTH = 400;
const MINI_PLAYER_HEIGHT = 134;
const MINI_WINDOW_TITLE = 'SixteenCloud Mini Player';

function pinMiniPlayerOnHyprland(): void {
  if (process.platform !== 'linux') return;
  const findAndPin = (attempt: number) => {
    execFile('hyprctl', ['clients', '-j'], { timeout: 2000 }, (err, stdout) => {
      if (err) return;
      let client: { address: string; title: string; pinned: boolean } | undefined;
      try {
        client = (JSON.parse(stdout) as Array<{ address: string; title: string; pinned: boolean }>)
          .find((c) => c.title === MINI_WINDOW_TITLE);
      } catch { return; }
      if (!client) {
        if (attempt < 8) setTimeout(() => findAndPin(attempt + 1), 250);
        return;
      }
      if (client.pinned) return;
      execFile('hyprctl', ['dispatch', 'pin', `address:${client.address}`], { timeout: 2000 }, (pinErr) => {
        if (pinErr) logWarn('[MiniPlayer] hyprctl pin failed:', pinErr.message);
      });
    });
  };
  findAndPin(0);
}

function miniPlayerPositionIsVisible(x: number, y: number): boolean {
  return screen.getAllDisplays().some((display) => {
    const area = display.workArea;
    return (
      x + MINI_PLAYER_WIDTH > area.x + 40 &&
      x < area.x + area.width - 40 &&
      y + MINI_PLAYER_HEIGHT > area.y + 20 &&
      y < area.y + area.height - 20
    );
  });
}

function createMiniPlayer(): void {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    if (miniPlayerWindow.isMinimized()) miniPlayerWindow.restore();
    miniPlayerWindow.show();
    miniPlayerWindow.focus();
    return;
  }

  const store = getStore();
  const saved = store?.get('miniPlayer.bounds') as { x: number; y: number } | null | undefined;
  const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  let x = typeof saved?.x === 'number'
    ? saved.x
    : display.workArea.x + display.workArea.width - MINI_PLAYER_WIDTH - 24;
  let y = typeof saved?.y === 'number'
    ? saved.y
    : display.workArea.y + display.workArea.height - MINI_PLAYER_HEIGHT - 24;
  if (!miniPlayerPositionIsVisible(x, y)) {
    x = display.workArea.x + display.workArea.width - MINI_PLAYER_WIDTH - 24;
    y = display.workArea.y + display.workArea.height - MINI_PLAYER_HEIGHT - 24;
  }

  lastMiniState = '';
  miniPlayerWindow = new BrowserWindow({
    width: MINI_PLAYER_WIDTH,
    height: MINI_PLAYER_HEIGHT,
    x,
    y,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    maximizable: false,
    minimizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    transparent: process.platform !== 'linux',
    backgroundColor: process.platform === 'linux' ? '#0f0f10' : '#00000000',
    roundedCorners: false,
    hasShadow: process.platform === 'darwin',
    title: MINI_WINDOW_TITLE,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '../preload/mini-preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      backgroundThrottling: false,
    },
  });
  miniPlayerWindow.setMenu(null);
  miniPlayerWindow.webContents.setUserAgent(CHROME_UA);

  const keepOnTop = () => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    try { miniPlayerWindow.setAlwaysOnTop(true, 'screen-saver'); } catch {}
    try { miniPlayerWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch {}
  };
  keepOnTop();
  miniPlayerWindow.on('show', () => {
    keepOnTop();
    pinMiniPlayerOnHyprland();
  });
  mainWindow?.on('enter-full-screen', keepOnTop);
  mainWindow?.on('leave-full-screen', keepOnTop);

  let moveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    const [bx, by] = miniPlayerWindow.getPosition();
    store?.set('miniPlayer.bounds', { x: bx, y: by });
  };
  miniPlayerWindow.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(saveBounds, 350);
  });
  miniPlayerWindow.on('close', saveBounds);

  // Write HTML to temp file — data: URLs break nodeIntegration IPC
  const tmpDir = app.getPath('temp');
  const miniHtmlPath = path.join(tmpDir, 'sc-mini-player.html');
  fs.writeFileSync(miniHtmlPath, getMiniPlayerHTML(), 'utf-8');
  miniPlayerWindow.loadFile(miniHtmlPath);
  miniPlayerWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    logWarn('[MiniPlayer] load failed:', code, desc, url);
  });
  miniPlayerWindow.once('ready-to-show', () => {
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    miniPlayerWindow.show();
    pinMiniPlayerOnHyprland();
  });

  // Listen for IPC from mini-player and forward actions to main window
  const miniIpcHandler = (event: Electron.IpcMainEvent, action: string, value?: number | string) => {
    if (!miniPlayerWindow || event.sender !== miniPlayerWindow.webContents) return;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const run = (script: string) => {
      mainWindow!.webContents.executeJavaScript(script).catch(() => {});
    };
    const refresh = () => {
      setTimeout(pushMiniPlayerState, 120);
      setTimeout(pushMiniPlayerState, 900);
    };
    switch (action) {
      case 'play-pause':
        run(`window.__scPlayerAction && window.__scPlayerAction('play-pause')`);
        break;
      case 'prev':
        run(`window.__scPlayerAction && window.__scPlayerAction('prev')`);
        break;
      case 'next':
        run(`window.__scPlayerAction && window.__scPlayerAction('next')`);
        break;
      case 'mute':
        run(`window.__scPlayerAction && window.__scPlayerAction('mute')`);
        break;
      case 'volume': {
        const fraction = Math.max(0, Math.min(1, (Number(value) || 0) / 100));
        run(`window.__scPlayerSetVolume && window.__scPlayerSetVolume(${fraction})`);
        break;
      }
      case 'volume-step': {
        const delta = Math.max(-1, Math.min(1, (Number(value) || 0) / 100));
        run(`window.__scVolumeStep && window.__scVolumeStep(${delta})`);
        break;
      }
      case 'seek': {
        const fraction = Math.max(0, Math.min(1, Number(value) || 0));
        run(`window.__scPlayerSeek && window.__scPlayerSeek(${fraction})`);
        break;
      }
      case 'seek-by': {
        const seconds = Math.max(-3600, Math.min(3600, Number(value) || 0));
        run(`window.__scPlayerSeekBy && window.__scPlayerSeekBy(${seconds})`);
        break;
      }
      case 'hide':
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.hide();
        break;
      case 'open-track': {
        const url = typeof value === 'string' ? value : '';
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        if (/^https?:\/\//i.test(url)) {
          run(`window.__scNavigate && window.__scNavigate(${JSON.stringify(url)})`);
        }
        break;
      }
      case 'focus':
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        break;
      case 'close':
        if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) miniPlayerWindow.close();
        miniPlayerWindow = null;
        break;
    }
    if (action !== 'close' && action !== 'focus' && action !== 'hide') refresh();
  };
  ipcMain.on('mini:action', miniIpcHandler);
  miniPlayerWindow.webContents.on('did-finish-load', () => pushMiniPlayerState());

  miniPlayerWindow.webContents.on('render-process-gone', (_e, details) => {
    logWarn('[MiniPlayer] renderer gone:', details.reason, details.exitCode);
  });
  miniPlayerWindow.on('unresponsive', () => logWarn('[MiniPlayer] unresponsive'));
  miniPlayerWindow.on('closed', () => {
    logInfo('[MiniPlayer] window closed');
    miniPlayerWindow = null;
    lastMiniState = '';
    ipcMain.removeListener('mini:action', miniIpcHandler);
  });
}

function toggleMiniPlayer(): void {
  if (miniPlayerWindow && !miniPlayerWindow.isDestroyed()) {
    miniPlayerWindow.close();
    miniPlayerWindow = null;
  } else {
    createMiniPlayer();
  }
}

let miniSyncTimer: NodeJS.Timeout | null = null;
let lastMiniState = '';

function pushMiniPlayerState(): void {
  if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
  if (!mainWindow || mainWindow.isDestroyed()) return;
  mainWindow.webContents.executeJavaScript(
    `(function() {
      try { return window.__scPlayerState ? JSON.stringify(window.__scPlayerState()) : null; }
      catch (e) { return null; }
    })()`
  ).then((raw: unknown) => {
    if (typeof raw !== 'string' || raw === lastMiniState) return;
    lastMiniState = raw;
    if (!miniPlayerWindow || miniPlayerWindow.isDestroyed()) return;
    try {
      miniPlayerWindow.webContents.send(IPC_CHANNELS.MINI_PLAYER_UPDATE, JSON.parse(raw));
    } catch { /* window went away mid-flight */ }
  }).catch(() => {});
}

function syncMiniPlayerTrackInfo(): void {
  if (miniSyncTimer) return;
  miniSyncTimer = setInterval(pushMiniPlayerState, 1000);
}

function registerMediaKeys(win: BrowserWindow): void {
  globalShortcut.register('MediaPlayPause', () => {
    if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.querySelector('.playControl')?.click();`).catch((e: any) => logWarn('executeJS error:', e?.message));
  });
  globalShortcut.register('MediaNextTrack', () => {
    if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.querySelector('.skipControl__next')?.click();`).catch((e: any) => logWarn('executeJS error:', e?.message));
  });
  globalShortcut.register('MediaPreviousTrack', () => {
    if (!win.isDestroyed()) win.webContents.executeJavaScript(`document.querySelector('.skipControl__previous')?.click();`).catch((e: any) => logWarn('executeJS error:', e?.message));
  });
  globalShortcut.register('MediaStop', () => {
    if (!win.isDestroyed()) win.webContents.executeJavaScript(`
      var pc = document.querySelector('.playControl');
      if (pc && pc.classList.contains('playing')) pc.click();
    `).catch((e: any) => logWarn('executeJS error:', e?.message));
  });
}

function injectMediaSession(win: BrowserWindow): void {
  win.webContents.executeJavaScript(`
    (function() {
      if (window.__scMediaSession) return;
      window.__scMediaSession = true;

      if ('mediaSession' in navigator) {
        navigator.mediaSession.setActionHandler('play', function() {
          document.querySelector('.playControl')?.click();
        });
        navigator.mediaSession.setActionHandler('pause', function() {
          document.querySelector('.playControl')?.click();
        });
        navigator.mediaSession.setActionHandler('nexttrack', function() {
          document.querySelector('.skipControl__next')?.click();
        });
        navigator.mediaSession.setActionHandler('previoustrack', function() {
          document.querySelector('.skipControl__previous')?.click();
        });
        navigator.mediaSession.setActionHandler('stop', function() {
          var pc = document.querySelector('.playControl');
          if (pc && pc.classList.contains('playing')) pc.click();
        });

        // Update metadata periodically
        var lastTitle = '';
        setInterval(function() {
          var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
          var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
          if (!titleEl) return;
          var title = titleEl.getAttribute('title') || titleEl.textContent.trim();
          if (title === lastTitle) return;
          lastTitle = title;
          var artist = artistEl ? (artistEl.getAttribute('title') || artistEl.textContent.trim()) : '';
          var artEl = document.querySelector('.playbackSoundBadge__avatar .image__full, .playbackSoundBadge__avatar span[style*="background-image"]');
          var artwork = '';
          if (artEl) {
            var style = artEl.getAttribute('style') || '';
            var m = style.match(/url\\\\("?([^"\\\\)]+)"?\\\\)/);
            if (m) artwork = m[1].replace(/-t\\d+x\\d+\\./, '-t500x500.').replace(/-large\\./, '-t500x500.').replace(/-[a-z0-9]+x[a-z0-9]+\\./, '-t500x500.');
          }

          navigator.mediaSession.metadata = new MediaMetadata({
            title: title,
            artist: artist,
            album: 'SoundCloud',
            artwork: artwork ? [{ src: artwork, sizes: '500x500', type: 'image/jpeg' }] : []
          });
        }, 2000);
      }
    })();
  `).catch((e: any) => logWarn('executeJS error:', e?.message));
}

// Register sixteencloud:// protocol for deep linking
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('sixteencloud', process.execPath, [path.resolve(process.argv[1])]);
  }
} else {
  app.setAsDefaultProtocolClient('sixteencloud');
}

function handleDeepLink(url: string): void {
  // Expected format: sixteencloud://open/artist/track
  const match = url.match(/^sixteencloud:\/\/open\/(.+)/);
  if (match && mainWindow) {
    let trackPath: string;
    try { trackPath = decodeURIComponent(match[1]); } catch { return; }
    if (!/^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%\/-]*$/.test(trackPath) || trackPath.includes('..') || trackPath.startsWith('//')) return;
    mainWindow.loadURL(`https://soundcloud.com/${trackPath}`);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  }
}

// The volume mixer reads the PulseAudio stream identity, which Chromium
// hardcodes to "Chromium" / "chromium-browser" (PULSE_PROP_OVERRIDE only covers
// the name). native/pulse-sixteencloud.c rewrites it to ours, and LD_PRELOAD is
// only honoured at exec time, so the process restarts itself once with the shim
// installed. The guard below makes that restart happen exactly once, and this
// runs before the single-instance lock because the relaunched process takes it.
function relaunchWithPulseIdentity(): boolean {
  if (process.platform !== 'linux') return false;
  if (process.env.ELECTRON_RUN_AS_NODE) return false;
  if (process.env.SIXTEENCLOUD_PULSE_SHIM === '1') return false;

  const built = path.join(__dirname, '..', 'native', 'pulse-sixteencloud.so');
  if (!fs.existsSync(built)) return false;

  // Packaged builds load the shim from inside the bundle, and an AppImage mount
  // is torn down with this process — stage a copy in the profile directory and
  // preload that instead.
  let shim = built;
  try {
    const staged = path.join(app.getPath('userData'), 'pulse-sixteencloud.so');
    const stale = !fs.existsSync(staged) || fs.statSync(staged).size !== fs.statSync(built).size;
    if (stale) fs.copyFileSync(built, staged);
    shim = staged;
  } catch (err: any) {
    logWarn('[App] Could not stage PulseAudio identity shim:', err?.message || String(err));
  }

  const preload = process.env.LD_PRELOAD ? `${shim}:${process.env.LD_PRELOAD}` : shim;
  try {
    spawn(process.execPath, process.argv.slice(1), {
      env: { ...process.env, LD_PRELOAD: preload, SIXTEENCLOUD_PULSE_SHIM: '1' },
      detached: true,
      stdio: 'inherit',
    }).unref();
  } catch (err: any) {
    logWarn('[App] PulseAudio identity relaunch failed:', err?.message || String(err));
    return false;
  }

  logInfo('[App] Relaunching with PulseAudio identity shim:', shim);
  // Immediate and synchronous: the rest of this module must not run, or this
  // process would take the single-instance lock the relaunched process needs.
  process.exit(0);
}

relaunchWithPulseIdentity();

// Prevent multiple instances — focus existing window instead
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
    // Windows: deep link URL is in argv
    const deepLinkUrl = argv.find(arg => arg.startsWith('sixteencloud://'));
    if (deepLinkUrl) {
      handleDeepLink(deepLinkUrl);
    }
  });
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "connect-src 'self' https: wss: data: blob:",
  "frame-src https:",
  "worker-src 'self' https: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
].join('; ');

// SoundCloud ships its own CSP on some responses; never weaken or duplicate it.
function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    const existing = Object.keys(headers).find(name => name.toLowerCase() === 'content-security-policy');
    if (existing) {
      callback({ responseHeaders: headers });
      return;
    }
    callback({
      responseHeaders: {
        ...headers,
        'Content-Security-Policy': [CONTENT_SECURITY_POLICY],
      },
    });
  });
}

app.whenReady().then(() => {
  applyContentSecurityPolicy();

  // Splash screen
  const splashPath = path.join(__dirname, '../../src/renderer/splash.html');
  logInfo('[SixteenCloud] Splash path:', splashPath);
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    center: true,
    backgroundColor: '#111',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  });
  splashWindow.webContents.setUserAgent(CHROME_UA);
  splashWindow.loadFile(splashPath).catch((e: any) => logWarn('Splash load error:', e?.message));

  mainWindow = createWindow();
  setupIPC(mainWindow);

  // The audio visualizer became a built-in default in v2.1.7. Upgrade the
  // legacy shape once; later user choices keep their own `enabled` value.
  const vizState = getStore()?.get('visualizer') as any;
  if (vizState?.version !== 2) {
    getStore()?.set('visualizer', {
      enabled: true,
      type: 'wave',
      colorScheme: typeof vizState?.colorScheme === 'string' ? vizState.colorScheme : '#ff5500',
      version: 2,
    });
  }
  setupGeoBypass();
  setupAdblocker(mainWindow);
  setupDiscordRPC(mainWindow);
  setupOfflineCache(mainWindow);
  setupLinuxDesktopIntegration(mainWindow);
  registerNavigation(mainWindow);
  registerKeybinds(mainWindow);
  registerMediaKeys(mainWindow);
  setMiniPlayerToggle(toggleMiniPlayer);
  if (mainWindow) {
    createTray(mainWindow);
  }
  setupUpdaterIPC();
  if (getStore()?.get('settings.autoUpdate') !== false) checkForUpdates();

  // Handle deep link on first launch (Windows: URL is in process.argv)
  const deepLinkUrl = process.argv.find(arg => arg.startsWith('sixteencloud://'));
  if (deepLinkUrl) {
    handleDeepLink(deepLinkUrl);
  }

  // Mini-player toggle from renderer (window.sixteenCloud.miniPlayerToggle)
  ipcMain.on(IPC_CHANNELS.MINI_PLAYER_TOGGLE, () => {
    toggleMiniPlayer();
  });

  // Start mini-player track sync
  syncMiniPlayerTrackInfo();

  // Inject media session and titlebar after page loads
  mainWindow.webContents.on('did-finish-load', () => {
    injectMediaSession(mainWindow!);
    mainWindow!.webContents.executeJavaScript(getTitlebarScript()).catch((e: any) => logWarn('Titlebar inject error:', e?.message));
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  destroyDiscordRPC();
  destroyLinuxDesktopIntegration();
  destroyTray();
  app.quit();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
  destroyLinuxDesktopIntegration();
  destroyTray();
});

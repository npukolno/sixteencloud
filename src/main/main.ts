import { app, BrowserWindow, globalShortcut } from 'electron';
import { setupIPC, getStore, initStore, flushHistory } from './ipc';
import { createTray, destroyTray, setMiniPlayerToggle } from './tray';
import { checkForUpdates, setupUpdaterIPC } from './updater';
import { setupDiscordRPC, destroyDiscordRPC } from './discord';
import { setupOfflineCache } from './offline-cache';
import { configureLinuxPaths, setupLinuxDesktopIntegration, destroyLinuxDesktopIntegration } from './linux-integration';
import { setupWindowsTaskbar } from './windows-taskbar';
import { CHROME_UA } from '../shared/constants';
import { clickScript } from '../shared/sc-selectors';
import { logWarn } from './logger';
import { runInPage } from './page';
import { injectOverlaySystem } from './overlays';
import { createMainWindow, createSplash } from './window';
import { setupAdblocker } from './adblocker';
import { setupGeoBypass } from './geo-bypass';
import { setupBatterySaver } from './power';
import { registerKeybinds, registerMediaKeys, registerNavigation } from './input';
import { injectPageScript } from './page-scripts';
import { applyContentSecurityPolicy } from './csp';
import { findDeepLink, handleDeepLink, registerProtocolClient } from './deep-link';
import { installPulseIdentityShim } from './pulse-shim';
import { setupMiniPlayer, toggleMiniPlayer } from './mini-player';
import { getTitlebarScript } from '../renderer/overlays/titlebar';

let mainWindow: BrowserWindow | null = null;

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

registerProtocolClient();
installPulseIdentityShim();

/** Everything injected into the SoundCloud page on each load, in order. */
function injectPage(win: BrowserWindow, afterInject: () => void): void {
  injectOverlaySystem(win);
  injectPageScript(win, 'load-watcher');
  injectPageScript(win, 'media-session');
  injectPageScript(win, 'lyricsync');
  runInPage(win, getTitlebarScript()).catch((e: any) => logWarn('Titlebar inject error:', e?.message));
  // After the overlay scripts that define the hooks it calls.
  setImmediate(afterInject);
}

/** One-time store upgrades. */
function migrateSettings(): void {
  const store = getStore();
  // The audio visualizer became a built-in default in v2.1.7. Upgrade the
  // legacy shape once; later user choices keep their own `enabled` value.
  const vizState = store.get('visualizer') as any;
  if (vizState?.version !== 2) {
    store.set('visualizer', {
      enabled: true,
      type: 'wave',
      colorScheme: typeof vizState?.colorScheme === 'string' ? vizState.colorScheme : '#ff5500',
      version: 2,
    } as any);
  }
}

function focusMainWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

// Single instance: a second launch focuses this one (and forwards deep links).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    focusMainWindow();
    const deepLinkUrl = findDeepLink(argv);
    if (deepLinkUrl) handleDeepLink(mainWindow, deepLinkUrl);
  });
}

app.whenReady().then(() => {
  applyContentSecurityPolicy();
  initStore();
  migrateSettings();

  let pushPowerState: () => void = () => {};
  const win = createMainWindow({
    splash: createSplash(),
    injectPage: (w) => injectPage(w, () => pushPowerState()),
  });
  mainWindow = win;
  setupIPC(win);

  void setupGeoBypass();
  setupAdblocker(win);
  pushPowerState = setupBatterySaver(win);
  const clickInPage = (name: 'PLAY' | 'NEXT' | 'PREV') => () => {
    if (!win.isDestroyed()) runInPage(win, clickScript(name)).catch((e: any) => logWarn('taskbar action error:', e?.message));
  };
  setupWindowsTaskbar(win, { previous: clickInPage('PREV'), playPause: clickInPage('PLAY'), next: clickInPage('NEXT') });
  setupDiscordRPC(win);
  setupOfflineCache(win);
  setupLinuxDesktopIntegration(win);
  setupMiniPlayer(() => mainWindow);
  registerNavigation(win);
  registerKeybinds(win, { toggleMiniPlayer });
  registerMediaKeys(win);
  setMiniPlayerToggle(toggleMiniPlayer);
  createTray(win);
  setupUpdaterIPC(win);
  if (getStore().get('settings.autoUpdate') !== false) checkForUpdates(win);

  // Windows passes a deep link on first launch through argv.
  const deepLinkUrl = findDeepLink(process.argv);
  if (deepLinkUrl) handleDeepLink(win, deepLinkUrl);

  // macOS: the dock icon reopens the window that still exists (IPC handlers
  // are bound to it, so a new BrowserWindow would be a dead shell).
  app.on('activate', focusMainWindow);
});

app.on('window-all-closed', () => {
  destroyDiscordRPC();
  destroyLinuxDesktopIntegration();
  destroyTray();
  app.quit();
});

app.on('will-quit', () => {
  flushHistory();
  globalShortcut.unregisterAll();
  destroyLinuxDesktopIntegration();
  destroyTray();
});

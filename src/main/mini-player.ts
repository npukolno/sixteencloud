import { BrowserWindow, ipcMain, screen } from 'electron';
import path from 'path';
import { execFile } from 'child_process';
import { CHROME_UA, IPC_CHANNELS } from '../shared/constants';
import { getScriptTranslations } from '../shared/i18n';
import { MINI_ACTIONS, MINI_STRING_KEYS, MINI_THEME_TOKENS, type MiniAction } from '../shared/mini-player';
import { clickScript, scJs } from '../shared/sc-selectors';
import { getStore } from './ipc';
import { logInfo, logWarn } from './logger';

const MINI_PLAYER_WIDTH = 400;
const MINI_PLAYER_HEIGHT = 134;
const MINI_WINDOW_TITLE = 'SixteenCloud Mini Player';
const SYNC_INTERVAL_MS = 1000;

let miniPlayerWindow: BrowserWindow | null = null;
let getMainWindow: () => BrowserWindow | null = () => null;
let syncTimer: NodeJS.Timeout | null = null;
let lastMiniState = '';
let strings: Record<string, string> = {};

/** Read playback state, liked flag and theme tokens from the main page in one round trip. */
const STATE_SCRIPT = `(function() {
  try {
    if (!window.__scPlayerState) return null;
    var s = window.__scPlayerState() || {};
    var like = document.querySelector(${scJs('LIKE')});
    s.isLiked = !!(like && like.classList.contains('sc-button-selected'));
    var cs = getComputedStyle(document.body || document.documentElement);
    var theme = {};
    ${JSON.stringify(MINI_THEME_TOKENS)}.forEach(function(k) { var v = cs.getPropertyValue(k).trim(); if (v) theme[k] = v; });
    s.theme = theme;
    return JSON.stringify(s);
  } catch (e) { return null; }
})()`;

function liveMain(): BrowserWindow | null {
  const win = getMainWindow();
  return win && !win.isDestroyed() ? win : null;
}

function liveMini(): BrowserWindow | null {
  return miniPlayerWindow && !miniPlayerWindow.isDestroyed() ? miniPlayerWindow : null;
}

function pushMiniPlayerState(): void {
  const mini = liveMini();
  const main = liveMain();
  if (!mini || !main) return;
  main.webContents.executeJavaScript(STATE_SCRIPT).then((raw: unknown) => {
    if (typeof raw !== 'string' || raw === lastMiniState) return;
    lastMiniState = raw;
    const target = liveMini();
    if (!target) return;
    try {
      target.webContents.send(IPC_CHANNELS.MINI_PLAYER_UPDATE, { ...JSON.parse(raw), strings });
    } catch { /* window went away mid-flight */ }
  }).catch(() => {});
}

function startSync(): void {
  if (!syncTimer) syncTimer = setInterval(pushMiniPlayerState, SYNC_INTERVAL_MS);
}

function stopSync(): void {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
  lastMiniState = '';
}

/** Hyprland ignores alwaysOnTop across workspaces; pin the window instead. */
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

function positionIsVisible(x: number, y: number): boolean {
  return screen.getAllDisplays().some(({ workArea: a }) =>
    x + MINI_PLAYER_WIDTH > a.x + 40 && x < a.x + a.width - 40 &&
    y + MINI_PLAYER_HEIGHT > a.y + 20 && y < a.y + a.height - 20);
}

function initialPosition(): { x: number; y: number } {
  const saved = getStore()?.get('miniPlayer.bounds') as { x: number; y: number } | null | undefined;
  const { workArea } = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const fallback = {
    x: workArea.x + workArea.width - MINI_PLAYER_WIDTH - 24,
    y: workArea.y + workArea.height - MINI_PLAYER_HEIGHT - 24,
  };
  if (typeof saved?.x !== 'number' || typeof saved?.y !== 'number') return fallback;
  return positionIsVisible(saved.x, saved.y) ? { x: saved.x, y: saved.y } : fallback;
}

function focusMain(main: BrowserWindow): void {
  if (main.isMinimized()) main.restore();
  main.show();
  main.focus();
}

function handleAction(action: MiniAction, value: unknown): void {
  const main = liveMain();
  if (!main) return;
  const run = (script: string) => { main.webContents.executeJavaScript(script).catch(() => {}); };
  const playerAction = (name: string) => run(`window.__scPlayerAction && window.__scPlayerAction(${JSON.stringify(name)})`);
  switch (action) {
    case 'play-pause': case 'prev': case 'next': case 'mute':
      playerAction(action);
      break;
    case 'volume':
      run(`window.__scPlayerSetVolume && window.__scPlayerSetVolume(${Math.max(0, Math.min(1, (Number(value) || 0) / 100))})`);
      break;
    case 'volume-step':
      run(`window.__scVolumeStep && window.__scVolumeStep(${Math.max(-1, Math.min(1, (Number(value) || 0) / 100))})`);
      break;
    case 'seek':
      run(`window.__scPlayerSeek && window.__scPlayerSeek(${Math.max(0, Math.min(1, Number(value) || 0))})`);
      break;
    case 'seek-by':
      run(`window.__scPlayerSeekBy && window.__scPlayerSeekBy(${Math.max(-3600, Math.min(3600, Number(value) || 0))})`);
      break;
    case 'like':
      run(clickScript('LIKE'));
      break;
    case 'lyrics':
      focusMain(main);
      run(`(function(){var i=document.querySelector('[data-target="lyrics"]'); if (i) i.click();})();`);
      break;
    case 'hide':
      liveMini()?.hide();
      break;
    case 'open-track': {
      focusMain(main);
      const url = typeof value === 'string' ? value : '';
      if (/^https:\/\/(www\.)?soundcloud\.com\//i.test(url)) run(`window.__scNavigate && window.__scNavigate(${JSON.stringify(url)})`);
      break;
    }
    case 'focus':
      focusMain(main);
      break;
    case 'close':
      liveMini()?.close();
      break;
  }
  if (action !== 'close' && action !== 'focus' && action !== 'hide' && action !== 'lyrics') {
    // The page needs a moment to apply the action; refresh sooner than the next tick.
    setTimeout(pushMiniPlayerState, 120);
    setTimeout(pushMiniPlayerState, 900);
  }
}

const onMiniAction = (event: Electron.IpcMainEvent, action: unknown, value?: unknown) => {
  const mini = liveMini();
  if (!mini || event.sender !== mini.webContents) return;
  if (typeof action !== 'string' || !(MINI_ACTIONS as readonly string[]).includes(action)) return;
  handleAction(action as MiniAction, value);
};

export function createMiniPlayer(): void {
  const existing = liveMini();
  if (existing) {
    if (existing.isMinimized()) existing.restore();
    existing.show();
    existing.focus();
    return;
  }

  const { x, y } = initialPosition();
  strings = getScriptTranslations([...MINI_STRING_KEYS]);
  lastMiniState = '';
  const mini = new BrowserWindow({
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
  miniPlayerWindow = mini;
  mini.setMenu(null);
  mini.webContents.setUserAgent(CHROME_UA);

  const keepOnTop = () => {
    if (mini.isDestroyed()) return;
    try { mini.setAlwaysOnTop(true, 'screen-saver'); } catch { /* unsupported */ }
    try { mini.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true }); } catch { /* unsupported */ }
  };
  keepOnTop();
  mini.on('show', () => { keepOnTop(); pinMiniPlayerOnHyprland(); });
  const main = liveMain();
  main?.on('enter-full-screen', keepOnTop);
  main?.on('leave-full-screen', keepOnTop);

  let moveTimer: NodeJS.Timeout | null = null;
  const saveBounds = () => {
    if (mini.isDestroyed()) return;
    const [bx, by] = mini.getPosition();
    getStore()?.set('miniPlayer.bounds', { x: bx, y: by });
  };
  mini.on('moved', () => {
    if (moveTimer) clearTimeout(moveTimer);
    moveTimer = setTimeout(saveBounds, 350);
  });
  mini.on('close', saveBounds);

  mini.loadFile(path.join(__dirname, '../renderer/mini-player/index.html')).catch((e: any) => logWarn('[MiniPlayer] load error:', e?.message));
  mini.webContents.on('did-fail-load', (_e, code, desc, url) => logWarn('[MiniPlayer] load failed:', code, desc, url));
  mini.webContents.on('did-finish-load', () => { lastMiniState = ''; pushMiniPlayerState(); });
  mini.once('ready-to-show', () => {
    if (mini.isDestroyed()) return;
    mini.show();
    pinMiniPlayerOnHyprland();
  });
  mini.webContents.on('render-process-gone', (_e, details) => logWarn('[MiniPlayer] renderer gone:', details.reason, details.exitCode));
  mini.on('unresponsive', () => logWarn('[MiniPlayer] unresponsive'));
  mini.on('closed', () => {
    logInfo('[MiniPlayer] window closed');
    if (moveTimer) clearTimeout(moveTimer);
    main?.removeListener('enter-full-screen', keepOnTop);
    main?.removeListener('leave-full-screen', keepOnTop);
    if (miniPlayerWindow === mini) miniPlayerWindow = null;
    stopSync();
  });
  startSync();
}

export function toggleMiniPlayer(): void {
  const mini = liveMini();
  if (mini) mini.close();
  else createMiniPlayer();
}

/** Register the mini-player IPC once; the window itself is created on demand. */
export function setupMiniPlayer(mainWindowGetter: () => BrowserWindow | null): void {
  getMainWindow = mainWindowGetter;
  ipcMain.on('mini:action', onMiniAction);
  ipcMain.on(IPC_CHANNELS.MINI_PLAYER_TOGGLE, (event) => {
    const main = liveMain();
    if (main && event.sender === main.webContents) toggleMiniPlayer();
  });
}

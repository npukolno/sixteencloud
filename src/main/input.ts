import { globalShortcut, type BrowserWindow } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { matchesCombo, resolveKeybinds, type KeybindAction } from '../shared/keybinds';
import { clickScript, pauseScript, scJs } from '../shared/sc-selectors';
import { getStore } from './ipc';
import { logWarn } from './logger';
import { runInPage } from './page';

function run(win: BrowserWindow, script: string, what: string): void {
  if (win.isDestroyed()) return;
  runInPage(win, script).catch((e: any) => logWarn(`${what} error:`, e?.message));
}

/** Reload and history keys. before-input-event only fires while the window has focus. */
export function registerNavigation(win: BrowserWindow): void {
  win.webContents.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;
    const plainCtrl = input.control && !input.alt && !input.meta;
    if (input.code === 'KeyR' && plainCtrl && !input.shift) win.webContents.reload();
    else if (input.code === 'KeyR' && plainCtrl && input.shift) win.webContents.reloadIgnoringCache();
    else if (input.key === 'ArrowLeft' && input.alt && !input.control && !input.meta) {
      if (win.webContents.navigationHistory.canGoBack()) win.webContents.navigationHistory.goBack();
    } else if (input.key === 'ArrowRight' && input.alt && !input.control && !input.meta) {
      if (win.webContents.navigationHistory.canGoForward()) win.webContents.navigationHistory.goForward();
    }
  });
}

// Space toggles playback unless the user is typing.
const PLAY_PAUSE_SCRIPT = `
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
    var pc = document.querySelector(${scJs('PLAY')});
    if (pc) pc.click();
  })();
`;

/** User-configurable in-window shortcuts (settings.keybinds). */
export function registerKeybinds(win: BrowserWindow, actions: { toggleMiniPlayer: () => void }): void {
  const store = getStore();
  // Cached: reading the store re-reads config.json, too slow for every keypress.
  let binds = resolveKeybinds(store.get('settings.keybinds'), process.platform);
  store.onDidChange('settings', (next) => { binds = resolveKeybinds(next?.keybinds, process.platform); });

  win.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const match = (action: KeybindAction) => matchesCombo(binds[action], {
      code: input.code, key: input.key, control: input.control, alt: input.alt, shift: input.shift, meta: input.meta,
    });

    if (match('sidebar')) {
      event.preventDefault();
      if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.SIDEBAR_TOGGLE);
    } else if (match('rail')) {
      event.preventDefault();
      const hidden = store.get('settings.railHidden') !== true;
      store.set('settings.railHidden', hidden);
      run(win, `window.__scSetRailHidden && window.__scSetRailHidden(${hidden})`, 'rail toggle');
    } else if (match('playPause')) {
      event.preventDefault();
      run(win, PLAY_PAUSE_SCRIPT, 'play/pause');
    } else if (match('miniPlayer')) {
      event.preventDefault();
      actions.toggleMiniPlayer();
    } else if (match('volumeUp')) {
      event.preventDefault();
      run(win, 'window.__scVolumeStep && window.__scVolumeStep(0.05)', 'volume step');
    } else if (match('volumeDown')) {
      event.preventDefault();
      run(win, 'window.__scVolumeStep && window.__scVolumeStep(-0.05)', 'volume step');
    }
  });
}

/** Hardware media keys, system-wide. */
export function registerMediaKeys(win: BrowserWindow): void {
  const bind = (accelerator: string, script: string) => {
    try {
      if (!globalShortcut.register(accelerator, () => run(win, script, accelerator))) {
        logWarn(`[Keys] ${accelerator} is taken by another application`);
      }
    } catch (e: any) {
      logWarn(`[Keys] could not register ${accelerator}:`, e?.message);
    }
  };
  bind('MediaPlayPause', clickScript('PLAY'));
  bind('MediaNextTrack', clickScript('NEXT'));
  bind('MediaPreviousTrack', clickScript('PREV'));
  bind('MediaStop', pauseScript());
}

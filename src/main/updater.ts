import { app, BrowserWindow, ipcMain } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import { getScriptTranslations } from '../shared/i18n';
import { logInfo } from './logger';

let autoUpdater: any = null;

function getAutoUpdater(): any {
  if (autoUpdater) return autoUpdater;
  try {
    const mod = require('electron-updater');
    autoUpdater = mod.autoUpdater;
    return autoUpdater;
  } catch (err: any) {
    logInfo('[SixteenCloud] electron-updater not available:', err?.message || err);
    return null;
  }
}

// The splash window is created before the main window, so BrowserWindow
// .getAllWindows()[0] is the splash while the app starts: the update banner and
// progress events went to a window that closes a few seconds later. Keep an
// explicit reference to the main window instead.
let mainWin: BrowserWindow | null = null;
let pendingVersion: string | null = null;
let downloaded = false;

function getMainWindow(): BrowserWindow | null {
  return mainWin && !mainWin.isDestroyed() ? mainWin : null;
}

/**
 * Show the update banner in the main window. Safe to call repeatedly: it is a
 * no-op while the page is loading (did-finish-load calls it again), when the
 * banner already exists, or after the user dismissed it this session.
 */
function injectUpdateBanner(): void {
  const win = getMainWindow();
  if (!win || !pendingVersion || win.webContents.isLoading()) return;

  const _tr = JSON.stringify(getScriptTranslations([
    'updater.available', 'updater.update', 'updater.downloading', 'updater.downloaded', 'updater.restart',
  ]));
  win.webContents.executeJavaScript(`
    (function() {
      if (document.getElementById('sc-update-banner') || !document.body) return;
      try { if (sessionStorage.getItem('sc-update-dismissed')) return; } catch (e) {}
      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) { for (var pk in p) s = s.replace('{' + pk + '}', p[pk]); } return s; }
      var api = window.sixteenCloud;
      if (!api) return;
      var banner = document.createElement('div');
      banner.id = 'sc-update-banner';
      banner.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:999998;background:#f50;color:#fff;padding:8px 16px;font-size:13px;font-family:Inter,sans-serif;display:flex;align-items:center;justify-content:space-between;';
      var textSpan = document.createElement('span');
      textSpan.textContent = _t('updater.available', {version: ${JSON.stringify(String(pendingVersion))}});
      var btnWrap = document.createElement('div');
      btnWrap.style.cssText = 'display:flex;align-items:center;gap:8px;';
      var progressBar = document.createElement('div');
      progressBar.id = 'sc-update-progress';
      progressBar.style.cssText = 'display:none;width:120px;height:6px;background:rgba(255,255,255,0.3);border-radius:3px;overflow:hidden;';
      progressBar.innerHTML = '<div id="sc-update-progress-fill" style="height:100%;width:0%;background:#fff;border-radius:3px;transition:width 0.3s;"></div>';
      var updateBtn = document.createElement('button');
      updateBtn.id = 'sc-update-action';
      updateBtn.style.cssText = 'background:#fff;color:#f50;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-weight:600;';
      updateBtn.textContent = _t('updater.update');
      var dismissBtn = document.createElement('button');
      dismissBtn.style.cssText = 'background:none;border:none;color:#fff;cursor:pointer;font-size:16px;';
      dismissBtn.innerHTML = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
      dismissBtn.onclick = function() {
        banner.remove();
        try { sessionStorage.setItem('sc-update-dismissed', '1'); } catch (e) {}
      };
      btnWrap.appendChild(progressBar);
      btnWrap.appendChild(updateBtn);
      btnWrap.appendChild(dismissBtn);
      banner.appendChild(textSpan);
      banner.appendChild(btnWrap);
      document.body.appendChild(banner);

      function showDownloaded() {
        textSpan.textContent = _t('updater.downloaded');
        progressBar.style.display = 'none';
        updateBtn.disabled = false;
        updateBtn.style.opacity = '1';
        updateBtn.textContent = _t('updater.restart');
        updateBtn.onclick = function() { api.updaterInstall(); };
      }

      updateBtn.onclick = function() {
        updateBtn.disabled = true;
        updateBtn.style.opacity = '0.6';
        textSpan.textContent = _t('updater.downloading', {percent: '0'});
        progressBar.style.display = 'block';
        api.updaterDownload().catch(function(err) {
          textSpan.textContent = 'Error: ' + (err.message || err);
          textSpan.style.fontSize = '11px';
          updateBtn.disabled = false;
          updateBtn.style.opacity = '1';
          progressBar.style.display = 'none';
        });
      };

      api.onUpdaterProgress(function(p) {
        var pct = Math.round(p.percent);
        textSpan.textContent = _t('updater.downloading', {percent: pct});
        progressBar.style.display = 'block';
        updateBtn.disabled = true;
        updateBtn.style.opacity = '0.6';
        var fill = document.getElementById('sc-update-progress-fill');
        if (fill) fill.style.width = pct + '%';
      });

      api.onUpdaterStatus(function(status) {
        if (status && status.downloaded) showDownloaded();
      });

      if (${downloaded ? 'true' : 'false'}) showDownloaded();
    })();
  `).catch(() => {});
}

export function checkForUpdates(win: BrowserWindow): void {
  mainWin = win;
  const updater = getAutoUpdater();
  if (!updater) {
    logInfo('[Updater] electron-updater not available, skipping auto-update check.');
    return;
  }

  updater.autoDownload = false;
  updater.autoInstallOnAppQuit = true;

  // The check usually finishes while SoundCloud is still loading; a banner
  // injected into a half-loaded page is lost, so remember the update and show
  // it again once every page load finishes.
  win.webContents.on('did-finish-load', () => injectUpdateBanner());

  updater.on('update-available', (info: any) => {
    logInfo(`[Updater] Update available: ${info.version}, current: ${app.getVersion()}`);
    if (info.version === app.getVersion()) return;
    pendingVersion = String(info.version || '');
    injectUpdateBanner();
  });

  updater.on('error', (err: Error) => {
    logInfo(`[Updater] Error: ${err.message}`);
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.executeJavaScript(`
        (function() {
          var t = document.getElementById('sc-update-banner');
          if (t) { var s = t.querySelector('span'); if (s) s.textContent = 'Updater error: ' + ${JSON.stringify(String(err.message || 'Unknown updater error'))}; }
        })();
      `).catch(() => {});
    }
  });

  try {
    updater.checkForUpdates();
  } catch (err) {
    logInfo(`[Updater] Check failed: ${err}`);
  }
}

export function setupUpdaterIPC(win: BrowserWindow): void {
  mainWin = win;
  const updater = getAutoUpdater();
  if (!updater) return;

  updater.on('download-progress', (progress: any) => {
    logInfo(`[Updater] Download progress: ${Math.round(progress.percent)}%`);
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.UPDATER_PROGRESS, { percent: progress.percent });
    }
  });

  updater.on('update-downloaded', () => {
    logInfo('[Updater] Download complete');
    downloaded = true;
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send(IPC_CHANNELS.UPDATER_STATUS, { downloaded: true });
    }
  });

  ipcMain.handle(IPC_CHANNELS.UPDATER_DOWNLOAD, async (event) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents) throw new Error('Unauthorized IPC sender');
    try {
      logInfo('[Updater] Starting download...');
      await updater.downloadUpdate();
      logInfo('[Updater] downloadUpdate() resolved');
    } catch (err: any) {
      console.error('[Updater] Download error:', err?.message || err);
      throw err;
    }
  });

  ipcMain.on(IPC_CHANNELS.UPDATER_INSTALL, (event) => {
    const win = getMainWindow();
    if (!win || event.sender !== win.webContents) return;
    updater.quitAndInstall(false, true);
  });
}

export async function checkForUpdatesManual(): Promise<{ available: boolean; version?: string }> {
  const updater = getAutoUpdater();
  if (!updater) return { available: false };

  try {
    const result = await updater.checkForUpdates();
    if (result && result.updateInfo) {
      return { available: true, version: result.updateInfo.version };
    }
    return { available: false };
  } catch {
    return { available: false };
  }
}

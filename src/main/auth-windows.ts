import { dialog, type BrowserWindow, type WebContents } from 'electron';
import path from 'path';
import { FIREFOX_UA } from '../shared/user-agent';
import { t } from '../shared/i18n';
import { logWarn } from './logger';

export const AUTH_PRELOAD = path.join(__dirname, '../preload/auth-preload.js');

/** webContents ids of sign-in windows; their requests carry the Firefox identity. */
export const authWebContentsIds = new Set<number>();

/**
 * Sign-in windows (Google & co.) present as Firefox and, if Google still
 * refuses the browser, point the user at the token login instead of leaving
 * them on a dead-end error page.
 */
export function trackAuthWindow(wc: WebContents, authWin: BrowserWindow | null, main: BrowserWindow): void {
  authWebContentsIds.add(wc.id);
  const id = wc.id;
  wc.setUserAgent(FIREFOX_UA);
  wc.once('destroyed', () => authWebContentsIds.delete(id));

  let warned = false;
  const check = (_event: unknown, url: string) => {
    if (warned) return;
    try {
      const u = new URL(url);
      if (u.hostname !== 'accounts.google.com' || !/rejected/i.test(u.pathname)) return;
    } catch { return; }
    warned = true;
    logWarn('[Auth] Google rejected the sign-in browser; offering token login');
    showAuthRejectedHint(main, authWin);
  };
  wc.on('did-navigate', check);
  wc.on('did-navigate-in-page', check);
  wc.on('did-redirect-navigation', (details: any) => check(null, details?.url ?? ''));
}

function showAuthRejectedHint(main: BrowserWindow, authWin: BrowserWindow | null): void {
  if (main.isDestroyed()) return;
  const openTokenPanel = () => main.webContents.executeJavaScript(
    `(function(){var i=document.querySelector('[data-target="auth-token"]'); if(i) i.click(); else if(window.__scOpenOverlay) window.__scOpenOverlay();})();`
  ).catch(() => {});
  dialog.showMessageBox(main, {
    type: 'warning',
    title: 'SixteenCloud',
    message: t('auth.google_blocked_title'),
    detail: t('auth.google_blocked_detail'),
    buttons: [t('auth.google_blocked_token'), t('auth.google_blocked_close')],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  }).then(({ response }) => {
    if (authWin && !authWin.isDestroyed()) authWin.close();
    if (main.isDestroyed()) return;
    if (response === 0) openTokenPanel();
  }).catch(() => {});
}

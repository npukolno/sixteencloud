import { app, type BrowserWindow } from 'electron';
import path from 'path';

export const DEEP_LINK_PREFIX = 'sixteencloud://';

/** Register sixteencloud:// with the OS (dev runs pass the script path along). */
export function registerProtocolClient(): void {
  if (process.defaultApp) {
    if (process.argv.length >= 2) app.setAsDefaultProtocolClient('sixteencloud', process.execPath, [path.resolve(process.argv[1])]);
  } else {
    app.setAsDefaultProtocolClient('sixteencloud');
  }
}

/** Map sixteencloud://open/<path> to a SoundCloud page; null for anything else. */
export function deepLinkToSoundCloudUrl(url: string): string | null {
  const match = url.match(/^sixteencloud:\/\/open\/(.+)/);
  if (!match) return null;
  let trackPath: string;
  try { trackPath = decodeURIComponent(match[1]); } catch { return null; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._~!$&'()*+,;=:@%/-]*$/.test(trackPath) || trackPath.includes('..') || trackPath.startsWith('//')) return null;
  return `https://soundcloud.com/${trackPath}`;
}

export function handleDeepLink(win: BrowserWindow | null, url: string): void {
  const target = deepLinkToSoundCloudUrl(url);
  if (!target || !win || win.isDestroyed()) return;
  win.loadURL(target);
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}

export function findDeepLink(argv: string[]): string | undefined {
  return argv.find(arg => arg.startsWith(DEEP_LINK_PREFIX));
}

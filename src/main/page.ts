import type { BrowserWindow } from 'electron';

/**
 * Run code in the page right away. webContents.executeJavaScript waits until
 * the page stops loading, i.e. for every ad and tracker SoundCloud pulls in,
 * which held the overlays back by ~2 s at startup; the main frame runs it now.
 */
export function runInPage(win: BrowserWindow, code: string): Promise<any> {
  const frame = win.webContents.mainFrame;
  return frame && !frame.isDestroyed() ? frame.executeJavaScript(code) : win.webContents.executeJavaScript(code);
}

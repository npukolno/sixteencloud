import type { BrowserWindow, WebContents } from 'electron';

/** Reject IPC that does not come from the main SoundCloud window. */
export function assertMainRenderer(event: { sender: WebContents }, mainWindow: BrowserWindow): void {
  if (event.sender !== mainWindow.webContents) throw new Error('Unauthorized IPC sender');
}

/** webContents.send that tolerates a window closed mid-flight. */
export function safeSend(win: BrowserWindow, channel: string, ...args: unknown[]): void {
  if (!win.isDestroyed()) win.webContents.send(channel, ...args);
}

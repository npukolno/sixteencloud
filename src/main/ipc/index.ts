import type { BrowserWindow } from 'electron';
import { initStore, setupStoreIPC } from './store';
import { setupAppIPC } from './app';
import { setupAuthIPC } from './auth';
import { setupScrobbleIPC } from './scrobble';
import { setupDownloaderIPC } from './downloader';
import { setupHistoryIPC } from './history';
import { setupLyricsIPC } from './lyrics';

export { initStore, getStore, getEncryptionKey, getSecret, setSecret } from './store';
export { assertMainRenderer, safeSend } from './guard';
export { readResponseBuffer, streamResponseToFile } from './net';
export { resolveTrackStream, type ResolvedTrackStream } from './soundcloud-api';

/** Open the store and register every main-window IPC handler. */
export function setupIPC(mainWindow: BrowserWindow): void {
  initStore();
  setupStoreIPC(mainWindow);
  setupAppIPC(mainWindow);
  setupAuthIPC(mainWindow);
  setupScrobbleIPC(mainWindow);
  setupDownloaderIPC(mainWindow);
  setupHistoryIPC(mainWindow);
  setupLyricsIPC(mainWindow);
}

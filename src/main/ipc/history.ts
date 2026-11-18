import { ipcMain, type BrowserWindow } from 'electron';
import { IPC_CHANNELS, emptyHistoryStats } from '../../shared/constants';
import { assertMainRenderer } from './guard';
import { getStore } from './store';

export function setupHistoryIPC(mainWindow: BrowserWindow): void {
  const store = getStore();

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET, (event) => {
    assertMainRenderer(event, mainWindow);
    return store.get('history.tracks') || [];
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, (event) => {
    assertMainRenderer(event, mainWindow);
    store.set('history.tracks', []);
    // The panel statistics come from these lifetime counters, so clearing the
    // history has to reset them as well or the top numbers would linger.
    store.set('history.stats', emptyHistoryStats());
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (event, query: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof query !== 'string' || query.length > 500) return [];
    const tracks = (store.get('history.tracks') || []) as Array<{ title: string; artist: string }>;
    const q = query.toLowerCase();
    return tracks.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q));
  });
}

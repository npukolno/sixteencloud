import { ipcMain, type BrowserWindow } from 'electron';
import { IPC_CHANNELS, emptyHistoryStats } from '../../shared/constants';
import { assertMainRenderer } from './guard';
import { getHistoryFile } from './store';

export function setupHistoryIPC(mainWindow: BrowserWindow): void {
  const history = getHistoryFile();

  ipcMain.handle(IPC_CHANNELS.HISTORY_GET, (event) => {
    assertMainRenderer(event, mainWindow);
    return history.getTracks();
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_CLEAR, (event) => {
    assertMainRenderer(event, mainWindow);
    history.setTracks([]);
    // The panel statistics come from these lifetime counters, so clearing the
    // history has to reset them as well or the top numbers would linger.
    history.setStats(emptyHistoryStats() as unknown as Record<string, unknown>);
  });

  ipcMain.handle(IPC_CHANNELS.HISTORY_SEARCH, (event, query: string) => {
    assertMainRenderer(event, mainWindow);
    if (typeof query !== 'string' || query.length > 500) return [];
    const tracks = history.getTracks() as Array<{ title: string; artist: string }>;
    const q = query.toLowerCase();
    return tracks.filter(t => (t.title || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q));
  });
}

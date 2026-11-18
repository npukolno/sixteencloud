import { app, dialog, ipcMain, type BrowserWindow } from 'electron';
import fs from 'fs';
import { IPC_CHANNELS } from '../../shared/constants';
import { logInfo, logWarn } from '../logger';
import { assertMainRenderer } from './guard';
import { buildProfile, parseProfile, PROFILE_MAX_BYTES } from './profile-backup';
import { getStore } from './store';

/**
 * Settings profile export / import. File paths come from the native dialogs
 * opened here, never from the renderer, and the renderer sends no payload.
 */
export function setupProfileIPC(mainWindow: BrowserWindow): void {
  ipcMain.handle(IPC_CHANNELS.SETTINGS_EXPORT, async (event) => {
    assertMainRenderer(event, mainWindow);
    const store = getStore() as unknown as { get: (key: string) => unknown };
    const profile = buildProfile((key) => store.get(key), app.getVersion());
    const date = new Date().toISOString().slice(0, 10);
    const result = await dialog.showSaveDialog(mainWindow, {
      title: 'Export settings',
      defaultPath: `SixteenCloud-settings-${date}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    fs.writeFileSync(result.filePath, JSON.stringify(profile, null, 2), { encoding: 'utf-8', mode: 0o600 });
    logInfo(`[Profile] Exported ${Object.keys(profile.values).length} settings`);
    return { canceled: false, count: Object.keys(profile.values).length };
  });

  ipcMain.handle(IPC_CHANNELS.SETTINGS_IMPORT, async (event) => {
    assertMainRenderer(event, mainWindow);
    const result = await dialog.showOpenDialog(mainWindow, {
      title: 'Import settings',
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }],
    });
    const filePath = result.filePaths && result.filePaths[0];
    if (result.canceled || !filePath) return { canceled: true };
    try {
      const stat = fs.statSync(filePath);
      if (!stat.isFile() || stat.size > PROFILE_MAX_BYTES) throw new Error('Profile file is too large');
      const parsed = parseProfile(fs.readFileSync(filePath, 'utf-8'));
      const store = getStore() as unknown as { set: (key: string, value: unknown) => void };
      const applied = Object.keys(parsed.values);
      for (const key of applied) store.set(key, parsed.values[key]);
      if (parsed.skipped.length) logWarn('[Profile] Skipped on import:', parsed.skipped.map(s => `${s.key} (${s.reason})`).join(', '));
      logInfo(`[Profile] Imported ${applied.length} settings`);
      return { canceled: false, applied: applied.length, skipped: parsed.skipped.length };
    } catch (err: any) {
      return { canceled: false, error: String(err?.message || err) };
    }
  });
}

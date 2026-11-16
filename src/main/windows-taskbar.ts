import { BrowserWindow, ipcMain, nativeImage, type IpcMainEvent, type NativeImage } from 'electron';
import path from 'path';
import { IPC_CHANNELS } from '../shared/constants';
import { t } from '../shared/i18n';
import { logInfo, logWarn } from './logger';
import { TaskbarController, toSnapshot, type TaskbarActions, type TaskbarIcons } from './taskbar-controller';

/**
 * Windows only: previous / play-pause / next under the taskbar thumbnail and
 * the track progress on the taskbar button. Track state comes from the same
 * TRACK_INFO messages that feed Discord and MPRIS.
 */
export function setupWindowsTaskbar(win: BrowserWindow, actions: TaskbarActions): void {
  if (process.platform !== 'win32') return;

  const dir = path.join(__dirname, '../../assets/taskbar');
  let icons: TaskbarIcons<NativeImage> | null = null;
  try {
    // createFromPath picks up the name@2x.png variants for high-DPI screens.
    const load = (name: string) => nativeImage.createFromPath(path.join(dir, `${name}.png`));
    const loaded = { prev: load('prev'), play: load('play'), pause: load('pause'), next: load('next') };
    if (Object.values(loaded).some(img => img.isEmpty())) {
      logWarn('[Taskbar] Thumbnail toolbar icons missing in', dir, '- buttons disabled, progress still shown');
    } else {
      icons = loaded;
    }
  } catch (err: any) {
    logWarn('[Taskbar] Could not load thumbnail toolbar icons:', err?.message || String(err));
  }

  const controller = new TaskbarController<NativeImage>(win, icons, actions, key => t(key));

  const onTrackInfo = (event: IpcMainEvent, info: unknown) => {
    if (win.isDestroyed() || event.sender !== win.webContents) return;
    controller.update(toSnapshot(info));
  };
  ipcMain.on(IPC_CHANNELS.TRACK_INFO, onTrackInfo);

  win.on('show', () => controller.refreshButtons());
  const timer = setInterval(() => controller.tick(), 1000);
  win.on('closed', () => {
    clearInterval(timer);
    ipcMain.removeListener(IPC_CHANNELS.TRACK_INFO, onTrackInfo);
  });

  controller.refreshButtons();
  logInfo(`[Taskbar] Windows taskbar controls ready (${icons ? 'buttons + progress' : 'progress only'})`);
}

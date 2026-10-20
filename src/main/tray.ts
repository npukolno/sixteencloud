import { Tray, Menu, BrowserWindow, app, nativeImage, NativeImage } from 'electron';
import path from 'path';
import { APP_NAME } from '../shared/constants';
import { t } from '../shared/i18n';

let tray: Tray | null = null;
let _toggleMiniPlayer: (() => void) | null = null;

export function setMiniPlayerToggle(fn: () => void): void {
  _toggleMiniPlayer = fn;
}

export function createTray(mainWindow: BrowserWindow): Tray {
  const iconPath = path.join(__dirname, '../../assets/icons/icon.png');
  let icon: NativeImage;
  try {
    icon = nativeImage.createFromPath(iconPath);
  } catch {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon.isEmpty() ? nativeImage.createEmpty() : icon);

  const template: any[] = [
    {
      label: t('tray.show'),
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    {
      label: t('tray.settings'),
      click: () => {
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.executeJavaScript('window.__scToggleOverlay?.();').catch(() => {});
      },
    },
    {
      label: t('tray.mini_player'),
      click: () => {
        if (_toggleMiniPlayer) _toggleMiniPlayer();
      },
    },
    { type: 'separator' },
    {
      label: t('tray.play_pause'),
      click: () => {
        mainWindow.webContents.executeJavaScript(`
          document.querySelector('.playControl')?.click();
        `);
      },
    },
    {
      label: t('tray.prev'),
      click: () => {
        mainWindow.webContents.executeJavaScript(`
          document.querySelector('.skipControl__previous')?.click();
        `);
      },
    },
    {
      label: t('tray.next'),
      click: () => {
        mainWindow.webContents.executeJavaScript(`
          document.querySelector('.skipControl__next')?.click();
        `);
      },
    },
  ];

  template.push({ type: 'separator' });
  template.push({
    label: t('tray.quit'),
    click: () => {
      app.quit();
    },
  });

  const contextMenu = Menu.buildFromTemplate(template);
  tray.setContextMenu(contextMenu);
  tray.setToolTip(APP_NAME);

  tray.on('double-click', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  return tray;
}

export function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

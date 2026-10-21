import { contextBridge, ipcRenderer } from 'electron';

type MiniAction =
  | 'prev'
  | 'play-pause'
  | 'next'
  | 'close'
  | 'volume'
  | 'volume-step'
  | 'seek'
  | 'seek-by'
  | 'mute'
  | 'hide'
  | 'open-track'
  | 'focus';

const api = {
  sendAction: (action: MiniAction, value?: number | string): void => {
    ipcRenderer.send('mini:action', action, value);
  },
  onUpdate: (callback: (info: unknown) => void): void => {
    ipcRenderer.on('mini:update', (_event, info: unknown) => callback(info));
  },
};

contextBridge.exposeInMainWorld('sixteenCloudMini', api);


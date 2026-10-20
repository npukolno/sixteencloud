import { contextBridge, ipcRenderer } from 'electron';

const api = {
  sendAction: (action: 'prev' | 'play-pause' | 'next' | 'close' | 'volume', value?: number): void => {
    ipcRenderer.send('mini:action', action, value);
  },
  onUpdate: (callback: (info: unknown) => void): void => {
    ipcRenderer.on('mini:update', (_event, info: unknown) => callback(info));
  },
};

contextBridge.exposeInMainWorld('sixteenCloudMini', api);


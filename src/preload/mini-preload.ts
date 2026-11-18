import { contextBridge, ipcRenderer } from 'electron';
import { IPC_CHANNELS } from '../shared/constants';
import type { MiniAction, MiniPlayerState } from '../shared/mini-player';

const api = {
  sendAction: (action: MiniAction, value?: number | string): void => {
    ipcRenderer.send('mini:action', action, value);
  },
  /** Subscribe to state pushes; returns an unsubscribe function. */
  onUpdate: (callback: (info: MiniPlayerState) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, info: MiniPlayerState) => callback(info);
    ipcRenderer.on(IPC_CHANNELS.MINI_PLAYER_UPDATE, listener);
    return () => { ipcRenderer.removeListener(IPC_CHANNELS.MINI_PLAYER_UPDATE, listener); };
  },
};

contextBridge.exposeInMainWorld('sixteenCloudMini', api);

export type SixteenCloudMiniAPI = typeof api;

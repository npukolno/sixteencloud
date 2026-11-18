import { powerMonitor, type BrowserWindow } from 'electron';
import { getStore } from './ipc';
import { logInfo } from './logger';
import { runInPage } from './page';

/**
 * Battery saver: on battery power the page drops the visualizer, live blur and
 * animations (window.__scSetPowerSaver in the overlay init script). On by default.
 * Returns the push function so the page pipeline can re-apply it after a load.
 */
export function setupBatterySaver(win: BrowserWindow): () => void {
  let lastActive: boolean | null = null;
  let enabled = getStore().get('settings.batterySaver') !== false;
  const push = () => {
    if (win.isDestroyed()) return;
    let onBattery = false;
    try { onBattery = powerMonitor.isOnBatteryPower(); } catch { /* no power info */ }
    const active = enabled && onBattery;
    if (active !== lastActive) logInfo(`[Power] Battery saver ${active ? 'on' : 'off'} (setting ${enabled ? 'on' : 'off'}, on battery: ${onBattery})`);
    lastActive = active;
    runInPage(win, `window.__scSetPowerSaver && window.__scSetPowerSaver(${active})`).catch(() => {});
  };
  powerMonitor.on('on-battery', push);
  powerMonitor.on('on-ac', push);
  getStore().onDidChange('settings', (next, prev) => {
    if (next?.batterySaver === prev?.batterySaver) return;
    enabled = next?.batterySaver !== false;
    push();
  });
  return push;
}

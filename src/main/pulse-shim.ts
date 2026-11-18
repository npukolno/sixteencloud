import { app } from 'electron';
import path from 'path';
import fs from 'fs';
import { logInfo, logWarn } from './logger';

// The volume mixer reads the PulseAudio stream identity, which Chromium
// hardcodes to "Chromium" / "chromium-browser" (PULSE_PROP_OVERRIDE only covers
// the name). native/pulse-sixteencloud.c rewrites it to ours. Only Chromium's
// audio service talks to PulseAudio, and it runs unsandboxed, so it is started
// with a plain fork+exec (not from the zygote) that inherits this process's
// environment: putting the shim in LD_PRELOAD here, before any audio plays,
// reaches it without restarting the whole app.
export function installPulseIdentityShim(): boolean {
  if (process.platform !== 'linux') return false;
  if (process.env.ELECTRON_RUN_AS_NODE) return false;

  const built = path.join(__dirname, '..', 'native', 'pulse-sixteencloud.so');
  if (!fs.existsSync(built)) return false;

  // Packaged builds keep the shim inside app.asar, which the dynamic loader
  // cannot read: stage a copy in the profile directory and preload that.
  let shim = built;
  try {
    const staged = path.join(app.getPath('userData'), 'pulse-sixteencloud.so');
    const stale = !fs.existsSync(staged) || fs.statSync(staged).size !== fs.statSync(built).size;
    if (stale) fs.copyFileSync(built, staged);
    shim = staged;
  } catch (err: any) {
    logWarn('[App] Could not stage PulseAudio identity shim:', err?.message || String(err));
  }

  const current = process.env.LD_PRELOAD || '';
  if (!current.split(':').includes(shim)) {
    process.env.LD_PRELOAD = current ? `${shim}:${current}` : shim;
  }
  logInfo('[App] PulseAudio identity shim armed for the audio service:', shim);
  return true;
}

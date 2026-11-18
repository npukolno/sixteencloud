import { app, ipcMain, safeStorage, type BrowserWindow } from 'electron';
import Store from 'electron-store';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import { IPC_CHANNELS, STORE_DEFAULTS } from '../../shared/constants';
import type { StoreSchema } from '../../shared/types';
import { logInfo, logWarn } from '../logger';
import { READ_ONLY_STORE_KEYS, validateStoreKey, validateStoreValue } from './validators';
import { assertMainRenderer } from './guard';

let store: Store<StoreSchema> | undefined;
let encryptionKey: string | null = null;

/**
 * Key for electron-store's at-rest obfuscation. It lives next to the config,
 * so it only keeps the file from being casually readable; real secrets go
 * through {@link getSecret}/{@link setSecret} on top of it.
 */
export function getEncryptionKey(): string {
  if (encryptionKey) return encryptionKey;
  const keyPath = path.join(app.getPath('userData'), '.encryption-key');
  if (fs.existsSync(keyPath)) {
    encryptionKey = fs.readFileSync(keyPath, 'utf-8').trim();
  } else {
    encryptionKey = crypto.randomBytes(32).toString('hex');
    fs.writeFileSync(keyPath, encryptionKey, { encoding: 'utf-8', mode: 0o600 });
  }
  return encryptionKey;
}

/** Open the config store once; a corrupt file is set aside, never deleted. */
export function initStore(): Store<StoreSchema> {
  if (store) return store;
  const open = () => new Store<StoreSchema>({
    defaults: STORE_DEFAULTS as StoreSchema,
    encryptionKey: getEncryptionKey(),
  });
  try {
    store = open();
    store.get('language');
  } catch (e: any) {
    logWarn('Store corrupted, resetting:', e?.message);
    const storePath = path.join(app.getPath('userData'), 'config.json');
    try { fs.renameSync(storePath, `${storePath}.corrupt-${Date.now()}`); } catch { /* nothing to keep */ }
    store = open();
  }
  migrateSecrets(store);
  return store;
}

/**
 * The store. Undefined only before {@link initStore} has run (i.e. before
 * app.whenReady), which callers that may run that early must handle.
 */
export function getStore(): Store<StoreSchema> {
  return store as Store<StoreSchema>;
}

// --- Secrets ---------------------------------------------------------------
// OAuth and scrobble tokens are wrapped with Electron's safeStorage (Keychain,
// DPAPI, libsecret/kwallet) when a real OS keyring backs it. Linux without a
// keyring reports 'basic_text', a fixed built-in key that adds nothing over
// the store's own obfuscation, so values stay as they are there.
const SECRET_PREFIX = 'ss1:';
export type SecretKey = 'authToken.token' | 'scrobble.token';

function keyringAvailable(): boolean {
  try {
    if (!safeStorage.isEncryptionAvailable()) return false;
    if (process.platform === 'linux') {
      const backend = (safeStorage as { getSelectedStorageBackend?: () => string }).getSelectedStorageBackend?.();
      if (!backend || backend === 'basic_text' || backend === 'unknown') return false;
    }
    return true;
  } catch {
    return false;
  }
}

function wrapSecret(plain: string): string {
  if (!plain || !keyringAvailable()) return plain;
  try {
    return SECRET_PREFIX + safeStorage.encryptString(plain).toString('base64');
  } catch (e: any) {
    logWarn('[Secrets] encrypt failed, keeping value unwrapped:', e?.message);
    return plain;
  }
}

function unwrapSecret(stored: unknown): string {
  if (typeof stored !== 'string' || !stored) return '';
  if (!stored.startsWith(SECRET_PREFIX)) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored.slice(SECRET_PREFIX.length), 'base64'));
  } catch (e: any) {
    // Keyring changed or locked: the token is gone, the user signs in again.
    logWarn('[Secrets] decrypt failed, treating token as absent:', e?.message);
    return '';
  }
}

export function getSecret(key: SecretKey): string {
  return unwrapSecret((getStore() as any).get(key));
}

export function setSecret(key: SecretKey, value: string): void {
  (getStore() as any).set(key, wrapSecret(value));
}

/** Wrap tokens saved in plain form by earlier versions. */
function migrateSecrets(s: Store<StoreSchema>): void {
  if (!keyringAvailable()) return;
  for (const key of ['authToken.token', 'scrobble.token'] as const) {
    const raw = (s as any).get(key);
    if (typeof raw === 'string' && raw && !raw.startsWith(SECRET_PREFIX)) {
      (s as any).set(key, wrapSecret(raw));
      logInfo(`[Secrets] moved ${key} into the OS keyring`);
    }
  }
}

export function setupStoreIPC(mainWindow: BrowserWindow): void {
  const s = getStore();
  ipcMain.handle(IPC_CHANNELS.STORE_GET, (event, key: string) => {
    assertMainRenderer(event, mainWindow);
    validateStoreKey(key);
    return s.get(key);
  });

  ipcMain.handle(IPC_CHANNELS.STORE_SET, (event, key: string, value: unknown) => {
    assertMainRenderer(event, mainWindow);
    validateStoreKey(key);
    if (READ_ONLY_STORE_KEYS.has(key)) throw new Error('Store key is read-only');
    validateStoreValue(key, value);
    s.set(key, value);
  });

  // Launch-on-startup follows the setting.
  s.onDidChange('settings', (newVal) => {
    const settings = newVal as StoreSchema['settings'] | undefined;
    if (settings) app.setLoginItemSettings({ openAtLogin: settings.launchOnStartup });
  });
}

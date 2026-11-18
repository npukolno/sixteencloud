import type { BrowserWindow } from 'electron';
import path from 'path';
import fs from 'fs';
import { logWarn } from './logger';
import { runInPage } from './page';

// Page scripts written as real TypeScript in src/renderer/page/ and bundled
// by scripts/build-renderer.mjs. Read once, injected on every page load.
const cache = new Map<string, string>();

export type PageScript = 'media-session' | 'load-watcher';

function load(name: PageScript): string | null {
  if (cache.has(name)) return cache.get(name)!;
  try {
    const code = fs.readFileSync(path.join(__dirname, '../renderer/page', `${name}.js`), 'utf-8');
    cache.set(name, code);
    return code;
  } catch (e: any) {
    logWarn(`[Page] script ${name} missing (run npm run build):`, e?.message);
    return null;
  }
}

export function injectPageScript(win: BrowserWindow, name: PageScript): void {
  const code = load(name);
  if (!code || win.isDestroyed()) return;
  runInPage(win, code).catch((e: any) => logWarn(`[Page] ${name} inject error:`, e?.message));
}

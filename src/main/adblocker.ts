import { session, type BrowserWindow } from 'electron';
import { AD_CSS_SELECTORS, AD_DOMAINS, AD_URL_PATTERNS, IPC_CHANNELS } from '../shared/constants';
import type { StoreSchema } from '../shared/types';
import { getStore } from './ipc';

let blockedCount = 0;
let countNotifyTimer: ReturnType<typeof setTimeout> | null = null;

function notifyBlockCount(win: BrowserWindow): void {
  // Network bursts can block many resources at once; coalesce renderer IPC.
  if (countNotifyTimer) return;
  countNotifyTimer = setTimeout(() => {
    countNotifyTimer = null;
    if (!win.isDestroyed()) win.webContents.send(IPC_CHANNELS.AD_BLOCK_COUNT, blockedCount);
  }, 100);
}

/** Hide ad slots SoundCloud renders itself (network blocking cannot reach those). */
export function injectAdBlockCSS(win: BrowserWindow): void {
  win.webContents.insertCSS(AD_CSS_SELECTORS.map(s => `${s} { display: none !important; }`).join('\n')).catch(() => {});
}

export function setupAdblocker(win: BrowserWindow): void {
  const store = getStore();
  let enabled = true;
  let customRules: string[] = [];
  let whitelist: string[] = [];
  let domainSet = new Set(AD_DOMAINS);
  let remoteKey = '';

  // Settings are cached and refreshed on change; reading the store per
  // request would re-read and decrypt config.json for every network request.
  const refresh = (ad: StoreSchema['adblocker'] | undefined) => {
    enabled = ad?.enabled !== false;
    customRules = Array.isArray(ad?.customRules) ? ad!.customRules.filter(r => typeof r === 'string' && r) : [];
    whitelist = Array.isArray(ad?.whitelist) ? ad!.whitelist.filter(w => typeof w === 'string' && w) : [];
    const remote = Array.isArray(ad?.remoteDomains) ? ad!.remoteDomains : [];
    const key = remote.length + ':' + remote.join(',');
    if (key !== remoteKey) {
      remoteKey = key;
      domainSet = new Set([...AD_DOMAINS, ...remote]);
    }
  };
  refresh(store.get('adblocker'));
  blockedCount = Number(store.get('adblocker.blockedCount')) || 0;
  store.onDidChange('adblocker', (next) => refresh(next));

  const isBlockedDomain = (hostname: string): boolean => {
    const labels = hostname.split('.');
    for (let i = 0; i < labels.length - 1; i++) {
      if (domainSet.has(labels.slice(i).join('.'))) return true;
    }
    return false;
  };
  const block = (callback: (response: Electron.CallbackResponse) => void) => {
    blockedCount++;
    // Persist now and then, not on every hit (each write rewrites config.json).
    if (blockedCount % 50 === 0) store.set('adblocker.blockedCount', blockedCount);
    notifyBlockCount(win);
    callback({ cancel: true });
  };

  session.defaultSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    if (!enabled || win.isDestroyed()) { callback({ cancel: false }); return; }
    const url = details.url;
    let hostname = '';
    try { hostname = new URL(url).hostname; } catch { callback({ cancel: false }); return; }

    // The whitelist is an explicit user override and beats every rule.
    if (whitelist.length > 0 && whitelist.some(w => url.includes(w))) { callback({ cancel: false }); return; }

    // SoundCloud's own hosts: only its ad/promoted URL patterns are blocked.
    const isSoundCloudHost = hostname === 'soundcloud.com' || hostname.endsWith('.soundcloud.com');
    const isCdnHost = hostname === 'sndcdn.com' || hostname.endsWith('.sndcdn.com');
    if (isSoundCloudHost || isCdnHost) {
      if (AD_URL_PATTERNS.some(p => url.includes(p))) block(callback);
      else callback({ cancel: false });
      return;
    }

    if (isBlockedDomain(hostname)) { block(callback); return; }
    if (customRules.length > 0 && customRules.some(rule => url.includes(rule))) { block(callback); return; }
    callback({ cancel: false });
  });
}

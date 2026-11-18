import { session } from 'electron';
import { applyFirefoxHeaders, applyUserAgentHeaders } from '../shared/user-agent';
import { isTrustedOAuthUrl, isTrustedSoundCloudUrl } from '../shared/security';
import type { StoreSchema } from '../shared/types';
import { getStore } from './ipc';
import { authWebContentsIds } from './auth-windows';
import { logInfo } from './logger';

const COUNTRY_LANGS: Record<string, string> = {
  US: 'en-US,en;q=0.9',
  GB: 'en-GB,en;q=0.9',
  DE: 'de-DE,de;q=0.9,en;q=0.8',
  FR: 'fr-FR,fr;q=0.9,en;q=0.8',
  JP: 'ja-JP,ja;q=0.9,en;q=0.8',
  CA: 'en-CA,en;q=0.9',
  AU: 'en-AU,en;q=0.9',
  NL: 'nl-NL,nl;q=0.9,en;q=0.8',
  SE: 'sv-SE,sv;q=0.9,en;q=0.8',
  BR: 'pt-BR,pt;q=0.9,en;q=0.8',
};

function safeHostname(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function describeProxy(proxyUrl: string): string {
  try { const p = new URL(proxyUrl); return `${p.protocol}//${p.hostname}:${p.port || ''}`; } catch { return '[configured]'; }
}

/**
 * Request identity and the geo-bypass Accept-Language. Settings are cached
 * and refreshed from store change events, not read on every request.
 */
export async function setupGeoBypass(): Promise<void> {
  const store = getStore();
  let geoEnabled = false;
  let geoLang = COUNTRY_LANGS.US;
  const refresh = (geo: StoreSchema['geoBypass'] | undefined) => {
    geoEnabled = !!geo?.enabled;
    geoLang = COUNTRY_LANGS[geo?.spoofCountry || 'US'] || COUNTRY_LANGS.US;
  };
  refresh(store.get('geoBypass'));
  store.onDidChange('geoBypass', (next) => refresh(next));

  // Re-apply the saved proxy on startup.
  if (geoEnabled) {
    const proxyUrl = (store.get('geoBypass.proxyUrl') || '') as string;
    if (proxyUrl) {
      logInfo(`[Geo-Bypass] Applying saved proxy: ${describeProxy(proxyUrl)}`);
      await session.defaultSession.setProxy({ proxyRules: proxyUrl });
    }
  }

  session.defaultSession.webRequest.onBeforeSendHeaders((details, callback) => {
    // Electron advertises its own product through the User-Agent and through
    // Chromium client hints even when the UA is replaced, and a UA that claims
    // a different OS than the hints is an automation tell. Rewrite the whole
    // identity block from one platform profile (see shared/user-agent.ts).
    // Sign-in providers get the same identity: Google compares Sec-CH-UA
    // against the UA and rejects a Chromium-only brand list as "not secure".
    if (authWebContentsIds.has(details.webContentsId ?? -1) && !isTrustedSoundCloudUrl(details.url)) {
      applyFirefoxHeaders(details.requestHeaders);
      callback({ requestHeaders: details.requestHeaders });
      return;
    }
    if (
      isTrustedSoundCloudUrl(details.url) ||
      isTrustedOAuthUrl(details.url) ||
      /(^|\.)(sndcdn\.com|gstatic\.com|googleusercontent\.com)$/i.test(safeHostname(details.url))
    ) {
      if (applyUserAgentHeaders(details.requestHeaders)) {
        callback({ requestHeaders: details.requestHeaders });
        return;
      }
    }
    if (geoEnabled) details.requestHeaders['Accept-Language'] = geoLang;
    callback({ requestHeaders: details.requestHeaders });
  });
}

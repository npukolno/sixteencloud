import { SOUNDCLOUD_API_V2 } from '../../shared/constants';
import { isAllowedMediaUrl, isTrustedSoundCloudUrl } from '../../shared/security';
import { logInfo, logWarn } from '../logger';
import { eFetch } from './net';
import { getSecret } from './store';

let cachedClientId: string | null = null;
let clientIdInFlight: Promise<string> | null = null;

async function scrapeClientId(): Promise<string> {
  try {
    const pageResp = await eFetch('https://soundcloud.com');
    const pageHtml = await pageResp.text();
    const scriptMatches = pageHtml.match(/https:\/\/a-v2\.sndcdn\.com\/assets\/[a-zA-Z0-9-]+\.js/g);
    if (!scriptMatches) throw new Error('No scripts found');
    // client_id usually sits in one of the last bundles.
    const candidates = scriptMatches.slice(Math.max(0, scriptMatches.length - 5)).reverse();
    const scriptTexts = await Promise.all(candidates.map(async (scriptUrl) => {
      const scriptResp = await eFetch(scriptUrl);
      return scriptResp.ok ? scriptResp.text() : '';
    }));
    for (const scriptText of scriptTexts) {
      const cidMatch = scriptText.match(/client_id:"([a-zA-Z0-9]{32})"/);
      if (cidMatch) {
        logInfo(`[SoundCloud] Found client_id: ${cidMatch[1]}`);
        return cidMatch[1];
      }
    }
  } catch (err) {
    logInfo(`[SoundCloud] Failed to extract client_id: ${err}`);
  }
  throw new Error('Could not find SoundCloud client_id. Try logging in with OAuth token first.');
}

/** SoundCloud's public web client_id; concurrent callers share one scrape. */
export async function getClientId(): Promise<string> {
  if (cachedClientId) return cachedClientId;
  if (!clientIdInFlight) {
    clientIdInFlight = scrapeClientId()
      .then((id) => { cachedClientId = id; return id; })
      .finally(() => { clientIdInFlight = null; });
  }
  return clientIdInFlight;
}

/** The stored OAuth token, or '' when signed out. */
export function storedOAuthToken(): string {
  return getSecret('authToken.token');
}

export function authHeaders(token: string): Record<string, string> {
  return token ? { Authorization: `OAuth ${token}` } : {};
}

/**
 * Call the SoundCloud API with the current client_id. SoundCloud rotates the
 * id; a 401/403 drops the cached one, scrapes a fresh one and retries once.
 */
export async function scApiFetch(buildUrl: (clientId: string) => string, token = storedOAuthToken()): Promise<Response> {
  const call = async (tok: string) => eFetch(buildUrl(await getClientId()), { headers: authHeaders(tok) });
  let resp = await call(token);
  if (resp.status === 401 || resp.status === 403) {
    logInfo(`[SoundCloud] API answered ${resp.status}, refreshing client_id...`);
    cachedClientId = null;
    resp = await call(token);
    if (token && (resp.status === 401 || resp.status === 403)) {
      // A stale or revoked token makes SoundCloud reject even public tracks.
      logWarn(`[SoundCloud] OAuth token rejected (${resp.status}), retrying anonymously`);
      resp = await call('');
    }
  }
  return resp;
}

export function withClientId(url: string, clientId: string): string {
  return url + (url.includes('?') ? '&' : '?') + 'client_id=' + clientId;
}

export interface ScTrackData {
  id?: number;
  title?: string;
  genre?: string;
  created_at?: string;
  release_date?: string | null;
  artwork_url?: string | null;
  permalink_url?: string;
  user?: { username?: string };
  media?: { transcodings?: Array<{ url: string; format: { protocol: string; mime_type?: string } }> };
}

export interface ResolvedTrackStream {
  audioUrl: string;
  trackData: ScTrackData;
}

/** Turn a track's transcodings into a fetchable audio URL (progressive first, else HLS). */
export async function streamUrlForTrack(trackData: ScTrackData, token = storedOAuthToken()): Promise<string> {
  const transcodings = trackData.media?.transcodings || [];
  const streamInfo = transcodings.find(t => t.format.protocol === 'progressive') || transcodings[0];
  if (!streamInfo) throw new Error('No stream URL found');
  const streamResp = await scApiFetch((cid) => withClientId(streamInfo.url, cid), token);
  if (!streamResp.ok) throw new Error(`Stream URL fetch failed: ${streamResp.status}`);
  const streamData = await streamResp.json() as { url?: string };
  if (typeof streamData.url !== 'string' || !isAllowedMediaUrl(streamData.url)) {
    throw new Error('SoundCloud returned an unsafe stream URL');
  }
  return streamData.url;
}

/** Resolve any SoundCloud page URL (track, playlist, user) through /resolve. */
export async function scResolve<T = unknown>(pageUrl: string, token = storedOAuthToken()): Promise<{ resp: Response; data: T | null }> {
  const resp = await scApiFetch((cid) => `${SOUNDCLOUD_API_V2}/resolve?url=${encodeURIComponent(pageUrl)}&client_id=${cid}`, token);
  return { resp, data: resp.ok ? await resp.json() as T : null };
}

/**
 * Resolve a SoundCloud track page to a directly fetchable audio URL.
 * Shared by the downloader and the offline cache.
 */
export async function resolveTrackStream(trackUrl: string, token = storedOAuthToken()): Promise<ResolvedTrackStream> {
  if (typeof trackUrl !== 'string' || !isTrustedSoundCloudUrl(trackUrl)) throw new Error('Invalid track URL');
  const { resp, data } = await scResolve<ScTrackData>(trackUrl, token);
  if (!resp.ok || !data) throw new Error(`Resolve failed: ${resp.status}`);
  return { audioUrl: await streamUrlForTrack(data, token), trackData: data };
}

/** Same as {@link resolveTrackStream} for a numeric track id. */
export async function resolveTrackStreamById(trackId: number, token = storedOAuthToken()): Promise<ResolvedTrackStream> {
  const resp = await scApiFetch((cid) => `${SOUNDCLOUD_API_V2}/tracks/${trackId}?client_id=${cid}`, token);
  if (!resp.ok) throw new Error(`Track API returned ${resp.status}`);
  const data = await resp.json() as ScTrackData;
  return { audioUrl: await streamUrlForTrack(data, token), trackData: data };
}

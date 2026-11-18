import { session } from 'electron';

// Fallback policy for SoundCloud responses that ship none. SoundCloud's own
// bundles need inline and eval'd scripts from https hosts, hence the breadth.
const SOUNDCLOUD_FALLBACK_CSP = [
  "default-src 'self' https: data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
  "style-src 'self' 'unsafe-inline' https:",
  "img-src 'self' https: data: blob:",
  "media-src 'self' https: data: blob:",
  "font-src 'self' https: data:",
  "connect-src 'self' https: wss: data: blob:",
  "frame-src https:",
  "worker-src 'self' https: blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self' https:",
].join('; ');

/**
 * Add the fallback policy to remote http(s) responses only. Our own windows
 * (splash, mini-player) are file:// pages with their own strict meta policy
 * and must not get this permissive one; SoundCloud's own CSP is never touched.
 */
export function applyContentSecurityPolicy(): void {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = details.responseHeaders || {};
    const remote = /^https?:/i.test(details.url);
    const existing = Object.keys(headers).some(name => name.toLowerCase() === 'content-security-policy');
    if (!remote || existing) {
      callback({ responseHeaders: headers });
      return;
    }
    callback({ responseHeaders: { ...headers, 'Content-Security-Policy': [SOUNDCLOUD_FALLBACK_CSP] } });
  });
}

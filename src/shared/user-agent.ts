/**
 * Platform-accurate browser fingerprint.
 *
 * SoundCloud (and the Cloudflare layer in front of it) cross-checks the
 * User-Agent string against Chromium client hints and against what the page
 * can read from JavaScript. Electron's default UA advertises "Electron/<v>
 * SixteenCloud/<v>", and a UA that claims a different OS than the client hints
 * is a classic automation tell. Everything here therefore derives from the
 * machine the app actually runs on, and reports the same values in every
 * place a server or script can observe them.
 *
 * Only `process.platform`, `process.arch` and `process.versions.chrome` are
 * used: this module is imported by the sandboxed preload bundle too, where
 * `require('os')` is unavailable.
 */

const UA_CHROME_FALLBACK = '134.0.0.0';

function chromeFullVersion(): string {
  try {
    return process.versions.chrome || UA_CHROME_FALLBACK;
  } catch {
    return UA_CHROME_FALLBACK;
  }
}

export const CHROME_FULL_VERSION = chromeFullVersion();
export const CHROME_MAJOR_VERSION = CHROME_FULL_VERSION.split('.')[0] || '134';

const platform = (() => {
  try {
    return process.platform;
  } catch {
    return 'linux';
  }
})();

const arch = (() => {
  try {
    return process.arch;
  } catch {
    return 'x64';
  }
})();

interface PlatformProfile {
  /** Full User-Agent header for this OS. */
  ua: string;
  /** `Sec-CH-UA-Platform` value (quoted). */
  chPlatform: string;
  /** `Sec-CH-UA-Platform-Version` value (quoted); empty for Linux. */
  chPlatformVersion: string;
  /** `Sec-CH-UA-Arch` value (quoted) — high entropy, sent only if requested. */
  chArch: string;
}

function buildProfile(): PlatformProfile {
  const v = CHROME_FULL_VERSION;
  if (platform === 'win32') {
    return {
      ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
      chPlatform: '"Windows"',
      // Windows 11 23H2+; the UA already reports NT 10.0 either way.
      chPlatformVersion: '"15.0.0"',
      chArch: arch === 'arm64' ? '"arm"' : '"x86"',
    };
  }
  if (platform === 'darwin') {
    return {
      // Chrome freezes the macOS version in the UA at 10_15_7.
      ua: `Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
      chPlatform: '"macOS"',
      chPlatformVersion: '"14.6.1"',
      chArch: arch === 'arm64' ? '"arm"' : '"x86"',
    };
  }
  return {
    ua: `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${v} Safari/537.36`,
    chPlatform: '"Linux"',
    // Chromium reports an empty platform version on Linux.
    chPlatformVersion: '""',
    chArch: '"x86"',
  };
}

const PROFILE = buildProfile();

/** User-Agent matching the host OS, at the host's real Chromium version. */
export const CHROME_UA = PROFILE.ua;

export const SEC_CH_UA = `"Chromium";v="${CHROME_MAJOR_VERSION}", "Not=A?Brand";v="24", "Google Chrome";v="${CHROME_MAJOR_VERSION}"`;

export const SEC_CH_UA_FULL_VERSION_LIST = `"Chromium";v="${CHROME_FULL_VERSION}", "Not=A?Brand";v="24.0.0.0", "Google Chrome";v="${CHROME_FULL_VERSION}"`;

export const SEC_CH_UA_PLATFORM = PROFILE.chPlatform;


export const UA_OS_LABEL = platform === 'win32' ? 'Windows' : platform === 'darwin' ? 'macOS' : 'Linux';

/** Plausible UA for the platform, for log lines (never contains Electron). */
export const UA_SUMMARY = `${UA_OS_LABEL}/${arch} Chrome ${CHROME_MAJOR_VERSION}`;

function findHeader(headers: Record<string, unknown>, name: string): string | undefined {
  const lower = name.toLowerCase();
  return Object.keys(headers).find((key) => key.toLowerCase() === lower);
}

function setHeader(headers: Record<string, any>, name: string, value: string): void {
  const existing = findHeader(headers, name);
  if (existing) headers[existing] = value;
  else headers[name] = value;
}

function replaceIfPresent(headers: Record<string, any>, name: string, value: string): void {
  const existing = findHeader(headers, name);
  if (existing) headers[existing] = value;
}

function dropHeader(headers: Record<string, any>, name: string): void {
  const existing = findHeader(headers, name);
  if (existing) delete headers[existing];
}

/**
 * Rewrite the identity headers Chromium attaches to a request so that the UA,
 * the client hints and the JS-visible platform all tell the same story.
 *
 * Low-entropy hints are always set (Chrome sends them on every request).
 * High-entropy hints are only corrected when the server asked for them via
 * Accept-CH — injecting them unconditionally would itself be a fingerprint.
 */
export function applyUserAgentHeaders(headers: Record<string, any>): boolean {
  let changed = false;
  const before = (name: string) => findHeader(headers, name);
  const track = (name: string, fn: () => void) => {
    const prev = before(name);
    const prevValue = prev ? headers[prev] : undefined;
    fn();
    const next = before(name);
    const nextValue = next ? headers[next] : undefined;
    if (prevValue !== nextValue) changed = true;
  };

  track('user-agent', () => setHeader(headers, 'User-Agent', CHROME_UA));
  track('sec-ch-ua', () => setHeader(headers, 'sec-ch-ua', SEC_CH_UA));
  track('sec-ch-ua-platform', () => setHeader(headers, 'sec-ch-ua-platform', SEC_CH_UA_PLATFORM));
  track('sec-ch-ua-mobile', () => setHeader(headers, 'sec-ch-ua-mobile', '?0'));

  track('sec-ch-ua-full-version-list', () =>
    replaceIfPresent(headers, 'sec-ch-ua-full-version-list', SEC_CH_UA_FULL_VERSION_LIST));
  track('sec-ch-ua-platform-version', () =>
    replaceIfPresent(headers, 'sec-ch-ua-platform-version', PROFILE.chPlatformVersion));
  track('sec-ch-ua-arch', () => replaceIfPresent(headers, 'sec-ch-ua-arch', PROFILE.chArch));
  track('sec-ch-ua-bitness', () => replaceIfPresent(headers, 'sec-ch-ua-bitness', '"64"'));

  // Desktop Chrome never sends these.
  track('sec-ch-ua-model', () => dropHeader(headers, 'sec-ch-ua-model'));
  track('sec-ch-ua-wow64', () => dropHeader(headers, 'sec-ch-ua-wow64'));

  return changed;
}

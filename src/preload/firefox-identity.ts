// Makes the page-visible navigator look like Firefox. Runs in the page's main
// world (contextBridge.executeInMainWorld), so it must be fully self-contained.
// Used only for third-party sign-in windows; see FIREFOX_UA in shared/user-agent.ts.

export function installFirefoxIdentity(): void {
  'use strict';
  const w = window as unknown as Record<string, any>;
  if (w.__scFirefoxIdentity) return;
  w.__scFirefoxIdentity = true;

  const tryDo = (fn: () => void): void => {
    try { fn(); } catch (e) { /* best-effort */ }
  };

  const navProto = w.Navigator && w.Navigator.prototype;
  if (navProto) {
    // Firefox has no User-Agent Client Hints API at all.
    tryDo(() => { delete navProto.userAgentData; });
    const ua = String(w.navigator.userAgent || '');
    const def = (key: string, value: unknown): void => tryDo(() => {
      Object.defineProperty(navProto, key, { get: () => value, configurable: true, enumerable: true });
    });
    def('vendor', '');
    def('productSub', '20100101');
    const oscpu = /Windows/i.test(ua)
      ? 'Windows NT 10.0; Win64; x64'
      : /Macintosh/i.test(ua)
        ? 'Intel Mac OS X 10.15'
        : 'Linux x86_64';
    def('oscpu', oscpu);
  }
  tryDo(() => { delete w.NavigatorUAData; });
  tryDo(() => { delete w.chrome; });
}

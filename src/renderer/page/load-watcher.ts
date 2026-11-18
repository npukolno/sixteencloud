// Soft-retry an SPA navigation that left the main column showing only a
// spinner. Reacts to URL changes only, never to DOM churn, so it cannot cause
// random reloads. Bundled to dist/renderer/page/load-watcher.js.
import { SC } from '../../shared/sc-selectors';

declare global {
  interface Window { __scLoadWatcher?: boolean }
}

const POLL_MS = 5000;
const STALL_MS = 15000;

function install(): void {
  if (window.__scLoadWatcher) return;
  window.__scLoadWatcher = true;
  let lastUrl = location.href;
  let stallTimer: number | undefined;
  setInterval(() => {
    if (document.hidden || location.href === lastUrl) return;
    lastUrl = location.href;
    window.clearTimeout(stallTimer);
    stallTimer = window.setTimeout(() => {
      const main = document.querySelector(SC.MAIN_CONTENT);
      if (!main) return;
      const onlySpinner = main.querySelectorAll(':scope > *').length <= 2 && main.querySelector('.loading, .sc-loading');
      if (onlySpinner) {
        console.warn('[SixteenCloud] Navigation stalled, soft retry...');
        window.history.replaceState(null, '', location.href);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }
    }, STALL_MS);
  }, POLL_MS);
}

install();

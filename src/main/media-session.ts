import type { BrowserWindow } from 'electron';
import { scJs } from '../shared/sc-selectors';
import { logWarn } from './logger';
import { runInPage } from './page';

/**
 * navigator.mediaSession handlers and metadata, so OS media overlays (and
 * Chromium's own MPRIS on Linux) show the playing track.
 */
export function injectMediaSession(win: BrowserWindow): void {
  runInPage(win, `
    (function() {
      if (window.__scMediaSession || !('mediaSession' in navigator)) return;
      window.__scMediaSession = true;
      var PLAY = ${scJs('PLAY')}, NEXT = ${scJs('NEXT')}, PREV = ${scJs('PREV')};
      function click(sel) { var el = document.querySelector(sel); if (el) el.click(); }
      function playing() { var pc = document.querySelector(PLAY); return !!(pc && pc.classList.contains('playing')); }
      navigator.mediaSession.setActionHandler('play', function() { if (!playing()) click(PLAY); });
      navigator.mediaSession.setActionHandler('pause', function() { if (playing()) click(PLAY); });
      navigator.mediaSession.setActionHandler('nexttrack', function() { click(NEXT); });
      navigator.mediaSession.setActionHandler('previoustrack', function() { click(PREV); });
      navigator.mediaSession.setActionHandler('stop', function() { if (playing()) click(PLAY); });

      var lastTitle = '';
      function updateMetadata() {
        if (document.hidden && lastTitle) return;
        var titleEl = document.querySelector(${scJs('TITLE_LINK')});
        if (!titleEl) return;
        var title = titleEl.getAttribute('title') || titleEl.textContent.trim();
        if (title === lastTitle) return;
        lastTitle = title;
        var artistEl = document.querySelector(${scJs('ARTIST_LINK')});
        var artist = artistEl ? (artistEl.getAttribute('title') || artistEl.textContent.trim()) : '';
        var artEl = document.querySelector(${scJs('AVATAR_ART')});
        var artwork = '';
        if (artEl) {
          var m = (artEl.getAttribute('style') || '').match(/url\\("?([^")]+)"?\\)/);
          if (m) artwork = m[1].replace(/-(?:t\\d+x\\d+|large|small|badge|crop)\\./, '-t500x500.');
        }
        navigator.mediaSession.metadata = new MediaMetadata({
          title: title, artist: artist, album: 'SoundCloud',
          artwork: artwork ? [{ src: artwork, sizes: '500x500', type: 'image/jpeg' }] : []
        });
      }
      setInterval(updateMetadata, 2000);
    })();
  `).catch((e: any) => logWarn('media session inject error:', e?.message));
}

/**
 * Soft-retry an SPA navigation that left .l-main showing only a spinner.
 * Only reacts to URL changes, never to DOM churn, to avoid random reloads.
 */
export function injectSpaLoadWatcher(win: BrowserWindow): void {
  runInPage(win, `
    (function() {
      if (window.__scLoadWatcher) return;
      window.__scLoadWatcher = true;
      var lastUrl = location.href;
      var stallTimer = null;
      setInterval(function() {
        if (document.hidden || location.href === lastUrl) return;
        lastUrl = location.href;
        if (stallTimer) clearTimeout(stallTimer);
        stallTimer = setTimeout(function() {
          var main = document.querySelector(${scJs('MAIN_CONTENT')});
          if (!main) return;
          var children = main.querySelectorAll(':scope > *');
          if (children.length <= 2 && main.querySelector('.loading, .sc-loading')) {
            console.warn('[SixteenCloud] Navigation stalled, soft retry...');
            window.history.replaceState(null, '', location.href);
            window.dispatchEvent(new PopStateEvent('popstate'));
          }
        }, 15000);
      }, 5000);
    })();
  `).catch((e: any) => logWarn('load watcher inject error:', e?.message));
}

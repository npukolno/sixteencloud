import { getScriptTranslations } from '../../shared/i18n';
import { scJs } from '../../shared/sc-selectors';

// Feed reposts (setting player.reposts: show | collapse | hide).
//
// Which feed items are reposts comes from the API, not from DOM labels:
// preload/api-tap.ts records the reposted paths of every /stream page in
// window.__scTracks.reposts and, in "hide" mode, drops them from the
// response before SoundCloud renders it. This script mirrors the setting to
// localStorage (the tap runs before our scripts and reads it from there) and
// folds the matching items in "collapse" mode (and the one placeholder kept
// on an all-repost page in "hide" mode).

export function getRepostsScript(): string {
  const tr = JSON.stringify(getScriptTranslations(['reposts.folded']));
  return `
    (function() {
      if (window.__scReposts) return;
      var api = window.sixteenCloud;
      var _tr = ${tr};
      var ITEM = ${scJs('FEED_ITEM')};
      var TITLE = ${scJs('FEED_ITEM_TITLE')};
      var KEY = 'sc16:reposts';
      var mode = 'show';
      try { mode = localStorage.getItem(KEY) || 'show'; } catch (e) {}

      function onFeed() { return /^\\/(feed|stream)\\/?$/.test(location.pathname); }
      function pathOf(href) {
        try { return new URL(href, location.origin).pathname.replace(/\\/+$/, ''); } catch (e) { return ''; }
      }

      function scan() {
        if (document.hidden || !onFeed()) return;
        var reposts = (window.__scTracks && window.__scTracks.reposts) || {};
        var items = document.querySelectorAll(ITEM);
        for (var i = 0; i < items.length; i++) {
          var item = items[i];
          var link = item.querySelector(TITLE);
          var path = link ? pathOf(link.getAttribute('href') || '') : '';
          var fold = mode !== 'show' && !!path && !!reposts[path];
          if (fold !== item.classList.contains('sc-repost-folded')) {
            item.classList.toggle('sc-repost-folded', fold);
            if (fold) item.setAttribute('data-sc-rp-label', _tr['reposts.folded'] || 'Repost');
          }
        }
      }

      // A folded item opens on click anywhere outside its links and buttons.
      document.addEventListener('click', function(e) {
        var item = e.target && e.target.closest ? e.target.closest('.sc-repost-folded:not(.sc-repost-open)') : null;
        if (!item || (e.target.closest && e.target.closest('a, button'))) return;
        item.classList.add('sc-repost-open');
      }, true);

      function set(next) {
        mode = next === 'hide' || next === 'collapse' ? next : 'show';
        try { localStorage.setItem(KEY, mode); } catch (e) {}
        if (mode === 'show') {
          var folded = document.querySelectorAll('.sc-repost-folded');
          for (var i = 0; i < folded.length; i++) folded[i].classList.remove('sc-repost-folded', 'sc-repost-open');
        } else {
          scan();
        }
      }
      window.__scReposts = { set: set, mode: function() { return mode; } };

      // The store is the source of truth; localStorage is only the copy the
      // API tap can read synchronously at the next feed request.
      if (api && typeof api.storeGet === 'function') {
        api.storeGet('player.reposts').then(function(v) { set(v || 'show'); }).catch(function() {});
      }
      setInterval(scan, 1500);
    })();
  `;
}

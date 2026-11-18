import { getScriptTranslations } from '../../shared/i18n';
import { scJs } from '../../shared/sc-selectors';

// "Download the play queue": reads SoundCloud's Next up list and hands every
// track to the existing download queue (downloadQueueAdd, validated in main).
//
// The Next up panel renders a virtual list, so only the rows on screen are in
// the DOM. The panel is opened if needed, its scroller is walked from top to
// bottom while rows are collected, and everything is put back afterwards.
//
//   window.__scExportQueue() -> Promise<{ found, added }>

export function getQueueExportScript(): string {
  const tr = JSON.stringify(getScriptTranslations([
    'queue.reading', 'queue.added', 'queue.empty', 'queue.failed',
  ]));
  return `
    (function() {
      if (window.__scExportQueue) return;
      var api = window.sixteenCloud;
      var _tr = ${tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) for (var x in p) s = s.replace('{' + x + '}', p[x]); return s; }
      var TOGGLE = ${scJs('QUEUE_TOGGLE')};
      var PANEL = ${scJs('QUEUE_PANEL')};
      var ROW = ${scJs('QUEUE_ITEM')};
      function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }
      function toast(m, kind) { if (window.__scToast) window.__scToast(m, { kind: kind }); }

      function rows() { return document.querySelectorAll(PANEL + ' ' + ROW); }
      function isOpen() {
        var p = document.querySelector(PANEL);
        if (!p) return false;
        var r = p.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && getComputedStyle(p).visibility !== 'hidden';
      }
      function scroller() {
        var p = document.querySelector(PANEL);
        if (!p) return null;
        var all = [p].concat(Array.prototype.slice.call(p.querySelectorAll('*')));
        for (var i = 0; i < all.length; i++) {
          var el = all[i];
          var oy = getComputedStyle(el).overflowY;
          if ((oy === 'auto' || oy === 'scroll') && el.scrollHeight > el.clientHeight + 8) return el;
        }
        return null;
      }

      // Track rows link to /user/track; artist links have a single segment.
      function collect(into) {
        var list = rows(), fresh = 0;
        for (var i = 0; i < list.length; i++) {
          var links = list[i].querySelectorAll('a[href]');
          for (var j = 0; j < links.length; j++) {
            var href = links[j].getAttribute('href') || '';
            var path;
            try { path = new URL(href, location.origin).pathname.replace(/\\/+$/, ''); } catch (e) { continue; }
            var segs = path.split('/').filter(Boolean);
            if (segs.length !== 2 || segs[1] === 'sets' || into.has(path)) continue;
            into.set(path, (links[j].getAttribute('title') || links[j].textContent || '').trim());
            fresh++;
            break;
          }
        }
        return fresh;
      }

      async function readQueue() {
        var opened = false;
        if (!isOpen()) {
          var toggle = document.querySelector(TOGGLE);
          if (!toggle) return [];
          toggle.click();
          opened = true;
          for (var w = 0; w < 20 && !rows().length; w++) await sleep(100);
        }
        var found = new Map();
        try {
          collect(found);
          var sc = scroller();
          if (sc) {
            var start = sc.scrollTop, idle = 0;
            sc.scrollTop = 0;
            await sleep(120);
            for (var n = 0; n < 400 && found.size < 2000; n++) {
              var gained = collect(found);
              var atEnd = sc.scrollTop + sc.clientHeight >= sc.scrollHeight - 2;
              idle = gained ? 0 : idle + 1;
              if (atEnd && idle >= 2) break;
              sc.scrollTop += Math.max(40, sc.clientHeight * 0.8);
              await sleep(90);
            }
            sc.scrollTop = start;
          }
        } finally {
          if (opened) {
            var t2 = document.querySelector(TOGGLE);
            if (t2) t2.click();
          }
        }
        return Array.from(found.entries());
      }

      window.__scExportQueue = async function() {
        if (!api || typeof api.downloadQueueAdd !== 'function') return { found: 0, added: 0 };
        toast(_t('queue.reading'));
        var entries;
        try { entries = await readQueue(); } catch (e) { toast(_t('queue.failed'), 'error'); return { found: 0, added: 0 }; }
        if (!entries.length) { toast(_t('queue.empty'), 'error'); return { found: 0, added: 0 }; }
        var quality = await api.storeGet('downloader.quality').catch(function() { return null; });
        if (quality !== '256' && quality !== 'original') quality = '128';
        var tap = window.__scTracks && window.__scTracks.byPath;
        var added = 0;
        for (var i = 0; i < entries.length; i++) {
          var path = entries[i][0];
          var info = tap ? tap[path] : null;
          var art = info && info.artwork ? String(info.artwork).replace(/-(?:large|t\\d+x\\d+|small|badge|crop)\\./, '-t500x500.') : '';
          try {
            await api.downloadQueueAdd({
              trackUrl: 'https://soundcloud.com' + path,
              trackId: path.replace(/^\\/+/, ''),
              title: ((info && info.title) || entries[i][1] || path.split('/')[2]).slice(0, 500),
              artist: ((info && info.artist) || path.split('/')[1]).slice(0, 500),
              artworkUrl: /^https:\\/\\/[^/]*sndcdn\\.com\\//i.test(art) ? art : '',
              quality: quality
            });
            added++;
          } catch (e) { /* one bad row does not stop the rest */ }
        }
        toast(_t('queue.added', { count: String(added) }), added ? 'success' : 'error');
        return { found: entries.length, added: added };
      };
    })();
  `;
}

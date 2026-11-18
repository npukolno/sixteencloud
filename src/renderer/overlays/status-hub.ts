import { getScriptTranslations } from '../../shared/i18n';

// One place that knows what is "on" right now, for the small live indicators
// (status dots on the left rail, chips in the titlebar):
//
//   window.__scStatus           { eq, geo, sleep, dl }
//   window.__scStatusSet(part, value)  merge + notify
//   'sc16:status' event         fired on document after every change
//
// Panels report user changes through __scStatusSet; the hub reads the stored
// state itself at start, so it never depends on panel load order.

export function getStatusHubScript(): string {
  const tr = JSON.stringify(getScriptTranslations([
    'status.dl_done', 'status.dl_failed', 'status.dl_queue_done', 'status.dl_playlist_done',
  ]));
  return `
    (function() {
      if (window.__scStatusSet) return;
      var api = window.sixteenCloud;
      var _tr = ${tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) for (var x in p) s = s.replace('{' + x + '}', p[x]); return s; }

      var status = window.__scStatus = {
        eq: false,
        geo: { enabled: false, proxy: false, country: '' },
        sleep: { end: 0, track: false },
        dl: { busy: false, done: 0, total: 0, fraction: 0, label: '' }
      };

      function notify(part) {
        renderDots();
        try { document.dispatchEvent(new CustomEvent('sc16:status', { detail: { part: part } })); } catch (e) {}
      }

      window.__scStatusSet = function(part, value) {
        if (!Object.prototype.hasOwnProperty.call(status, part)) return;
        if (value && typeof value === 'object' && !Array.isArray(value)) status[part] = Object.assign({}, status[part], value);
        else status[part] = value;
        notify(part);
      };

      // ---- Rail dots ----
      var DOTS = {
        'equalizer': function() { return status.eq ? 'on' : ''; },
        'geo-bypass': function() { return status.geo.enabled && status.geo.proxy ? 'ok' : ''; },
        'player': function() { return status.sleep.end || status.sleep.track ? 'warn' : ''; },
        'downloader': function() { return status.dl.busy ? 'busy' : ''; }
      };
      function renderDots() {
        var rail = document.getElementById('sc-overlay-rail');
        if (!rail) return;
        Object.keys(DOTS).forEach(function(id) {
          var icon = rail.querySelector('.sc-nav-item[data-target="' + id + '"] .sc-nav-icon');
          if (!icon) return;
          var state = DOTS[id]();
          var dot = icon.querySelector('.sc-nav-dot');
          if (!state) { if (dot) dot.remove(); return; }
          if (!dot) {
            dot = document.createElement('span');
            dot.setAttribute('aria-hidden', 'true');
            icon.appendChild(dot);
          }
          dot.className = 'sc-nav-dot sc-nav-dot-' + state;
        });
      }

      // ---- Initial state from the store ----
      if (api && typeof api.storeGet === 'function') {
        api.storeGet('equalizer').then(function(eq) {
          window.__scStatusSet('eq', !!(eq && eq.enabled));
        }).catch(function() {});
        api.storeGet('geoBypass').then(function(g) {
          if (!g) return;
          window.__scStatusSet('geo', { enabled: !!g.enabled, proxy: !!g.proxyUrl, country: String(g.spoofCountry || '') });
        }).catch(function() {});
      }

      // ---- Downloads ----
      // The queue reports its whole list; finished items stay in it, so a
      // "session" starts when the queue goes from idle to busy.
      var sessionBase = 0, queueBusy = false;
      var single = null;   // { id, percent, at }
      var playlist = null; // { done, total, at }
      var current = 0;     // percent of the item downloading now

      function recompute() {
        var now = Date.now();
        if (single && now - single.at > 120000) single = null;
        if (playlist && now - playlist.at > 300000) playlist = null;
        var dl = { busy: false, done: 0, total: 0, fraction: 0, label: '' };
        if (queueBusy) {
          dl.busy = true;
          dl.done = queueState.finished - sessionBase;
          dl.total = queueState.total - sessionBase;
          dl.fraction = dl.total ? Math.min(1, (dl.done + current / 100) / dl.total) : 0;
          dl.label = dl.done + '/' + dl.total;
        } else if (playlist) {
          dl.busy = true;
          dl.done = playlist.done; dl.total = playlist.total;
          dl.fraction = playlist.total ? playlist.done / playlist.total : 0;
          dl.label = playlist.done + '/' + playlist.total;
        } else if (single) {
          dl.busy = true;
          dl.done = 0; dl.total = 1;
          dl.fraction = single.percent / 100;
          dl.label = Math.round(single.percent) + '%';
        }
        status.dl = dl;
        notify('dl');
      }

      var queueState = { finished: 0, total: 0, ids: {} };
      if (api && typeof api.onDownloadQueueState === 'function') {
        api.onDownloadQueueState(function(state) {
          var items = (state && Array.isArray(state.items)) ? state.items : [];
          var finished = 0, active = 0, ids = {};
          items.forEach(function(it) {
            if (it.status === 'done' || it.status === 'error') finished++;
            else active++;
            if (it.trackId) ids[it.trackId] = true;
          });
          var wasBusy = queueBusy;
          queueBusy = active > 0 && !(state && state.paused && !items.some(function(it) { return it.status === 'downloading'; }));
          if (!wasBusy && active > 0) { sessionBase = finished; current = 0; }
          if (wasBusy && active === 0) {
            var n = finished - sessionBase;
            if (n > 1 && window.__scToast) window.__scToast(_t('status.dl_queue_done', { count: String(n) }), { kind: 'success' });
          }
          queueState = { finished: finished, total: items.length, ids: ids };
          recompute();
        });
      }
      if (api && typeof api.onDownloadProgress === 'function') {
        api.onDownloadProgress(function(p) {
          if (!p || typeof p !== 'object') return;
          var pct = Math.max(0, Math.min(100, Number(p.percent) || 0));
          if (typeof p.playlistTotal === 'number' && p.playlistTotal > 0) {
            playlist = { done: Number(p.playlistCompleted) || 0, total: p.playlistTotal, at: Date.now() };
          } else if (queueBusy && queueState.ids[p.trackId]) {
            current = p.status === 'complete' ? 0 : pct;
          } else if (p.trackId) {
            single = p.status === 'complete' ? null : { id: p.trackId, percent: pct, at: Date.now() };
          }
          recompute();
        });
      }
      if (api && typeof api.onDownloadComplete === 'function') {
        api.onDownloadComplete(function(r) {
          if (!r || typeof r !== 'object') return;
          if (r.playlistDone) {
            playlist = null;
            if (window.__scToast) window.__scToast(_t('status.dl_playlist_done', { count: String(Number(r.total) || 0) }), { kind: 'success' });
          } else if (r.error) {
            if (single && single.id === r.trackId) single = null;
            if (window.__scToast) window.__scToast(_t('status.dl_failed'), { kind: 'error' });
          } else if (r.filePath) {
            if (single && single.id === r.trackId) single = null;
            // A queue of several tracks gets one toast when it drains.
            var queued = queueBusy && queueState.total - sessionBase > 1;
            if (!queued && window.__scToast) window.__scToast(_t('status.dl_done'), { kind: 'success' });
          }
          recompute();
        });
      }

      // Dots are drawn into the rail, which exists by now; draw once more in
      // case the rail was rebuilt after a page reload.
      renderDots();
      setTimeout(renderDots, 1500);
    })();
  `;
}

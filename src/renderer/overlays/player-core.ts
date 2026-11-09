// Shared player plumbing for the in-page features: one watcher that tells the
// others when the track changes, a tiny config object backed by the store,
// the cover/title swap animation and the promoted-track skipper.

export function getPlayerCoreScript(): string {
  return `
    (function() {
      if (window.__scPlayer) return;

      // ---- Config (store key "player"), shared by every player feature ----
      window.__scCfg = { skipPromoted: true, skipPreviews: false, notifications: false, scrobble: false, speed: 1 };
      var api = window.sixteenCloud;
      if (api && typeof api.storeGet === 'function') {
        api.storeGet('player').then(function(p) {
          if (p && typeof p === 'object') Object.keys(p).forEach(function(k) { window.__scCfg[k] = p[k]; });
          if (window.__scOnCfg) window.__scOnCfg();
        }).catch(function() {});
      }
      window.__scCfgSet = function(key, value) {
        window.__scCfg[key] = value;
        if (api && typeof api.storeSet === 'function') api.storeSet('player.' + key, value).catch(function() {});
        if (window.__scOnCfg) window.__scOnCfg(key);
      };

      // ---- Track watcher ----
      var handlers = { track: [] };
      var last = null;
      function q(s) { return document.querySelector(s); }

      function current() {
        var t = q('.playbackSoundBadge__titleLink');
        if (!t) return null;
        var href = t.getAttribute('href') || '';
        if (!href) return null;
        var a = q('.playbackSoundBadge__lightLink');
        return {
          path: href.split('?')[0],
          url: href.charAt(0) === '/' ? 'https://soundcloud.com' + href : href,
          title: (t.getAttribute('title') || t.textContent || '').trim(),
          artist: a ? (a.getAttribute('title') || a.textContent || '').trim() : '',
          artistPath: a ? (a.getAttribute('href') || '') : '',
          artwork: typeof window.__scFindArtwork === 'function' ? window.__scFindArtwork() : null
        };
      }
      function isPlaying() { return !!q('.playControls__play.playing'); }
      function next() { var b = q('.playControls__next'); if (b) { b.click(); return true; } return false; }
      function emit(ev, data) {
        (handlers[ev] || []).forEach(function(h) { try { h(data); } catch (e) {} });
      }

      var style = document.createElement('style');
      style.id = 'sc-track-transition-style';
      style.textContent =
        '@keyframes scCoverIn{from{opacity:0;transform:scale(.86);filter:blur(7px)}to{opacity:1;transform:none;filter:none}}' +
        '@keyframes scTextIn{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}' +
        '@media (prefers-reduced-motion: no-preference){' +
        '.playbackSoundBadge.sc-swap-cover .playbackSoundBadge__avatar .image{animation:scCoverIn .6s cubic-bezier(.2,.8,.2,1) both}' +
        '.playbackSoundBadge.sc-swap .playbackSoundBadge__titleContextContainer{animation:scTextIn .5s cubic-bezier(.2,.8,.2,1) both}' +
        '}';
      (document.head || document.documentElement).appendChild(style);

      function swapAnim() {
        var b = q('.playbackSoundBadge');
        if (!b) return;
        b.classList.remove('sc-swap');
        void b.offsetWidth;
        b.classList.add('sc-swap');
        setTimeout(function() { b.classList.remove('sc-swap'); }, 800);
      }

      // The cover animates only when its image really changes. The title path
      // changes before SoundCloud swaps the artwork (and SoundCloud fades it
      // itself), so animating on the path change played the effect twice.
      var coverUrl = null, coverTimer = 0;
      function coverSrc() {
        var el = q('.playbackSoundBadge__avatar .image') || q('.playbackSoundBadge__avatar span[style*="background-image"]');
        if (!el) return '';
        var m = /url\(['"]?([^'")]+)['"]?\)/.exec(el.getAttribute('style') || '');
        return m ? m[1] : '';
      }
      function coverCheck() {
        var u = coverSrc();
        if (!u || u === coverUrl) return;
        var firstCover = coverUrl === null;
        coverUrl = u;
        if (firstCover) return;
        var b = q('.playbackSoundBadge');
        if (!b) return;
        b.classList.remove('sc-swap-cover');
        void b.offsetWidth;
        b.classList.add('sc-swap-cover');
        clearTimeout(coverTimer);
        coverTimer = setTimeout(function() { b.classList.remove('sc-swap-cover'); }, 800);
      }

      setInterval(function() {
        coverCheck();
        var c = current();
        var key = c ? c.path : '';
        if (key === last || (last === null && !key)) return;
        var first = last === null;
        last = key;
        if (!c) return;
        if (!first) swapAnim();
        c.first = first;
        emit('track', c);
      }, 350);

      window.__scPlayer = {
        current: current,
        isPlaying: isPlaying,
        next: next,
        audio: function() { return window.__scAudioElement || null; },
        on: function(ev, cb) { if (handlers[ev]) handlers[ev].push(cb); }
      };

      // ---- Promoted tracks ----
      // SoundCloud mixes promoted tracks into the queue/autoplay. Two signals:
      // the API tap flags them from the JSON the page loaded, and the player
      // badge itself may carry a "Promoted" label.
      var skips = [];
      var LABEL = /^(promoted|sponsored|реклама|рекламный трек|продвигается|продвигаемый трек|продвигаемое|gesponsert|promocionado|sponsorisé)$/i;

      function domPromo() {
        var root = q('.playbackSoundBadge');
        if (!root) return null;
        if (root.querySelector('[class*="romot" i], [class*="ponsor" i], [class*="dvertis" i]')) return 'badge-class';
        var nodes = root.querySelectorAll('span, div, a, p');
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n.children.length) continue;
          var txt = (n.textContent || '').trim();
          if (txt && txt.length < 30 && LABEL.test(txt)) return 'badge-label';
        }
        return null;
      }

      function reasonFor() {
        var cfg = window.__scCfg || {};
        var c = current();
        if (!c) return null;
        var tap = window.__scTracks;
        var f = tap && tap.flagged ? tap.flagged[c.path] : null;
        if (f === 'promoted' && cfg.skipPromoted) return 'api-promoted';
        if (f === 'preview' && cfg.skipPreviews) return 'api-preview';
        if (cfg.skipPromoted) return domPromo();
        return null;
      }

      window.__scPlayer.on('track', function(c) {
        var done = false;
        [300, 1100, 2500].forEach(function(ms) {
          setTimeout(function() {
            if (done) return;
            var now = current();
            if (!now || now.path !== c.path) { done = true; return; }
            var reason = reasonFor();
            if (!reason) return;
            var t = Date.now();
            skips = skips.filter(function(x) { return t - x < 10000; });
            if (skips.length >= 4) return;
            done = true;
            skips.push(t);
            console.warn('[Promo] skipping (' + reason + '): ' + c.path);
            next();
          }, ms);
        });
      });
    })();
  `;
}

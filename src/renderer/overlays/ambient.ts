import { scJs } from '../../shared/sc-selectors';

// Ambient glow above the bottom player bar, tinted from the cover palette.
// Pure CSS gradients on one fixed layer: no canvas, no animation loop, so it
// stays on in battery saver and when the visualizer is off. It only changes
// on a track change (one palette request per cover) and crossfades through an
// opacity transition, which battery saver turns into an instant swap.
//
// Setting: settings.ambient (default on).

export function getAmbientScript(): string {
  return `
    (function() {
      if (window.__scAmbient) return;
      var api = window.sixteenCloud;
      var BAR = ${scJs('PLAYER_BAR')};
      var enabled = true;
      var layers = [];
      var front = 0;
      var lastUrl = null;
      var seq = 0;

      function parse(hex) {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        var raw = m[1];
        if (raw.length === 3) raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
        var n = parseInt(raw, 16);
        return ((n >> 16) & 255) + ', ' + ((n >> 8) & 255) + ', ' + (n & 255);
      }

      function ensure() {
        if (layers.length && layers[0].isConnected) return;
        layers = [0, 1].map(function() {
          var el = document.createElement('div');
          el.className = 'sc-ambient-layer';
          el.setAttribute('aria-hidden', 'true');
          document.body.appendChild(el);
          return el;
        });
        place();
      }

      // Sit right on top of the player bar, whatever height SoundCloud gives it.
      function place() {
        var bar = document.querySelector(BAR);
        var r = bar ? bar.getBoundingClientRect() : null;
        var bottom = r && r.height ? Math.max(0, window.innerHeight - r.top) : 48;
        layers.forEach(function(el) { el.style.bottom = bottom + 'px'; });
      }

      function currentArtwork() {
        try {
          var cur = window.__scPlayer && window.__scPlayer.current();
          var T = window.__scTracks;
          var info = cur && T && T.byPath && T.byPath[cur.path];
          if (info && info.artwork) return info.artwork.replace(/-(?:large|t\\d+x\\d+|small|badge|crop|original)\\./, '-t500x500.');
        } catch (e) {}
        return typeof window.__scFindArtwork === 'function' ? window.__scFindArtwork() : null;
      }

      // The "ambient" visualizer already paints a cover glow; do not double it.
      function vizCoversIt() {
        try {
          return typeof window.__scVizGetEnabled === 'function' && window.__scVizGetEnabled() &&
            typeof window.__scVizGetType === 'function' && window.__scVizGetType() === 'ambient';
        } catch (e) { return false; }
      }

      function paint(p) {
        ensure();
        var a = parse(p.primary), b = parse(p.secondary) || a, c = parse(p.tertiary) || a;
        if (!a) return;
        var next = layers[1 - front], prev = layers[front];
        next.style.backgroundImage =
          'radial-gradient(60% 140% at 18% 100%, rgba(' + a + ', 0.30), transparent 70%),' +
          'radial-gradient(55% 120% at 55% 100%, rgba(' + c + ', 0.22), transparent 72%),' +
          'radial-gradient(60% 140% at 88% 100%, rgba(' + b + ', 0.26), transparent 70%)';
        next.classList.add('on');
        prev.classList.remove('on');
        front = 1 - front;
      }

      function clear() {
        layers.forEach(function(el) { el.classList.remove('on'); });
      }

      function refresh(force) {
        if (!enabled || vizCoversIt()) { clear(); lastUrl = null; return; }
        var url = currentArtwork();
        if (!url) { clear(); lastUrl = null; return; }
        if (url === lastUrl && !force) return;
        lastUrl = url;
        if (!api || typeof api.getCoverPalette !== 'function') return;
        var my = ++seq;
        api.getCoverPalette(url).then(function(p) {
          if (my !== seq || !enabled) return;
          if (p && p.primary) { place(); paint(p); }
          else lastUrl = null; // retry on the next tick
        }).catch(function() { if (my === seq) lastUrl = null; });
      }

      window.__scAmbient = {
        set: function(on) {
          enabled = on !== false;
          if (enabled) refresh(true); else clear();
        },
        isOn: function() { return enabled; }
      };

      window.addEventListener('resize', function() { if (layers.length) place(); });
      (function hook() {
        if (!window.__scPlayer) { setTimeout(hook, 1000); return; }
        window.__scPlayer.on('track', function() {
          [300, 1200, 3000].forEach(function(ms) { setTimeout(function() { refresh(false); }, ms); });
        });
      })();
      // Cheap safety net for covers that arrive late and for visualizer
      // toggles; refresh() is change-gated, so this does almost nothing.
      setInterval(function() { if (!document.hidden) refresh(false); }, 4000);

      if (api && typeof api.storeGet === 'function') {
        api.storeGet('settings').then(function(s) {
          window.__scAmbient.set(!(s && s.ambient === false));
        }).catch(function() { refresh(true); });
      } else {
        refresh(true);
      }
    })();
  `;
}

// "Accent from cover art": drives the app-wide accent from the playing
// track's cover palette (matugen / cover-accent in the main process) and
// tweens between colours so track changes feel smooth.

export function getDynamicAccentScript(): string {
  return `
    (function() {
      if (window.__scDynAccent) return;
      var api = window.sixteenCloud;
      var enabled = false;
      var baseline = '#ff5500';
      var cur = null;
      var anim = null;
      var lastArt = null;
      var pollTimer = null;

      function parse(hex) {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        var raw = m[1];
        if (raw.length === 3) raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
        var n = parseInt(raw, 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }
      function toHex(rgb) {
        return '#' + rgb.map(function(v) { return ('0' + Math.max(0, Math.min(255, Math.round(v))).toString(16)).slice(-2); }).join('');
      }
      function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), h = 0, s = 0, l = (max + min) / 2;
        if (max !== min) {
          var d = max - min;
          s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
          if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h /= 6;
        }
        return [h, s, l];
      }
      function hslToRgb(h, s, l) {
        function f(p, q, t) {
          if (t < 0) t += 1; if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        }
        if (s === 0) return [l * 255, l * 255, l * 255];
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        return [f(p, q, h + 1 / 3) * 255, f(p, q, h) * 255, f(p, q, h - 1 / 3) * 255];
      }

      // The accent sits on dark surfaces, so keep it readable: a near-black or
      // washed-out cover would otherwise make buttons and links vanish.
      function tune(rgb) {
        var hsl = rgbToHsl(rgb[0], rgb[1], rgb[2]);
        var l = Math.max(0.46, Math.min(0.68, hsl[2]));
        var s = hsl[1] < 0.1 ? hsl[1] : Math.max(0.35, hsl[1]);
        return hslToRgb(hsl[0], s, l);
      }

      function paint(rgb) {
        cur = rgb;
        if (typeof window.scApplyAccent === 'function') window.scApplyAccent(toHex(rgb));
      }
      // Timer-driven instead of requestAnimationFrame: rAF stops while the
      // window is occluded, and the colour must still land on the right value.
      function tweenTo(target) {
        if (anim) clearInterval(anim);
        var from = cur || parse(baseline) || target;
        var t0 = performance.now();
        var dur = 700;
        anim = setInterval(function() {
          var k = Math.min(1, (performance.now() - t0) / dur);
          var e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
          paint([from[0] + (target[0] - from[0]) * e, from[1] + (target[1] - from[1]) * e, from[2] + (target[2] - from[2]) * e]);
          if (k >= 1) { clearInterval(anim); anim = null; }
        }, 16);
      }

      // Where the colour comes from, most reliable first: the playing track's
      // artwork from the API catalogue (independent of whatever the DOM shows,
      // e.g. queue thumbnails inside the player bar), then the page's own cover.
      function currentArtwork() {
        try {
          var cur = window.__scPlayer && window.__scPlayer.current();
          var T = window.__scTracks;
          var info = cur && T && T.byPath && T.byPath[cur.path];
          if (info && info.artwork) return info.artwork.replace(/-(?:large|t\\d+x\\d+|small|badge|crop|original)\\./, '-t500x500.');
        } catch (e) {}
        return typeof window.__scFindArtwork === 'function' ? window.__scFindArtwork() : null;
      }

      var retryTimer = null;
      function requestFor(url) {
        if (!url || url === lastArt || !api || typeof api.getCoverPalette !== 'function') return;
        lastArt = url;
        api.getCoverPalette(url).then(function(p) {
          if (!enabled || url !== lastArt) return;
          var rgb = p && (parse(p.accent) || parse(p.primary));
          if (rgb) { tweenTo(tune(rgb)); return; }
          // No palette (download hiccup): forget the url so the next poll retries.
          if (retryTimer) clearTimeout(retryTimer);
          retryTimer = setTimeout(function() { if (url === lastArt) lastArt = null; }, 1500);
        }).catch(function() { if (url === lastArt) lastArt = null; });
      }

      function poll() {
        if (!enabled) return;
        requestFor(currentArtwork());
      }

      function loadBaseline(cb) {
        if (!api || typeof api.storeGet !== 'function') { cb(); return; }
        api.storeGet('settings').then(function(s) {
          if (s && s.accentColor) baseline = s.accentColor;
          cb(s);
        }).catch(function() { cb(); });
      }

      window.__scDynAccent = {
        set: function(on) {
          enabled = !!on;
          document.documentElement.classList.toggle('sc-dynamic-accent', enabled);
          if (enabled) {
            lastArt = null;
            poll();
            if (!pollTimer) pollTimer = setInterval(poll, 400);
          } else {
            if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
            loadBaseline(function() { var b = parse(baseline); if (b) tweenTo(b); });
          }
        },
        isOn: function() { return enabled; }
      };

      // Re-check right when the track changes instead of waiting for the next tick.
      (function hook() {
        if (!window.__scPlayer) { setTimeout(hook, 1000); return; }
        window.__scPlayer.on('track', function() {
          lastArt = null;
          [0, 250, 900, 2000].forEach(function(ms) { setTimeout(poll, ms); });
        });
      })();

      loadBaseline(function(s) {
        if (s && s.dynamicAccent) window.__scDynAccent.set(true);
      });
    })();
  `;
}

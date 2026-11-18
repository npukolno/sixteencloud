// Player visualizer: spectrum bars in multiple styles. Colours
// come from the current cover art through matugen (main process), with an
// in-page extraction fallback when matugen is absent.

export function getVisualizerScript(): string {
  return `
    (function() {
      if (window.__scVizInstalled) return;
      window.__scVizInstalled = true;

      var IDLE = 0.05;
      var FLOOR = 0.045;
      var MAX_COLS = 256;
      var canvas = null;
      var enabled = true;
      var vizType = 'side'; // VISUALIZER_TYPES in shared/constants.ts
      var raf = 0;
      var lastArtwork = null;
      var lastPoll = 0;
      var hasBar = false;
      var cols = 0;
      var smooth = null;

      var freq = null;
      var activeAnalyser = null;

      function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

      function parseHex(value) {
        var m = String(value || '').trim().match(/^#?([0-9a-f]{6})$/i);
        if (!m) return null;
        var n = parseInt(m[1], 16);
        return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
      }

      function rgbCss(c, alpha) {
        return 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + (alpha == null ? 1 : alpha) + ')';
      }

      function mix(a, b, t) {
        return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
      }

      function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var h = 0, s = 0, l = (max + min) / 2;
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
        function hue(p, q, t) {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        }
        if (s === 0) return [l * 255, l * 255, l * 255];
        var q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        var p = 2 * l - q;
        return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
      }

      // Accent palettes come from the same extraction the desktop bar uses.
      // Use them as-is: a near-neutral cover must stay neutral, not gain a hue
      // from rounding noise. Matugen (M3 tonal ramps) still gets lifted so it
      // stays readable on the dark player bar.
      var paletteSource = 'accent';
      function vivid(c, index) {
        var hsl = rgbToHsl(c[0], c[1], c[2]);
        if (paletteSource !== 'matugen') {
          var lo = index === 2 ? 0.18 : 0.28;
          var hi = index === 2 ? 0.62 : 0.88;
          return hslToRgb(hsl[0], clamp(hsl[1], 0, 1), clamp(hsl[2], lo, hi));
        }
        var sMin = index === 2 ? 0.58 : (index === 1 ? 0.62 : 0.7);
        var mlo = index === 2 ? 0.22 : (index === 1 ? 0.5 : 0.44);
        var mhi = index === 2 ? 0.36 : (index === 1 ? 0.66 : 0.58);
        return hslToRgb(hsl[0], clamp(hsl[1], sMin, 1), clamp(hsl[2], mlo, mhi));
      }

      var accent = parseHex('#ff5500') || [255, 85, 0];
      try {
        var cssAccent = getComputedStyle(document.documentElement).getPropertyValue('--sc-accent').trim();
        var parsedAccent = parseHex(cssAccent);
        if (parsedAccent) accent = parsedAccent;
      } catch (e) {}

      var current = [accent.slice(), mix(accent, [255, 255, 255], 0.18), mix(accent, [255, 255, 255], 0.4)];
      var wanted = [accent.slice(), mix(accent, [255, 255, 255], 0.18), mix(accent, [255, 255, 255], 0.4)];

      function setPalette(p) {
        if (!p) return;
        paletteSource = p.source === 'matugen' ? 'matugen' : 'accent';
        var primary = vivid(parseHex(p.primary) || accent, 0);
        var secondary = vivid(parseHex(p.secondary) || primary, 1);
        var tertiary = vivid(parseHex(p.tertiary) || parseHex(p.accent) || secondary, 2);
        wanted = [primary, secondary, tertiary];
      }

      function isPlaying() {
        var btn = document.querySelector('.playControls__play');
        if (btn) return btn.classList.contains('playing');
        var el = window.__scAudioElement;
        return !!el && !el.paused && !el.ended;
      }

      function playerBar() {
        return document.querySelector('.playControls');
      }

      // SoundCloud's own Web Audio tap is live while the stream plays; the
      // captureStream tap can stay silent depending on how the element is
      // routed. Prefer whichever analyser actually carries signal.
      function pickAnalyser() {
        var primary = window.__scAudioAnalyser;
        var tap = window.__scVizAnalyser;
        if (primary) {
          try {
            var f = new Uint8Array(primary.frequencyBinCount);
            primary.getByteFrequencyData(f);
            for (var i = 0; i < f.length; i++) if (f[i] > 2) return primary;
          } catch (e) {}
        }
        return tap || primary || null;
      }

      function gradient(ctx, x0, y0, x1, y1) {
        var g = ctx.createLinearGradient(x0, y0, x1, y1);
        g.addColorStop(0, rgbCss(current[0], 1));
        g.addColorStop(0.55, rgbCss(current[1], 0.96));
        g.addColorStop(1, rgbCss(current[2], 0.82));
        return g;
      }

      // Levels survive a column-count change (the progress track's width eases
      // while a track plays): carry the old values across instead of zeroing
      // them, so the wave never collapses and re-rises.
      function resample(prev, len) {
        var out = new Float32Array(len);
        if (!prev || !prev.length) return out;
        var last = prev.length - 1;
        for (var i = 0; i < len; i++) {
          var j = Math.round(i * last / Math.max(1, len - 1));
          out[i] = prev[j] || 0;
        }
        return out;
      }

      function progressFraction() {
        // Prefer the live media clock: it is the exact playhead, while the
        // native bar's width is a rounded percentage SoundCloud writes on its
        // own schedule.
        var au = window.__scAudioElement;
        if (au && isFinite(au.duration) && au.duration > 0) {
          return clamp(au.currentTime / au.duration, 0, 1);
        }
        var bar = document.querySelector('.playbackTimeline__progressBar');
        if (bar) {
          var m = /([\\d.]+)%/.exec(bar.style.width || '');
          if (m) return clamp(parseFloat(m[1]) / 100, 0, 1);
        }
        var handle = document.querySelector('.playbackTimeline__progressHandle');
        if (handle) {
          var hm = /([\\d.]+)%/.exec(handle.style.left || '');
          if (hm) return clamp(parseFloat(hm[1]) / 100, 0, 1);
        }
        var wrap = document.querySelector('.playbackTimeline__progressWrapper');
        if (wrap) {
          var v = parseFloat(wrap.getAttribute('aria-valuenow') || '');
          if (!isNaN(v)) return clamp(v / 100, 0, 1);
        }
        return 0;
      }

      // SoundCloud art lives in a few shapes; take the largest square-ish URL.
      function findArtwork() {
        var badge = document.querySelector('.playbackSoundBadge__artwork, .playbackSoundBadge__avatar, .mini-player__artwork, .playbackSoundBadge__artworkImage');
        var candidates = [];
        if (badge && badge.tagName === 'IMG' && badge.src) candidates.push(badge.src);
        var imgs = document.querySelectorAll('.playControls img, .playbackSoundBadge img, .mini-player img');
        for (var i = 0; i < imgs.length; i++) {
          var src = imgs[i].currentSrc || imgs[i].src;
          if (src && src.indexOf('sndcdn') !== -1) candidates.push(src);
        }
        var cover = document.querySelector('.playControls [style*="background-image"], .playbackSoundBadge [style*="background-image"]');
        if (cover) {
          var m = /url\\(['"]?(https:[^'")]+)['"]?\\)/.exec(cover.getAttribute('style') || '');
          if (m) candidates.push(m[1]);
        }
        if (!candidates.length) return null;
        function score(url) {
          var m = /-(t|small|large|original|badge|crop)?(\\d+x\\d+)?\\.(jpg|png|webp)/.exec(url);
          var size = m && m[2] ? parseInt(m[2], 10) : 0;
          return size || (url.indexOf('original') !== -1 ? 500 : 200);
        }
        candidates.sort(function(a, b) { return score(b) - score(a); });
        return candidates[0].replace(/-(t\\d+x\\d+|small|badge|crop)\\./, '-original.');
      }

      // Fallback when matugen is unavailable: sample the cover in-page. Fails
      // silently on CORS-tainted images, in which case --sc-accent stays.
      function extractFromImage(url) {
        try {
          var img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = function() {
            try {
              var c = document.createElement('canvas');
              c.width = 32; c.height = 32;
              var ictx = c.getContext('2d');
              ictx.drawImage(img, 0, 0, 32, 32);
              var data = ictx.getImageData(0, 0, 32, 32).data;
              var bins = [];
              for (var b = 0; b < 12; b++) bins.push([0, 0, 0, 0]);
              for (var i = 0; i < data.length; i += 4) {
                var r = data[i], g = data[i + 1], bl = data[i + 2], a = data[i + 3];
                if (a < 40) continue;
                var h = rgbToHsl(r, g, bl);
                if (h[1] < 0.16 || h[2] < 0.14 || h[2] > 0.92) continue;
                var idx = Math.min(11, Math.floor(h[0] * 12));
                bins[idx][0] += r; bins[idx][1] += g; bins[idx][2] += bl; bins[idx][3] += 1;
              }
              var best = null;
              for (var k = 0; k < bins.length; k++) {
                if (!bins[k][3]) continue;
                if (!best || bins[k][3] > best[3]) best = bins[k];
              }
              if (!best) return;
              var base = [best[0] / best[3], best[1] / best[3], best[2] / best[3]];
              wanted = [vivid(base, 0), vivid(mix(base, [255, 255, 255], 0.25), 1), vivid(base, 2)];
            } catch (e) {}
          };
          img.src = url;
        } catch (e) {}
      }

      function requestPalette(url) {
        if (!url || url === lastArtwork) return;
        lastArtwork = url;
        var api = window.sixteenCloud;
        if (api && typeof api.getCoverPalette === 'function') {
          api.getCoverPalette(url).then(function(p) {
            if (p && p.primary) setPalette(p);
            else extractFromImage(url);
          }).catch(function() { extractFromImage(url); });
        } else {
          extractFromImage(url);
        }
      }

      window.__scFindArtwork = findArtwork;

      function ensureCanvas() {
        if (canvas && canvas.isConnected) return true;
        canvas = document.createElement('canvas');
        canvas.id = 'sc-visualizer-canvas';
        canvas.setAttribute('aria-hidden', 'true');
        canvas.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99998;opacity:0;transition:opacity .45s ease;';
        (document.body || document.documentElement).appendChild(canvas);
        return true;
      }

      // Bars are read left→right as bass→treble: the whole spectrum spread
      // over the whole width, so the strip is never empty at the edges.
      function spectrumTargets(now) {
        if (!target || target.length < cols) target = new Float32Array(Math.max(MAX_COLS, cols));
        var analyser = activeAnalyser || window.__scVizAnalyser || window.__scAudioAnalyser;
        var live = false;
        if (analyser) {
          if (!freq || freq.length !== analyser.frequencyBinCount) {
            freq = new Uint8Array(analyser.frequencyBinCount);
          }
          analyser.getByteFrequencyData(freq);
          var bins = freq.length;
          // ~46% of the spectrum is where music actually lives: above that
          // (12kHz+) every bin reads zero and the right-hand bars would sit
          // frozen at the floor.
          var usable = Math.max(8, Math.floor(bins * 0.46));
          var peak = 0;
          for (var j = 0; j < cols; j++) {
            var t = cols > 1 ? j / (cols - 1) : 0;
            var bin = Math.min(bins - 1, Math.floor(Math.pow(t, 1.55) * usable));
            var v = freq[bin] / 255;
            v = Math.pow(v, 1.2) * 0.96;
            target[j] = clamp(v, 0, 1);
            if (v > peak) peak = v;
          }
          live = peak > 0.02;
        } else {
          for (var k = 0; k < cols; k++) target[k] = 0;
        }

        if (!live) {
          for (var i = 0; i < cols; i++) {
            var d = cols > 1 ? i / (cols - 1) : 0;
            var trough = 0.4 + 0.6 * Math.abs(Math.sin(d * Math.PI * 3.2));
            var breathe = 0.6 + 0.4 * Math.sin(now / 1400 - d * 5.5);
            target[i] = IDLE * trough * breathe;
          }
        } else {
          // Never let a bar sit dead still while the track plays.
          for (var n = 0; n < cols; n++) {
            var nd = cols > 1 ? n / (cols - 1) : 0;
            var hum = FLOOR * (0.5 + 0.5 * Math.sin(now / 900 - nd * 7));
            if (target[n] < hum) target[n] = hum;
          }
        }
      }

      var target = new Float32Array(MAX_COLS);

      function smoothLevels() {
        for (var i = 0; i < cols; i++) {
          var goal = target[i];
          var rate = goal > smooth[i] ? 0.5 : 0.12;
          smooth[i] += (goal - smooth[i]) * rate;
        }
      }

      var glowBass = 0;
      var prevLow = null;
      var fluxPeak = 0.02;
      var kickLevel = 0;
      var glowActive = false;
      var glowLayer = null;
      var waveCanvas = null;
      var waveNativeStyled = false;
      var waveColorKey = '';

      // Free space beside SoundCloud's own controls in the player bar. Side
      // groups go there when it is wide enough; otherwise they sit just above
      // the bar instead of covering the buttons.
      function gutterFit(W) {
        var margin = clamp(W * 0.012, 6, 20);
        var el = document.querySelector('.playControls__elements');
        if (!el) return { inBar: W >= 1100, margin: margin, groupW: clamp(W * 0.22, 70, 230) };
        var r = el.getBoundingClientRect();
        var room = Math.min(r.left, W - r.right) - margin * 2;
        if (room < 56) return { inBar: false, margin: margin, groupW: clamp(W * 0.22, 70, 230) };
        return { inBar: true, margin: margin, groupW: Math.min(230, room) };
      }

      function drawSide(now) {
        if (!ensureCanvas()) return;
        var bar = playerBar();
        if (!bar) { canvas.style.opacity = '0'; return; }

        var barRect = bar.getBoundingClientRect();
        var W = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
        var fit = gutterFit(W);
        var narrow = !fit.inBar;
        var H = narrow ? 32 : barRect.height;
        var dpr = Math.min(2, window.devicePixelRatio || 1);

        if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          canvas.style.width = W + 'px';
          canvas.style.height = H + 'px';
        }

        // Without free gutters beside the controls, lift the bars just above
        // the bar instead of drawing over the buttons.
        canvas.style.top = (narrow ? Math.max(0, barRect.top - H - 4) : barRect.top) + 'px';
        canvas.style.left = '0';
        canvas.style.transform = '';

        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var nb = 14;
        cols = nb;
        if (!smooth || smooth.length !== cols) smooth = new Float32Array(cols);

        spectrumTargets(now);
        smoothLevels();

        for (var c = 0; c < 3; c++) {
          for (var ch = 0; ch < 3; ch++) current[c][ch] += (wanted[c][ch] - current[c][ch]) * 0.07;
        }

        var grad = gradient(ctx, 0, 0, 0, H);

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = grad;

        // Scale to the free space beside the controls: bars never cover the
        // buttons, crowd the centre or clip at the edges.
        var margin = fit.margin;
        var groupW = fit.groupW;
        var unit = groupW / (nb * 2);
        var gap = Math.max(2, unit * 0.45);
        var bw = Math.max(2, Math.min(6, unit - gap));
        var mh = narrow ? H - 6 : Math.max(6, H - 20);
        var base = narrow ? H : H - Math.max(6, H * 0.16);
        for (var j = 0; j < nb; j++) {
          var hh = 3 + smooth[j] * mh;
          var x = margin + j * (bw + gap);
          ctx.beginPath();
          ctx.roundRect(x, base - hh, bw, hh, 2);
          ctx.fill();

          var rx = W - margin - bw - j * (bw + gap);
          ctx.beginPath();
          ctx.roundRect(rx, base - hh, bw, hh, 2);
          ctx.fill();
        }

        canvas.style.opacity = '1';
      }

      function drawAbove(now) {
        if (!ensureCanvas()) return;
        var bar = playerBar();
        if (!bar) { canvas.style.opacity = '0'; return; }

        var barRect = bar.getBoundingClientRect();
        var W = 160;
        var H = 40;
        var dpr = Math.min(2, window.devicePixelRatio || 1);

        if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          canvas.style.width = W + 'px';
          canvas.style.height = H + 'px';
        }

        canvas.style.top = (barRect.top - H - 8) + 'px';
        canvas.style.left = '50%';
        canvas.style.transform = 'translateX(-50%)';

        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var half = 9;
        cols = half;
        if (!smooth || smooth.length !== cols) smooth = new Float32Array(cols);

        spectrumTargets(now);
        smoothLevels();

        for (var c = 0; c < 3; c++) {
          for (var ch = 0; ch < 3; ch++) current[c][ch] += (wanted[c][ch] - current[c][ch]) * 0.07;
        }

        var grad = gradient(ctx, 0, 0, 0, H);

        ctx.clearRect(0, 0, W, H);
        ctx.fillStyle = grad;

        var bw = 3, gap = 2, mh = 30, base = H, cx = W / 2;
        for (var k = 0; k < half; k++) {
          var hh = 3 + smooth[k] * mh;
          ctx.beginPath();
          ctx.roundRect(cx + gap / 2 + k * (bw + gap), base - hh, bw, hh, 1.5);
          ctx.fill();
          ctx.beginPath();
          ctx.roundRect(cx - gap / 2 - bw - k * (bw + gap), base - hh, bw, hh, 1.5);
          ctx.fill();
        }

        canvas.style.opacity = '1';
      }

      // SoundCloud paints its own played bar and handle in brand orange. While
      // the wave is up we repaint the bar with the palette gradient, hide the
      // handle visually (it stays hit-testable for dragging) and draw the
      // playhead dot ourselves, so no orange peeks through the bars.
      function styleWaveNative() {
        var bar = document.querySelector('.playbackTimeline__progressBar');
        var handle = document.querySelector('.playbackTimeline__progressHandle');
        var grad = 'linear-gradient(90deg,' + rgbCss(wanted[0], 1) + ',' + rgbCss(wanted[1], 1) + ',' + rgbCss(wanted[2], 0.9) + ')';
        if (grad !== waveColorKey) {
          waveColorKey = grad;
          if (bar) bar.style.background = grad;
        }
        if (handle) handle.style.opacity = '0';
        waveNativeStyled = true;
      }

      function restoreWaveNative() {
        if (!waveNativeStyled) return;
        waveNativeStyled = false;
        waveColorKey = '';
        var bar = document.querySelector('.playbackTimeline__progressBar');
        var handle = document.querySelector('.playbackTimeline__progressHandle');
        if (bar) bar.style.background = '';
        if (handle) handle.style.opacity = '';
      }

      function drawWave(now) {
        var timeline = document.querySelector('.playbackTimeline__progressWrapper');
        if (!timeline) return;

        if (!waveCanvas || !waveCanvas.parentElement) {
          waveCanvas = document.createElement('canvas');
          waveCanvas.id = 'sc-visualizer-wave';
          waveCanvas.setAttribute('aria-hidden', 'true');
          waveCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;pointer-events:none;z-index:2;opacity:1;transition:opacity .45s ease;';
          if (getComputedStyle(timeline).position === 'static') timeline.style.position = 'relative';
          timeline.appendChild(waveCanvas);
        }

        var r = timeline.getBoundingClientRect();
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        var h = Math.max(10, r.height);
        // The wrapper's width eases by a pixel or two every time a time label
        // changes. Drawing into a 4px-quantised box keeps the bitmap from being
        // reallocated (and the whole pattern re-mapped) on those sub-pixel
        // changes; the CSS 100% stretch absorbs the remainder.
        var wq = Math.max(32, Math.round(r.width / 4) * 4);

        var bw = Math.round(wq * dpr);
        var bh = Math.round(h * dpr);
        if (waveCanvas.width !== bw || waveCanvas.height !== bh) {
          waveCanvas.width = bw;
          waveCanvas.height = bh;
        }

        var ctx = waveCanvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var step = 3;
        var n = Math.floor(wq / step);
        if (n < 3) return;

        if (!smooth || smooth.length !== n) smooth = resample(smooth, n);
        cols = n;

        spectrumTargets(now);
        smoothLevels();

        for (var c = 0; c < 3; c++) {
          for (var ch = 0; ch < 3; ch++) current[c][ch] += (wanted[c][ch] - current[c][ch]) * 0.07;
        }

        ctx.clearRect(0, 0, wq, h);

        var prog = progressFraction();
        var cy = h / 2;
        var playedGrad = gradient(ctx, 0, 0, wq, 0);
        for (var i = 0; i < n; i++) {
          var u = i / (n - 1);
          var v = smooth[i] || 0;
          var pl = u < prog;
          var hh = Math.min(h, pl ? 3 + v * 18 : 2 + v * 7);
          ctx.fillStyle = pl ? playedGrad : 'rgba(255,255,255,0.28)';
          ctx.beginPath();
          ctx.roundRect(i * step, cy - hh / 2, 2, hh, 1);
          ctx.fill();
        }

        ctx.fillStyle = rgbCss(current[0], 1);
        ctx.beginPath();
        ctx.arc(prog * wq, cy, 5, 0, 6.2832);
        ctx.fill();

        styleWaveNative();
        waveCanvas.style.opacity = '1';
      }

      function ensureGlowLayer() {
        if (glowLayer && glowLayer.isConnected) return glowLayer;
        glowLayer = document.createElement('div');
        glowLayer.id = 'sc-visualizer-glow';
        glowLayer.setAttribute('aria-hidden', 'true');
        glowLayer.style.cssText = 'position:fixed;pointer-events:none;z-index:99997;border-radius:8px;opacity:0;transition:opacity .45s ease;will-change:opacity,transform;';
        (document.body || document.documentElement).appendChild(glowLayer);
        return glowLayer;
      }

      // Kick detector shared by the cover glow, the window edge glow and the
      // lyrics ring: 0..1, jumps on every knock and decays smoothly.
      function bassPulse() {
        var analyser = activeAnalyser || window.__scAudioAnalyser || window.__scVizAnalyser;
        var bass = 0;
        if (analyser) {
          if (!freq || freq.length !== analyser.frequencyBinCount) {
            freq = new Uint8Array(analyser.frequencyBinCount);
          }
          analyser.getByteFrequencyData(freq);
          var b8 = 0;
          for (var k2 = 0; k2 < 8; k2++) b8 += freq[k2];
          var raw8 = (b8 / 8) / 255;
          // Kicks on dense masters keep the low end pinned near the ceiling,
          // so level deviation reads as zero; spectral flux (how much the low
          // band rose since the previous frame) still marks every knock.
          var lowN = Math.min(10, freq.length);
          if (!prevLow || prevLow.length !== lowN) prevLow = new Float32Array(lowN);
          var flux = 0;
          for (var k3 = 0; k3 < lowN; k3++) {
            var diff = freq[k3] - prevLow[k3];
            if (diff > 0) flux += diff;
            prevLow[k3] = freq[k3];
          }
          flux /= lowN * 255;
          fluxPeak = Math.max(0.02, fluxPeak * 0.99, flux);
          var kick = clamp(flux / (fluxPeak * 0.75), 0, 1);
          if (kick > kickLevel) kickLevel += (kick - kickLevel) * 0.8;
          else kickLevel += (kick - kickLevel) * 0.14;
          // Wall-of-bass tracks still get a living base glow.
          var base = clamp((raw8 - 0.1) * 0.95, 0, 0.6);
          bass = clamp(base * 0.5 + kickLevel * 0.75, 0, 1);
        }
        glowBass = bass;
        return bass;
      }

      function easePalette() {
        for (var c = 0; c < 3; c++) {
          for (var ch = 0; ch < 3; ch++) current[c][ch] += (wanted[c][ch] - current[c][ch]) * 0.07;
        }
      }

      // One kick reading per frame: the detector compares against the previous
      // call, so a second caller in the same frame would only ever see zero.
      var pulseAt = -1;
      var pulseValue = 0;
      function framePulse(now) {
        if (pulseAt !== now) { pulseAt = now; pulseValue = bassPulse(); }
        return pulseValue;
      }

      function drawGlow(now) {
        framePulse(now);

        for (var c = 0; c < 3; c++) {
          for (var ch = 0; ch < 3; ch++) current[c][ch] += (wanted[c][ch] - current[c][ch]) * 0.07;
        }

        var covers = document.querySelectorAll('.playbackSoundBadge__artwork, .playbackSoundBadge__avatar, .mini-player__artwork');
        var pulse = clamp(glowBass, 0, 1);
        var col = current[0];
        var layer = ensureGlowLayer();
        var placed = false;

        for (var i = 0; i < covers.length; i++) {
          var el = covers[i];
          // getBoundingClientRect includes the scale written on the previous
          // frame; feeding it back and scaling again made the halo lurch
          // against the cover. Take the center and rebuild the unscaled box.
          var rect = el.getBoundingClientRect();
          if (rect.width < 4 || rect.height < 4) continue;
          var cx = rect.left + rect.width / 2;
          var cy = rect.top + rect.height / 2;
          var bw = el.offsetWidth || rect.width / (1 + pulse * 0.12);
          var bh = el.offsetHeight || rect.height / (1 + pulse * 0.12);

          // Scale the outer element, never an inner img: the rounded clip and
          // outline live on the wrapper, and scaling a child overflows it with
          // square edges.
          el.style.transformOrigin = 'center';
          el.style.transition = 'none';
          el.style.willChange = 'transform';
          el.style.transform = 'scale(' + (1 + pulse * 0.12) + ')';

          if (!placed) {
            placed = true;
            var radiusEl = el.querySelector('.image') || el;
            var br = getComputedStyle(radiusEl).borderRadius;
            layer.style.borderRadius = (br && br !== '0px') ? br : '8px';
            layer.style.left = (cx - bw / 2) + 'px';
            layer.style.top = (cy - bh / 2) + 'px';
            layer.style.width = bw + 'px';
            layer.style.height = bh + 'px';
          }
        }

        if (!placed) {
          layer.style.opacity = '0';
          return;
        }

        // The halo is its own fixed layer: theme CSS repaints the player bar
        // (and sometimes clips its children), so a box-shadow on the avatar
        // survives only on the default theme. This layer sits above the app
        // content but below the visualizer canvas. Same scale as the cover and
        // the cover's own corner radius: a mismatched shape reads as edges.
        layer.style.opacity = '1';
        layer.style.transform = 'scale(' + (1 + pulse * 0.12) + ')';
        layer.style.boxShadow = '0 0 ' + Math.round(14 + pulse * 28) + 'px ' + Math.round(2 + pulse * 12) + 'px ' + rgbCss(col, 0.3 + pulse * 0.65) + ', 0 0 ' + Math.round(4 + pulse * 12) + 'px ' + rgbCss(col, 0.5);
        glowActive = true;
      }

      function clearGlow(fade) {
        if (glowLayer) {
          glowLayer.style.transition = fade ? 'opacity .45s ease' : '';
          glowLayer.style.opacity = '0';
          glowLayer.style.transform = '';
          if (!fade) glowLayer.style.boxShadow = '';
        }
        var covers = document.querySelectorAll('.playbackSoundBadge__artwork, .playbackSoundBadge__avatar, .mini-player__artwork');
        for (var i = 0; i < covers.length; i++) {
          var el = covers[i];
          if (fade) el.style.transition = 'transform .45s ease';
          el.style.transform = '';
          el.style.willChange = '';
          if (!fade) el.style.transition = '';
        }
        glowActive = false;
      }


      // ---- Oscilloscope: the waveform itself, a glowing line on the bar edge ----
      var scopeBuf = null;
      var scopePeak = 0.05;
      var scopeY = null;
      // The shared analysers hold 5-10 ms of audio, less than one bass cycle,
      // so no trigger can hold the wave still. Branch a long-window analyser
      // off whichever one carries the signal (an analyser passes audio through
      // unchanged; the branch ends in a muted gain, so nothing is doubled).
      var scopeTaps = typeof WeakMap === 'function' ? new WeakMap() : null;
      function scopeAnalyserFor(base) {
        if (!base || !base.context || !scopeTaps) return base;
        var tap = scopeTaps.get(base);
        if (tap) return tap;
        try {
          var actx = base.context;
          tap = actx.createAnalyser();
          tap.fftSize = 2048;
          tap.smoothingTimeConstant = 0;
          base.connect(tap);
          var mute = actx.createGain();
          mute.gain.value = 0;
          tap.connect(mute);
          mute.connect(actx.destination);
          scopeTaps.set(base, tap);
          return tap;
        } catch (e) {
          return base;
        }
      }
      function drawScope(now) {
        if (!ensureCanvas()) return;
        var bar = playerBar();
        if (!bar) { canvas.style.opacity = '0'; return; }
        var barRect = bar.getBoundingClientRect();
        var W = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
        var H = 30;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          canvas.style.width = W + 'px';
          canvas.style.height = H + 'px';
        }
        // Centred on the top edge of the player bar.
        canvas.style.top = (barRect.top - H / 2) + 'px';
        canvas.style.left = '0';
        canvas.style.transform = '';
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        easePalette();

        var analyser = scopeAnalyserFor(activeAnalyser || window.__scAudioAnalyser || window.__scVizAnalyser);
        var n = 0;
        if (analyser && typeof analyser.getFloatTimeDomainData === 'function') {
          if (!scopeBuf || scopeBuf.length !== analyser.fftSize) scopeBuf = new Float32Array(analyser.fftSize);
          analyser.getFloatTimeDomainData(scopeBuf);
          n = scopeBuf.length;
        }
        var maxAbs = 0;
        for (var i = 0; i < n; i++) { var a = Math.abs(scopeBuf[i]); if (a > maxAbs) maxAbs = a; }
        // Auto gain, eased both ways: quiet and loud masters fill the strip
        // without the line pumping on every peak. The analyser sits after
        // SoundCloud's volume, so levels can be tiny.
        var goal = Math.max(0.003, maxAbs);
        scopePeak += (goal - scopePeak) * (goal > scopePeak ? 0.12 : 0.02);
        var amp = (H / 2 - 3) * 0.9 / Math.max(0.003, scopePeak);
        var live = maxAbs > 0.0015;
        var cy = H / 2;

        // Trigger like a real scope: start every frame at the first rising zero
        // crossing, so the wave stands still instead of jumping phase. Cross on
        // a smoothed copy (~2 ms average, i.e. the bass line): hi-hats and
        // synths cross zero all the time and would pull the trigger around.
        var span = Math.max(16, Math.floor(n / 2));
        var start = 0;
        if (live) {
          var TRIG_W = Math.min(96, Math.floor(n / 8));
          var accT = 0, prevAvg = 0;
          for (var z = 0; z < n - span; z++) {
            accT += scopeBuf[z];
            if (z >= TRIG_W) accT -= scopeBuf[z - TRIG_W];
            var avg = accT / Math.min(z + 1, TRIG_W);
            if (z > TRIG_W && prevAvg < 0 && avg >= 0) { start = z - (TRIG_W >> 1); break; }
            prevAvg = avg;
          }
        }
        var points = Math.max(32, Math.min(span, Math.floor(W / 4)));
        if (!scopeY || scopeY.length !== points) {
          scopeY = new Float32Array(points);
          for (var q = 0; q < points; q++) scopeY[q] = cy;
        }
        for (var pi = 0; pi < points; pi++) {
          var ty;
          if (live) {
            // Average a few neighbouring samples: smoother line, no aliasing.
            var f = start + (pi / (points - 1)) * (span - 1);
            var i0 = Math.max(0, Math.floor(f) - 1), i1 = Math.min(n - 1, i0 + 2);
            var acc = 0;
            for (var si = i0; si <= i1; si++) acc += scopeBuf[si];
            ty = cy - (acc / (i1 - i0 + 1)) * amp;
          } else {
            ty = cy + Math.sin(pi / (points - 1) * 18 + now / 600) * 1.2;
          }
          ty = clamp(ty, 2, H - 2);
          // Ease towards the new frame: no flicker between frames.
          scopeY[pi] += (ty - scopeY[pi]) * 0.45;
        }

        ctx.clearRect(0, 0, W, H);
        var grad = ctx.createLinearGradient(0, 0, W, 0);
        // Lifted towards white: a dark cover palette must still read as a line.
        var c0 = mix(current[0], [255, 255, 255], 0.3), c1 = mix(current[1], [255, 255, 255], 0.3), c2 = mix(current[2], [255, 255, 255], 0.3);
        grad.addColorStop(0, rgbCss(c0, 0));
        grad.addColorStop(0.08, rgbCss(c0, 1));
        grad.addColorStop(0.5, rgbCss(c1, 1));
        grad.addColorStop(0.92, rgbCss(c2, 1));
        grad.addColorStop(1, rgbCss(c2, 0));

        // Curves through segment midpoints: a smooth trace, no sharp corners.
        ctx.beginPath();
        var step = W / (points - 1);
        ctx.moveTo(0, scopeY[0]);
        for (var p = 1; p < points - 1; p++) {
          ctx.quadraticCurveTo(p * step, scopeY[p], (p + 0.5) * step, (scopeY[p] + scopeY[p + 1]) / 2);
        }
        ctx.lineTo(W, scopeY[points - 1]);
        ctx.lineJoin = 'round';
        ctx.lineCap = 'round';
        ctx.strokeStyle = grad;
        ctx.globalAlpha = 0.25;
        ctx.lineWidth = 7;
        ctx.stroke();
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2;
        ctx.stroke();
        canvas.style.opacity = '1';
      }

      // ---- Window edge glow: cover colours around the window, pulsing ----
      // Only opacity changes per frame (compositor work); the inset shadows are
      // rewritten when the palette colour actually moves.
      var ambientRoot = null;
      var ambientBase = null;
      var ambientKick = null;
      var ambientColorKey = '';
      var ambientColorAt = 0;
      var ambientLevel = 0;
      var ambientFlare = 0;
      var ambientLast = 0;
      function ensureAmbient() {
        if (ambientRoot && ambientRoot.isConnected) return ambientRoot;
        ambientRoot = document.createElement('div');
        ambientRoot.id = 'sc-visualizer-ambient';
        ambientRoot.setAttribute('aria-hidden', 'true');
        ambientRoot.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:99996;opacity:0;transition:opacity .45s ease;';
        ambientBase = document.createElement('div');
        ambientKick = document.createElement('div');
        [ambientBase, ambientKick].forEach(function(el) {
          el.style.cssText = 'position:absolute;inset:0;opacity:0;will-change:opacity;';
          ambientRoot.appendChild(el);
        });
        (document.body || document.documentElement).appendChild(ambientRoot);
        return ambientRoot;
      }
      function drawAmbient(now) {
        var root = ensureAmbient();
        easePalette();
        var bass = framePulse(now);
        // Overall loudness from the spectrum, slowly smoothed.
        var analyser = activeAnalyser || window.__scAudioAnalyser || window.__scVizAnalyser;
        var level = 0;
        if (analyser && freq && freq.length) {
          var sum = 0, m = Math.max(8, Math.floor(freq.length * 0.46));
          for (var i = 0; i < m; i++) sum += freq[i];
          level = sum / (m * 255);
        }
        // Time-based easing: the same feel at 30, 60 or 144 fps.
        var adt = ambientLast ? Math.min(100, now - ambientLast) : 16;
        ambientLast = now;
        ambientLevel += (level - ambientLevel) * (1 - Math.exp(-adt / 300));

        if (now - ambientColorAt > 250) {
          ambientColorAt = now;
          var key = current.map(function(c) { return [c[0] >> 3, c[1] >> 3, c[2] >> 3].join(','); }).join('|');
          if (key !== ambientColorKey) {
            ambientColorKey = key;
            // A thin rim, not a frame: it should sit at the edge of vision.
            ambientBase.style.boxShadow = 'inset 0 0 80px 8px ' + rgbCss(current[0], 0.6) + ', inset 0 0 18px 1px ' + rgbCss(current[1], 0.35);
            ambientKick.style.boxShadow = 'inset 0 0 130px 18px ' + rgbCss(current[1], 0.6) + ', inset 0 0 40px 4px ' + rgbCss(current[2], 0.45);
          }
        }
        // Faint while the music is quiet; only clear hits flare, and the
        // flare rises fast but fades slowly so it never strobes.
        ambientBase.style.opacity = String(clamp(0.25 + ambientLevel * 0.5, 0.25, 0.55).toFixed(3));
        // Only the transient part of the kick detector: the overall bass level
        // stays high through a dense track and kept the flare lit.
        var hit = clamp((kickLevel - 0.22) / 0.78, 0, 1);
        ambientFlare += (hit - ambientFlare) * (1 - Math.exp(-adt / (hit > ambientFlare ? 40 : 280)));
        ambientKick.style.opacity = String((ambientFlare * 0.75).toFixed(3));
        root.style.opacity = '1';
      }
      function hideAmbient() {
        if (ambientRoot) ambientRoot.style.opacity = '0';
      }

      // ---- Retro LED meter: segmented columns with falling peak caps ----
      var ledPeaks = null;
      var ledLast = 0;
      function drawLed(now) {
        if (!ensureCanvas()) return;
        var bar = playerBar();
        if (!bar) { canvas.style.opacity = '0'; return; }
        var barRect = bar.getBoundingClientRect();
        var W = Math.min(window.innerWidth, document.documentElement.clientWidth || window.innerWidth);
        var fit = gutterFit(W);
        var narrow = !fit.inBar;
        var H = narrow ? 32 : barRect.height;
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        if (canvas.width !== W * dpr || canvas.height !== H * dpr) {
          canvas.width = W * dpr;
          canvas.height = H * dpr;
          canvas.style.width = W + 'px';
          canvas.style.height = H + 'px';
        }
        canvas.style.top = (narrow ? Math.max(0, barRect.top - H - 4) : barRect.top) + 'px';
        canvas.style.left = '0';
        canvas.style.transform = '';
        var ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

        var nb = 10;
        cols = nb;
        if (!smooth || smooth.length !== cols) smooth = new Float32Array(cols);
        if (!ledPeaks || ledPeaks.length !== cols) ledPeaks = new Float32Array(cols);
        spectrumTargets(now);
        smoothLevels();
        easePalette();

        var dt = ledLast ? Math.min(100, now - ledLast) : 16;
        ledLast = now;
        var S = narrow ? 6 : 8;
        var top = narrow ? 3 : Math.max(5, H * 0.14);
        var bottom = narrow ? H - 1 : H - Math.max(5, H * 0.14);
        var gapY = 1.5;
        var segH = Math.max(1.5, (bottom - top - (S - 1) * gapY) / S);
        var margin = fit.margin;
        var groupW = fit.inBar ? fit.groupW : clamp(W * 0.2, 70, 210);
        var unit = groupW / nb;
        var bw = Math.max(2, Math.min(10, unit * 0.68));
        var gap = Math.max(1, unit - bw);

        ctx.clearRect(0, 0, W, H);
        for (var j = 0; j < nb; j++) {
          var lit = smooth[j] * S;
          // Peaks hold, then fall about one segment per 90 ms.
          ledPeaks[j] = Math.max(lit, ledPeaks[j] - dt / 90);
          var peakSeg = Math.min(S - 1, Math.floor(ledPeaks[j]));
          for (var k = 0; k < S; k++) {
            var y = bottom - (k + 1) * segH - k * gapY;
            var litSeg = k < Math.round(lit);
            var t = S > 1 ? k / (S - 1) : 0;
            if (litSeg) {
              var col = mix(current[0], current[2], t);
              if (k >= S - 2) col = mix(col, [255, 255, 255], 0.2);
              ctx.fillStyle = rgbCss(col, 0.95);
            } else if (k === peakSeg && ledPeaks[j] > 0.6) {
              ctx.fillStyle = rgbCss(current[2], 0.85);
            } else {
              ctx.fillStyle = 'rgba(255,255,255,0.07)';
            }
            var xl = margin + j * (bw + gap);
            var xr = W - margin - bw - j * (bw + gap);
            ctx.fillRect(xl, y, bw, segH);
            ctx.fillRect(xr, y, bw, segH);
          }
        }
        canvas.style.opacity = '1';
      }

      // ---- Spectrogram: a waterfall painted behind the player controls ----
      var specCanvas = null;
      var specBuffer = null;
      var specLast = 0;
      var specRows = 0;
      var specAvg = null;
      var specOnsetMax = null;
      var specPeak = 0.3;
      var specCarry = 0;
      function ensureSpecCanvas(bar) {
        var host = bar.querySelector('.playControls__inner') || bar;
        if (specCanvas && specCanvas.parentElement === host) return specCanvas;
        if (specCanvas && specCanvas.parentElement) specCanvas.parentElement.removeChild(specCanvas);
        specCanvas = document.createElement('canvas');
        specCanvas.id = 'sc-visualizer-spectrogram';
        specCanvas.setAttribute('aria-hidden', 'true');
        // First child, positioned: SoundCloud's controls (positioned, later in
        // the tree) paint on top, the bar background stays underneath.
        specCanvas.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:0;opacity:0;transition:opacity .45s ease;' +
          '-webkit-mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);mask-image:linear-gradient(90deg,transparent,#000 18%,#000 82%,transparent);';
        host.insertBefore(specCanvas, host.firstChild);
        return specCanvas;
      }
      function drawSpectrogram(now) {
        var bar = playerBar();
        if (!bar) return;
        var cv = ensureSpecCanvas(bar);
        var r = bar.getBoundingClientRect();
        var dpr = Math.min(2, window.devicePixelRatio || 1);
        var W = Math.max(64, Math.round(r.width));
        var H = Math.max(16, Math.round(r.height));
        if (cv.width !== W * dpr || cv.height !== H * dpr) {
          cv.width = W * dpr;
          cv.height = H * dpr;
          specLast = 0;
        }
        // Explicit size: the bar's inner box carries a transform, so a
        // percentage would resolve against the wrong box.
        if (cv.style.width !== W + 'px') cv.style.width = W + 'px';
        if (cv.style.height !== H + 'px') cv.style.height = H + 'px';
        var ctx = cv.getContext('2d');
        if (!ctx) return;
        easePalette();

        var analyser = activeAnalyser || window.__scAudioAnalyser || window.__scVizAnalyser;
        if (!analyser) { cv.style.opacity = '0.8'; return; }
        if (!freq || freq.length !== analyser.frequencyBinCount) freq = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteFrequencyData(freq);

        // Scroll left at ~90 px/s, whatever the frame rate.
        var dt = specLast ? Math.min(100, now - specLast) : 16;
        specLast = now;
        specCarry += dt * 0.09 * dpr;
        var dx = Math.floor(specCarry);
        if (dx < 1) { cv.style.opacity = '0.8'; return; }
        specCarry -= dx;

        // Scroll through a second canvas: drawing a canvas onto itself in
        // 'copy' mode clears it first, which kept only the newest column.
        var cw = cv.width, ch = cv.height;
        if (!specBuffer) specBuffer = document.createElement('canvas');
        if (specBuffer.width !== cw || specBuffer.height !== ch) { specBuffer.width = cw; specBuffer.height = ch; }
        var bctx = specBuffer.getContext('2d');
        if (!bctx) return;
        bctx.globalCompositeOperation = 'copy';
        bctx.drawImage(cv, -dx, 0);
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'copy';
        ctx.drawImage(specBuffer, 0, 0);
        ctx.globalCompositeOperation = 'source-over';

        // SoundCloud's analyser is heavily smoothed, so raw levels sit near
        // the top and the band looked like one flat stripe. Paint what
        // changes instead: each row's rise over its own recent average,
        // scaled to that row's recent biggest rise, over a faint level base.
        // Measured on live audio: ~12% bright cells instead of ~90%, and
        // about 3x more movement over time.
        var rows = Math.max(8, Math.floor(H / 2));
        var rowH = ch / rows;
        var bins = freq.length;
        var usable = Math.max(8, Math.floor(bins * 0.46));
        if (specRows !== rows) {
          specRows = rows;
          specAvg = new Float32Array(rows);
          specOnsetMax = new Float32Array(rows);
          for (var r0 = 0; r0 < rows; r0++) specOnsetMax[r0] = 0.05;
        }
        var avgRate = 1 - Math.exp(-dt / 1200);
        var maxDecay = Math.exp(-dt / 2500);
        var fmax = 0;
        for (var i = 0; i < rows; i++) {
          var tt = rows > 1 ? i / (rows - 1) : 0;
          var bb = Math.min(bins - 1, Math.floor(Math.pow(tt, 1.55) * usable));
          if (freq[bb] / 255 > fmax) fmax = freq[bb] / 255;
        }
        specPeak = Math.max(fmax, specPeak * Math.exp(-dt / 4000), 0.15);
        for (var ri = 0; ri < rows; ri++) {
          // Bottom row = bass.
          var t = rows > 1 ? ri / (rows - 1) : 0;
          var bin = Math.min(bins - 1, Math.floor(Math.pow(t, 1.55) * usable));
          var level = (freq[bin] + freq[Math.min(bins - 1, bin + 1)]) / 510;
          specAvg[ri] += (level - specAvg[ri]) * avgRate;
          var rise = Math.max(0, level - specAvg[ri]);
          specOnsetMax[ri] = Math.max(rise, specOnsetMax[ri] * maxDecay, 0.02);
          var v = clamp(0.3 * Math.pow(level / specPeak, 4) + 1.15 * Math.pow(rise / specOnsetMax[ri], 1.5), 0, 1);
          if (v < 0.08) continue;
          var lo = mix(current[0], [255, 255, 255], 0.1);
          var col = v < 0.5 ? mix(lo, current[1], v * 2) : mix(current[1], mix(current[2], [255, 255, 255], 0.5), (v - 0.5) * 2);
          ctx.fillStyle = rgbCss(col, clamp(0.12 + v * 0.85, 0, 0.97));
          ctx.fillRect(cw - dx, ch - (ri + 1) * rowH, dx, Math.ceil(rowH));
        }
        cv.style.opacity = '0.8';
      }

      // Fade the overlay out without destroying it: the next play resumes the
      // same canvas without a reflow flash.
      function hideVisuals() {
        if (canvas) canvas.style.opacity = '0';
        if (waveCanvas) waveCanvas.style.opacity = '0';
        if (specCanvas) specCanvas.style.opacity = '0';
        hideAmbient();
        // Wave is gone (pause, disable, mode switch): give the timeline its own
        // orange bar and draggable handle back.
        restoreWaveNative();
        if (glowActive) clearGlow(true);
      }

      var lastType = null;
      var visualsHidden = false;
      var pauseSince = 0;
      var vizFrames = 0;
      var playbackClickBound = false;
      var barRetry = null;

      // The draw loop is demand-driven: it runs only while audio is playing and
      // the visualizer is enabled. A permanent rAF loop kept the compositor
      // awake for the whole session even in silence.
      // Battery saver (main process, on battery power) pauses the visualizer
      // without touching the user's own on/off setting.
      var powerSaver = window.__scPowerSaverActive === true;
      function on() { return enabled && !powerSaver; }
      window.__scVizSetPowerSaver = function(value) {
        powerSaver = value === true;
        applyEnabled();
        applyPlaybackVisibility();
      };

      function stopLoop() {
        if (raf) { cancelAnimationFrame(raf); raf = null; }
      }
      function startLoop() {
        if (raf || document.hidden || !on()) return;
        if (barRetry) { clearTimeout(barRetry); barRetry = null; }
        lastPoll = 0;
        raf = requestAnimationFrame(draw);
      }
      function scheduleBarRetry() {
        if (barRetry) return;
        barRetry = setTimeout(function() {
          barRetry = null;
          if (on() && isPlaying() && !document.hidden) startLoop();
        }, 2000);
      }

      // Hiding must not depend on requestAnimationFrame: Electron throttles it
      // while the window is occluded, and the fade should start on the pause
      // itself, not on the next visible frame.
      function applyPlaybackVisibility() {
        if (!on()) {
          if (!visualsHidden) { hideVisuals(); visualsHidden = true; }
          stopLoop();
          return;
        }
        if (isPlaying()) {
          pauseSince = 0;
          visualsHidden = false;
          startLoop();
          return;
        }
        if (!visualsHidden) { hideVisuals(); visualsHidden = true; }
        stopLoop();
      }

      function bindPlaybackState() {
        var el = window.__scAudioElement;
        if (el) {
          el.addEventListener('play', applyPlaybackVisibility);
          el.addEventListener('pause', applyPlaybackVisibility);
        }
        if (!playbackClickBound) {
          playbackClickBound = true;
          document.addEventListener('click', function (e) {
            var t = e.target;
            if (t && t.closest && t.closest('.playControls__play')) {
              setTimeout(applyPlaybackVisibility, 60);
              setTimeout(applyPlaybackVisibility, 300);
            }
          }, true);
        }
      }

      // SoundCloud modals (add to playlist, share, report...) are rendered in
      // the page's own stacking order, but the visualizer layers are fixed at a
      // z-index above everything so they would glow through the dialog. While a
      // modal is open the layers fade out instead of fighting over z-order.
      var MODAL_SELECTORS = '.modal.m-visible, .modal__modal, .modalWrapper, .g-modal-wrapper, [role="dialog"], [aria-modal="true"]';
      var modalHidden = false;
      var modalCheckAt = 0;
      var modalCached = false;
      function modalOpen(now) {
        if (now - modalCheckAt < 40) return modalCached;
        modalCheckAt = now;
        var found = false;
        var nodes = document.querySelectorAll(MODAL_SELECTORS);
        for (var i = 0; i < nodes.length; i++) {
          var n = nodes[i];
          if (n.id && (n.id.indexOf('sc-') === 0 || n.id.indexOf('onetrust') === 0)) continue;
          var r = n.getBoundingClientRect();
          if (r.width < 40 || r.height < 40) continue;
          var cs = getComputedStyle(n);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          found = true;
          break;
        }
        modalCached = found;
        return found;
      }

      // Hide instantly (no fade): a fade makes the glow linger over a dialog
      // that is already on screen. Fading back in on close is fine.
      function setModalState(open) {
        if (open === modalHidden) return;
        modalHidden = open;
        if (open) {
          if (canvas) { canvas.style.transition = 'none'; canvas.style.opacity = '0'; }
          if (glowLayer) { glowLayer.style.transition = 'none'; glowLayer.style.opacity = '0'; }
          if (ambientRoot) { ambientRoot.style.transition = 'none'; ambientRoot.style.opacity = '0'; }
          if (glowActive) clearGlow(false);
        } else {
          if (canvas) canvas.style.transition = 'opacity .45s ease';
          if (glowLayer) glowLayer.style.transition = 'opacity .45s ease';
          if (ambientRoot) ambientRoot.style.transition = 'opacity .45s ease';
        }
      }
      var modalObsTimer = null;
      function bindModalObserver() {
        if (typeof MutationObserver !== 'function' || !document.body) return;
        new MutationObserver(function() {
          if (modalObsTimer) return;
          modalObsTimer = setTimeout(function() {
            modalObsTimer = null;
            modalCheckAt = 0;
            setModalState(modalOpen(performance.now()));
          }, 30);
        }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'aria-hidden'] });
      }

      function draw(now) {
        if (document.hidden) { stopLoop(); return; }
        vizFrames++;

        // Leaving wave mode (or switching the visualizer off) must hand the
        // timeline back to SoundCloud's own colours.
        if (vizType !== 'wave' || !on()) restoreWaveNative();

        if (!on()) {
          if (!visualsHidden) { hideVisuals(); visualsHidden = true; }
          stopLoop();
          return;
        }

        if (!isPlaying()) {
          if (!visualsHidden) { hideVisuals(); visualsHidden = true; }
          stopLoop();
          return;
        }
        pauseSince = 0;
        visualsHidden = false;

        setModalState(modalOpen(now));
        if (modalHidden) {
          raf = requestAnimationFrame(draw);
          return;
        }

        if (vizType !== lastType) {
          hideVisuals();
          lastType = vizType;
        }

        if (now - lastPoll > 1000) {
          lastPoll = now;
          bindPlaybackState();
          var bar = playerBar();
          hasBar = !!bar;
          if (bar) requestPalette(findArtwork());
        }

        if (!hasBar) {
          hideVisuals();
          stopLoop();
          scheduleBarRetry();
          return;
        }

        activeAnalyser = pickAnalyser();

        if (vizType === 'side') drawSide(now);
        else if (vizType === 'above') drawAbove(now);
        else if (vizType === 'wave') drawWave(now);
        else if (vizType === 'glow') drawGlow(now);
        else if (vizType === 'scope') drawScope(now);
        else if (vizType === 'ambient') drawAmbient(now);
        else if (vizType === 'led') drawLed(now);
        else if (vizType === 'spectrogram') drawSpectrogram(now);

        raf = requestAnimationFrame(draw);
      }

      function applyEnabled() {
        if (!canvas) return;
        canvas.style.opacity = on() ? '1' : '0';
        if (on()) startLoop();
        else stopLoop();
      }

      window.__scVizDebug = function() {
        var analyser = window.__scVizAnalyser || window.__scAudioAnalyser;
        var max = 0;
        if (analyser) {
          var f = new Uint8Array(analyser.frequencyBinCount);
          analyser.getByteFrequencyData(f);
          for (var i = 0; i < f.length; i++) if (f[i] > max) max = f[i];
        }
        return { type: vizType, artwork: lastArtwork, wanted: wanted.map(function(c) { return rgbCss(c, 1); }), current: current.map(function(c) { return rgbCss(c, 1); }), paletteSource: paletteSource, enabled: enabled, hasBar: hasBar, cols: cols, tap: !!window.__scVizAnalyser, live: !!window.__scAudioAnalyser, analyser: activeAnalyser === window.__scAudioAnalyser ? 'audio' : (activeAnalyser ? 'tap' : 'none'), barMax: max, playing: isPlaying(), hidden: visualsHidden, pauseSince: pauseSince, frames: vizFrames, canvasOpacity: canvas ? canvas.style.opacity : null, glow: glowLayer ? { opacity: glowLayer.style.opacity, transform: glowLayer.style.transform, boxShadow: glowLayer.style.boxShadow.slice(0, 160), left: glowLayer.style.left, top: glowLayer.style.top, width: glowLayer.style.width, height: glowLayer.style.height } : null, glowBass: glowBass };
      };
      window.__scVizSetEnabled = function(value) {
        enabled = value !== false;
        applyEnabled();
      };
      window.__scVizGetEnabled = function() { return enabled; };
      window.__scVizSetType = function(type) {
        if (!type) return;
        vizType = type;
        lastPoll = 0; // Пересоздать canvas если нужно
      };
      window.__scVizGetType = function() { return vizType; };

      function readSettings() {
        var api = window.sixteenCloud;
        if (!api || typeof api.storeGet !== 'function') return;
        api.storeGet('visualizer').then(function(state) {
          enabled = !state || state.enabled !== false;
          if (state && state.type) vizType = state.type;
          applyEnabled();
        }).catch(function() {});
      }

      readSettings();
      bindPlaybackState();
      bindModalObserver();
      startLoop();
      // Safety net for playback that starts without a click on our play button
      // (autoplay, media keys, auto-advance): one cheap probe per second, and
      // the draw loop itself is left stopped while paused.
      setInterval(function() {
        if (!raf && on() && !document.hidden && isPlaying()) startLoop();
      }, 1000);
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) stopLoop();
        else applyPlaybackVisibility();
      });
    })();
  `;
}

import { t, getScriptTranslations } from '../../shared/i18n';

export function getLyricsOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('lyrics.title')}</h2>
    </div>
    <div class="sc-overlay-body" style="padding-bottom: 0;">
      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('lyrics.now_playing')}</span>
        <div class="sc-overlay-status" id="sc-lyrics-track">
          <span class="sc-overlay-status-dot gray" id="sc-lyrics-dot"></span>
          <span class="sc-overlay-status-text" id="sc-lyrics-track-text">${t('lyrics.no_track')}</span>
        </div>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('lyrics.font_size')}</span>
        <div style="display: flex; align-items: center; gap: 10px;">
          <input type="range" min="12" max="28" value="16" id="sc-lyrics-fontsize" style="flex:1; accent-color: #f50;">
          <span id="sc-lyrics-fontsize-val" style="color: #888; font-size: 12px; min-width: 30px;">16px</span>
        </div>
      </div>

      <div id="sc-lyrics-content">
        <div class="sc-lyrics-placeholder">${t('lyrics.placeholder')}</div>
      </div>

      <div style="font-size: 11px; color: #444; text-align: center; padding: 8px 0;">${t('lyrics.powered_by')}</div>
    </div>
  `;
}

export function getLyricsOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'lyrics.searching', 'lyrics.not_found', 'lyrics.fetch_failed',
  ]));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="lyrics"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      var api = window.sixteenCloud;
      if (!api) return;

      var dot = panel.querySelector('#sc-lyrics-dot');
      var trackText = panel.querySelector('#sc-lyrics-track-text');
      var content = panel.querySelector('#sc-lyrics-content');
      var fontSlider = panel.querySelector('#sc-lyrics-fontsize');
      var fontVal = panel.querySelector('#sc-lyrics-fontsize-val');

      api.storeGet('lyrics.fontSize').then(function(size) {
        if (size) {
          fontSlider.value = size;
          fontVal.textContent = size + 'px';
          content.style.fontSize = size + 'px';
        }
      });

      var fontSaveTimer = null;
      function saveFontSize(size) {
        if (fontSaveTimer) clearTimeout(fontSaveTimer);
        fontSaveTimer = setTimeout(function() {
          api.storeSet('lyrics.fontSize', parseInt(size));
          fontSaveTimer = null;
        }, 150);
      }

      fontSlider.addEventListener('input', function() {
        var size = fontSlider.value;
        fontVal.textContent = size + 'px';
        content.style.fontSize = size + 'px';
        if (syncedLines && syncedLines.length) layoutWheel(lastPos, syncedIndex, true);
        saveFontSize(size);
      });

      var lastTrack = '';
      var fetchSeq = 0;

      // The badge markup hides a duplicate title in a visually-hidden span:
      // "Current track: <title><title>", so prefer the title attribute and
      // otherwise read only the aria-hidden copy.
      function readBadgeText(link) {
        if (!link) return '';
        var attr = link.getAttribute('title');
        if (attr) return attr.trim();
        var visible = link.querySelector('span[aria-hidden="true"]');
        if (visible && visible.textContent.trim()) return visible.textContent.trim();
        return (link.textContent || '').replace(/^Current track:\\s*/, '').trim();
      }

      function stripHandle(value) {
        return (value || '').replace(/\\s*\\(@[^)]*\\)\\s*$/, '').trim();
      }

      // Layout-independent now-playing source: SoundCloud publishes the Media
      // Session metadata for whatever is playing, on every page. The player
      // badge is the fallback (it disappears on the standby/crossfade layout).
      function readNowPlaying() {
        try {
          var md = navigator.mediaSession && navigator.mediaSession.metadata;
          if (md) {
            var mdTitle = (md.title || '').trim();
            if (mdTitle) return { title: mdTitle, artist: stripHandle(md.artist || '') };
          }
        } catch (e) { /* fall through to the badge */ }
        var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
        if (!titleEl) return null;
        var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
        var badgeTitle = readBadgeText(titleEl);
        if (!badgeTitle) return null;
        return { title: badgeTitle, artist: stripHandle(artistEl ? readBadgeText(artistEl) : '') };
      }

      var syncedLines = null;   // [{ t: seconds, text }]
      var lineEls = [];
      var syncedIndex = -1;
      var rollRaf = null;
      var lastPos = 0;
      var frames = 0;
      var stopLog = [];

      function esc(s) {
        if (window.__scEscapeHtml) return window.__scEscapeHtml(s);
        return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
      }

      function clearModes() {
        stopRoll();
        syncedLines = null;
        lineEls = [];
        syncedIndex = -1;
        lastPos = 0;
        content.classList.remove('sc-lyrics-synced');
        var body = content.parentElement;
        if (body) body.classList.remove('sc-lyrics-synced-body');
      }

      // LRC: "[mm:ss.xx]text", several timestamps per line, [offset:±ms] honoured.
      function parseLrc(text) {
        var out = [];
        var offset = 0;
        var raw = String(text).split(/\\r?\\n/);
        var re = /\\[(\\d{1,3}):(\\d{1,2})(?:[.:](\\d{1,3}))?\\]/g;
        for (var i = 0; i < raw.length; i++) {
          var line = raw[i];
          var off = line.match(/^\\s*\\[offset:\\s*([+-]?\\d+)\\s*\\]/i);
          if (off) { offset = parseInt(off[1], 10) || 0; continue; }
          var times = [];
          var m;
          re.lastIndex = 0;
          while ((m = re.exec(line)) !== null) {
            var frac = m[3] ? parseFloat('0.' + m[3]) : 0;
            times.push(parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac);
          }
          var body = line.replace(/\\[[^\\]]*\\]/g, '').trim();
          if (!times.length || !body) continue;
          for (var j = 0; j < times.length; j++) out.push({ t: times[j], text: body });
        }
        out.sort(function(a, b) { return a.t - b.t; });
        if (offset) for (var k = 0; k < out.length; k++) out[k].t += offset / 1000;
        return out;
      }

      function renderPlainLyrics(text) {
        clearModes();
        content.innerHTML = '<div class="sc-lyrics-plain">' + esc(text) + '</div>';
      }

      function renderSynced(lines) {
        clearModes();
        syncedLines = lines;
        content.classList.add('sc-lyrics-synced');
        var bodyEl = content.parentElement;
        if (bodyEl) bodyEl.classList.add('sc-lyrics-synced-body');
        var html = '';
        for (var i = 0; i < lines.length; i++) {
          html += '<div class="sc-lyrics-line" data-i="' + i + '">' + esc(lines[i].text) + '</div>';
        }
        content.innerHTML = '<div class="sc-lyrics-roulette">' + html + '</div>';
        lineEls = Array.prototype.slice.call(content.querySelectorAll('.sc-lyrics-line'));
        syncedIndex = -1;
        lastPos = 0;
        layoutWheel(0, -1, true);
        startRoll();
      }

      function wheelMetrics() {
        var fs = parseFloat(content.style.fontSize) || 16;
        return { H: Math.round(fs * 2.7), A: 15, depth: fs * 1.1, range: 5.5 };
      }

      // pos is a fractional line index: the wheel rolls continuously between
      // lines, so playback looks like a spinning casino reel instead of a jump.
      function layoutWheel(pos, activeIndex, force) {
        var m = wheelMetrics();
        for (var i = 0; i < lineEls.length; i++) {
          var el = lineEls[i];
          var off = i - pos;
          if (Math.abs(off) > m.range) {
            if (el.style.display !== 'none') el.style.display = 'none';
            continue;
          }
          if (el.style.display === 'none') el.style.display = '';
          var dy = off * m.H;
          var rot = -off * m.A;                 // future below leans forward, past above leans back
          var dz = -Math.abs(off) * m.depth;
          var op = Math.max(0.08, 1 - Math.abs(off) * 0.26);
          el.style.transform = 'translate(-50%, -50%) translate3d(0,' + dy.toFixed(2) + 'px,' + dz.toFixed(1) + 'px) rotateX(' + rot.toFixed(2) + 'deg)';
          el.style.opacity = op.toFixed(3);
        }
        if (activeIndex !== syncedIndex || force) {
          if (syncedIndex >= 0 && lineEls[syncedIndex]) lineEls[syncedIndex].classList.remove('active');
          syncedIndex = activeIndex;
          if (activeIndex >= 0 && lineEls[activeIndex]) lineEls[activeIndex].classList.add('active');
        }
      }

      function stopRoll() {
        if (rollRaf) {
          stopLog.push({ frames: frames, stack: String(new Error().stack || '').split(String.fromCharCode(10)).slice(1, 4).join(' | ') });
          if (stopLog.length > 5) stopLog.shift();
          cancelAnimationFrame(rollRaf);
          rollRaf = null;
        }
      }

      function startRoll() {
        stopRoll();
        if (!syncedLines || !syncedLines.length || !isPanelActive()) return;
        var step = function() {
          rollRaf = requestAnimationFrame(step);
          frames++;
          try {
          var au = window.__scAudioElement;
          if (!au || !isFinite(au.currentTime)) return;
          var now = au.currentTime;
          var arr = syncedLines;
          var k = -1;
          for (var i = 0; i < arr.length; i++) { if (arr[i].t <= now) k = i; else break; }
          var f = 0;
          if (k >= 0 && k < arr.length - 1) {
            var span = arr[k + 1].t - arr[k].t;
            if (span > 0.05) f = Math.max(0, Math.min(1, (now - arr[k].t) / span));
          }
          lastPos = Math.max(0, k) + f;
          layoutWheel(lastPos, k, false);
          } catch (e) { window.__scLyricsLastErr = String(e && e.message || e); }
        };
        rollRaf = requestAnimationFrame(step);
      }

      function detectAndFetch() {
        var now = readNowPlaying();
        if (!now) return;

        var title = now.title;
        var artist = now.artist;
        var key = artist + ' - ' + title;

        // The same track keeps whatever is on screen. A different key always
        // starts a fresh search, superseding any request still in flight, so
        // switching tracks can never leave the panel stuck on the old one.
        if (!title || key === lastTrack) return;
        lastTrack = key;
        var seq = ++fetchSeq;

        dot.className = 'sc-overlay-status-dot yellow';
        trackText.textContent = title + ' — ' + artist;
        clearModes();
        content.innerHTML = '<div style="color:#888;text-align:center;padding:40px 0">' + _t('lyrics.searching') + '</div>';

        var au = window.__scAudioElement;
        var dur = (au && isFinite(au.duration) && au.duration > 1) ? au.duration : undefined;

        api.lyricsFetch(artist, title, dur).then(function(result) {
          if (seq !== fetchSeq) return;
          if (!result || !result.lyrics) {
            dot.className = 'sc-overlay-status-dot red';
            content.innerHTML = '<div style="color:#666;text-align:center;padding:40px 0">' + _t('lyrics.not_found') + '</div>';
            return;
          }
          var lines = result.syncedLyrics ? parseLrc(result.syncedLyrics) : null;
          if (lines && lines.length >= 2) {
            dot.className = 'sc-overlay-status-dot green';
            renderSynced(lines);
          } else {
            dot.className = 'sc-overlay-status-dot green';
            renderPlainLyrics(result.lyrics);
          }
        }).catch(function() {
          if (seq !== fetchSeq) return;
          dot.className = 'sc-overlay-status-dot red';
          content.innerHTML = '<div style="color:#666;text-align:center;padding:40px 0">' + _t('lyrics.fetch_failed') + '</div>';
        });
      }

      // Lyrics are only useful while their panel is visible. Keep no timer alive
      // for hidden sections/windows and resume with an immediate detection.
      var pollTimer = null;
      var polling = false;
      function isPanelActive() {
        var container = document.getElementById('sc-overlay-container');
        return !document.hidden && panel.classList.contains('active') && !!(container && container.classList.contains('open'));
      }
      function stopPolling() {
        polling = false;
        stopRoll();
        if (pollTimer) { clearTimeout(pollTimer); pollTimer = null; }
      }
      function schedulePoll() {
        if (!polling) return;
        if (!isPanelActive()) { stopPolling(); return; }
        pollTimer = setTimeout(function() {
          pollTimer = null;
          if (!isPanelActive()) { stopPolling(); return; }
          try { detectAndFetch(); } catch (e) { window.__scLyricsLastErr = String(e && e.message || e); }
          schedulePoll();
        }, 3000);
      }
      function startPolling() {
        if (polling || !isPanelActive()) return;
        polling = true;
        if (syncedLines && syncedLines.length) startRoll();
        detectAndFetch();
        schedulePoll();
      }
      var sectionObserver = new MutationObserver(function() {
        if (isPanelActive()) startPolling(); else stopPolling();
      });
      sectionObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
      document.addEventListener('visibilitychange', function() {
        if (isPanelActive()) startPolling(); else stopPolling();
      });

      window.__scLyricsDebug = function() {
        var au = window.__scAudioElement;
        return {
          synced: !!syncedLines,
          count: syncedLines ? syncedLines.length : 0,
          activeIndex: syncedIndex,
          lastPos: lastPos,
          frames: frames,
          polling: polling,
          hidden: document.hidden,
          stopLog: stopLog,
          err: window.__scLyricsLastErr || null,
          head: syncedLines ? syncedLines.slice(0, 3) : null,
          raf: !!rollRaf,
          panelActive: isPanelActive(),
          audioT: (au && isFinite(au.currentTime)) ? +au.currentTime.toFixed(2) : null,
          paused: au ? au.paused : null,
          key: lastTrack,
          seq: fetchSeq
        };
      };

      startPolling();
    })();
  `;
}

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
          <input type="range" min="12" max="28" value="16" id="sc-lyrics-fontsize" style="flex:1; accent-color: var(--sc-accent);">
          <span id="sc-lyrics-fontsize-val" style="color: var(--sc-text-muted); font-size: 12px; min-width: 30px;">16px</span>
        </div>
      </div>

      <div class="sc-overlay-group sc-lyr-tools">
        <div class="sc-lyr-row">
          <span class="sc-overlay-label" style="margin:0">${t('lyrics.offset')}</span>
          <div class="sc-lyr-offset">
            <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-off-minus" aria-label="-0.5s">&minus;</button>
            <span id="sc-lyr-off-val">0.0s</span>
            <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-off-plus" aria-label="+0.5s">+</button>
            <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-off-reset" aria-label="${t('settings.reset')}">&#8634;</button>
          </div>
        </div>
        <div class="sc-lyr-row">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-other">${t('lyrics.other_versions')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-fs">${t('lyrics.fullscreen')}</button>
        </div>
        <div id="sc-lyr-picker" style="display:none"></div>
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
    'lyrics.search_versions', 'lyrics.use_this', 'lyrics.reset_choice', 'lyrics.no_versions',
    'lyrics.synced', 'lyrics.plain', 'lyrics.query_placeholder', 'lyrics.chosen',
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
      var offVal = panel.querySelector('#sc-lyr-off-val');
      var pickerEl = panel.querySelector('#sc-lyr-picker');

      var offsetMs = 0;
      var curPrefKey = '';
      var curArtist = '';
      var curTitle = '';
      var curDur;
      var curResult = null;
      var fsOpen = false;
      var fsEl = null;

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
        // The player badge is what the user sees and hears. The Media Session
        // metadata can lag or be rewritten by the page (after pause/resume it
        // once carried another upload's artist), so it is only a fallback for
        // layouts without a badge.
        var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
        if (titleEl) {
          var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
          var badgeTitle = readBadgeText(titleEl);
          if (badgeTitle) return { title: badgeTitle, artist: stripHandle(artistEl ? readBadgeText(artistEl) : '') };
        }
        try {
          var md = navigator.mediaSession && navigator.mediaSession.metadata;
          if (md) {
            var mdTitle = (md.title || '').trim();
            if (mdTitle) return { title: mdTitle, artist: stripHandle(md.artist || '') };
          }
        } catch (e) { /* nothing playing */ }
        return null;
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
        if (!syncedLines || !syncedLines.length || !isPanelVisible()) return;
        var step = function() {
          rollRaf = requestAnimationFrame(step);
          frames++;
          try {
          var au = window.__scAudioElement;
          if (!au || !isFinite(au.currentTime)) return;
          var now = au.currentTime + offsetMs / 1000;
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
        content.innerHTML = '<div style="color:var(--sc-text-muted);text-align:center;padding:40px 0">' + _t('lyrics.searching') + '</div>';

        var au = window.__scAudioElement;
        var dur = (au && isFinite(au.duration) && au.duration > 1) ? au.duration : undefined;
        curArtist = artist; curTitle = title; curDur = dur;
        curPrefKey = (artist + '|' + title).toLowerCase();
        closePicker();
        fsRender();

        var prefP = (typeof api.lyricsPref === 'function')
          ? api.lyricsPref('get', curPrefKey).catch(function() { return null; })
          : Promise.resolve(null);
        prefP.then(function(pref) {
          if (seq !== fetchSeq) return;
          offsetMs = (pref && pref.offset) || 0;
          updateOffsetLabel();
          if (pref && pref.choice && pref.choice.lyrics) { applyResult(pref.choice); return; }
          return api.lyricsFetch(artist, title, dur).then(function(result) {
            if (seq !== fetchSeq) return;
            applyResult(result);
          });
        }).catch(function() {
          if (seq !== fetchSeq) return;
          dot.className = 'sc-overlay-status-dot red';
          content.innerHTML = '<div style="color:var(--sc-text-subtle);text-align:center;padding:40px 0">' + _t('lyrics.fetch_failed') + '</div>';
          curResult = null;
          fsRender();
        });
      }

      function applyResult(result) {
        curResult = result && result.lyrics ? result : null;
        if (!curResult) {
          dot.className = 'sc-overlay-status-dot red';
          clearModes();
          content.innerHTML = '<div style="color:var(--sc-text-subtle);text-align:center;padding:40px 0">' + _t('lyrics.not_found') + '</div>';
          fsRender();
          return;
        }
        dot.className = 'sc-overlay-status-dot green';
        var lines = result.syncedLyrics ? parseLrc(result.syncedLyrics) : null;
        if (lines && lines.length >= 2) renderSynced(lines);
        else renderPlainLyrics(result.lyrics);
        fsRender();
      }

      // ---- Sync offset (per track, remembered) ----
      function updateOffsetLabel() {
        var v = offsetMs / 1000;
        offVal.textContent = (v > 0 ? '+' : '') + v.toFixed(1) + 's';
      }
      var offSaveTimer = null;
      function changeOffset(delta, absolute) {
        offsetMs = Math.max(-30000, Math.min(30000, absolute ? delta : offsetMs + delta));
        updateOffsetLabel();
        if (offSaveTimer) clearTimeout(offSaveTimer);
        var key = curPrefKey, val = offsetMs;
        offSaveTimer = setTimeout(function() {
          offSaveTimer = null;
          if (key && typeof api.lyricsPref === 'function') api.lyricsPref('setOffset', key, val).catch(function() {});
        }, 400);
      }
      panel.querySelector('#sc-lyr-off-minus').addEventListener('click', function() { changeOffset(-500); });
      panel.querySelector('#sc-lyr-off-plus').addEventListener('click', function() { changeOffset(500); });
      panel.querySelector('#sc-lyr-off-reset').addEventListener('click', function() { changeOffset(0, true); });

      // ---- Other versions picker ----
      function closePicker() { pickerEl.style.display = 'none'; pickerEl.innerHTML = ''; }
      function renderCandidates(listEl, items) {
        if (!items || !items.length) {
          listEl.innerHTML = '<div style="color:var(--sc-text-muted);padding:10px 0;font-size:12px">' + _t('lyrics.no_versions') + '</div>';
          return;
        }
        listEl.innerHTML = '';
        items.forEach(function(c) {
          var row = document.createElement('div');
          row.className = 'sc-lyr-cand';
          var preview = String(c.lyrics || '').split(/\\r?\\n/).filter(Boolean).slice(0, 2).join(' / ');
          row.innerHTML =
            '<div class="sc-lyr-cand-main"><div class="sc-lyr-cand-label">' + esc(c.label) + '</div>' +
            '<div class="sc-lyr-cand-meta">' + esc(c.source) + ' · ' + (c.synced ? _t('lyrics.synced') : _t('lyrics.plain')) +
            (typeof c.durationDiff === 'number' ? ' · Δ' + c.durationDiff.toFixed(0) + 's' : '') + '</div>' +
            '<div class="sc-lyr-cand-prev">' + esc(preview.slice(0, 110)) + '</div></div>';
          var btn = document.createElement('button');
          btn.className = 'sc-overlay-btn sc-overlay-btn-primary';
          btn.textContent = _t('lyrics.use_this');
          btn.addEventListener('click', function() {
            var chosen = { lyrics: c.lyrics, syncedLyrics: c.syncedLyrics, source: c.source };
            fetchSeq++;
            applyResult(chosen);
            if (curPrefKey && typeof api.lyricsPref === 'function') api.lyricsPref('setChoice', curPrefKey, chosen).catch(function() {});
            closePicker();
          });
          row.appendChild(btn);
          listEl.appendChild(row);
        });
      }
      function runCandidateSearch(listEl, query) {
        listEl.innerHTML = '<div style="color:var(--sc-text-muted);padding:10px 0;font-size:12px">' + _t('lyrics.searching') + '</div>';
        var forKey = curPrefKey;
        api.lyricsCandidates(curArtist, curTitle, curDur, query || undefined).then(function(items) {
          if (forKey !== curPrefKey) return;
          renderCandidates(listEl, items);
        }).catch(function() { renderCandidates(listEl, []); });
      }
      panel.querySelector('#sc-lyr-other').addEventListener('click', function() {
        if (!curPrefKey) return;
        if (pickerEl.style.display !== 'none') { closePicker(); return; }
        pickerEl.style.display = 'block';
        pickerEl.innerHTML =
          '<div class="sc-lyr-search"><input class="sc-overlay-input" id="sc-lyr-q" placeholder="' + esc(_t('lyrics.query_placeholder')) + '">' +
          '<button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-q-go">' + esc(_t('lyrics.search_versions')) + '</button>' +
          '<button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-lyr-q-reset">' + esc(_t('lyrics.reset_choice')) + '</button></div>' +
          '<div id="sc-lyr-cands"></div>';
        var q = pickerEl.querySelector('#sc-lyr-q');
        var list = pickerEl.querySelector('#sc-lyr-cands');
        q.value = '';
        pickerEl.querySelector('#sc-lyr-q-go').addEventListener('click', function() { runCandidateSearch(list, q.value.trim()); });
        q.addEventListener('keydown', function(e) { if (e.key === 'Enter') runCandidateSearch(list, q.value.trim()); });
        pickerEl.querySelector('#sc-lyr-q-reset').addEventListener('click', function() {
          if (curPrefKey && typeof api.lyricsPref === 'function') api.lyricsPref('setChoice', curPrefKey, null).catch(function() {});
          lastTrack = '';
          closePicker();
          detectAndFetch();
        });
        runCandidateSearch(list, '');
      });

      // ---- Full-screen view ----
      var fsTimer = null;
      var fsLineEls = [];
      var fsActive = -1;

      function injectLyricsStyles() {
        if (document.getElementById('sc-lyrics-extra-style')) return;
        var st = document.createElement('style');
        st.id = 'sc-lyrics-extra-style';
        st.textContent =
          '#sc-lyrics-fs{position:fixed;top:32px;left:0;right:0;bottom:48px;z-index:99990;display:none;overflow:hidden;background:#0b0b0d;color:#fff;font-family:inherit}' +
          '#sc-lyrics-fs.open{display:block;animation:scFsIn .35s ease both}' +
          '@keyframes scFsIn{from{opacity:0}to{opacity:1}}' +
          '#sc-lyrics-fs .sc-fs-bg{position:absolute;inset:-60px;background-size:cover;background-position:center;filter:blur(60px) saturate(1.5) brightness(.5);transform:scale(1.15);transition:background-image .6s}' +
          '#sc-lyrics-fs .sc-fs-shade{position:absolute;inset:0;background:radial-gradient(ellipse at center,rgba(0,0,0,.05),rgba(0,0,0,.55))}' +
          '#sc-lyrics-fs .sc-fs-head{position:absolute;left:36px;top:24px;right:90px;z-index:2;text-shadow:0 2px 12px rgba(0,0,0,.5)}' +
          '#sc-lyrics-fs .sc-fs-title{font-size:20px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '#sc-lyrics-fs .sc-fs-artist{font-size:14px;opacity:.7;margin-top:2px}' +
          '#sc-lyrics-fs .sc-fs-close{position:absolute;right:24px;top:20px;z-index:3;width:38px;height:38px;border-radius:50%;border:0;background:rgba(255,255,255,.14);color:#fff;font-size:20px;cursor:pointer}' +
          '#sc-lyrics-fs .sc-fs-close:hover{background:rgba(255,255,255,.26)}' +
          '#sc-lyrics-fs .sc-fs-body{position:absolute;inset:0;overflow-y:auto;padding:30vh 8vw;text-align:center;scrollbar-width:none;z-index:1}' +
          '#sc-lyrics-fs .sc-fs-body::-webkit-scrollbar{display:none}' +
          '#sc-lyrics-fs .sc-fs-line{font-size:clamp(24px,3.6vw,48px);font-weight:800;line-height:1.25;margin:.55em 0;color:rgba(255,255,255,.3);cursor:pointer;transition:color .35s,transform .35s,filter .35s;transform:scale(.94);filter:blur(1.2px)}' +
          '#sc-lyrics-fs .sc-fs-line:hover{color:rgba(255,255,255,.55)}' +
          '#sc-lyrics-fs .sc-fs-line.active{color:#fff;transform:scale(1);filter:none;text-shadow:0 0 28px rgba(var(--sc-accent-rgb,255,85,0),.55)}' +
          '#sc-lyrics-fs .sc-fs-plain{white-space:pre-wrap;font-size:clamp(18px,2.2vw,28px);font-weight:600;line-height:1.6;color:rgba(255,255,255,.9)}' +
          '#sc-lyrics-fs .sc-fs-msg{opacity:.6;font-size:18px;margin-top:20vh}' +
          '.sc-lyr-tools .sc-lyr-row{display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:8px}' +
          '.sc-lyr-offset{display:flex;align-items:center;gap:6px}.sc-lyr-offset span{min-width:46px;text-align:center;font-size:12px;color:var(--sc-text-muted)}' +
          '.sc-lyr-search{display:flex;gap:6px;margin:6px 0}.sc-lyr-search input{flex:1;min-width:0}' +
          '#sc-lyr-cands{max-height:280px;overflow-y:auto}' +
          '.sc-lyr-cand{display:flex;align-items:center;gap:8px;padding:8px 0;border-top:1px solid var(--sc-border,rgba(255,255,255,.08))}' +
          '.sc-lyr-cand-main{flex:1;min-width:0}.sc-lyr-cand-label{font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
          '.sc-lyr-cand-meta{font-size:11px;color:var(--sc-text-muted)}.sc-lyr-cand-prev{font-size:11px;color:var(--sc-text-subtle,#777);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}';
        document.head.appendChild(st);
      }
      injectLyricsStyles();

      function ensureFs() {
        if (fsEl) return fsEl;
        fsEl = document.createElement('div');
        fsEl.id = 'sc-lyrics-fs';
        fsEl.setAttribute('role', 'dialog');
        fsEl.setAttribute('aria-modal', 'true');
        fsEl.innerHTML = '<div class="sc-fs-bg"></div><div class="sc-fs-shade"></div><button class="sc-fs-close" aria-label="Close">&#10005;</button>' +
          '<div class="sc-fs-head"><div class="sc-fs-title"></div><div class="sc-fs-artist"></div></div><div class="sc-fs-body"></div>';
        document.body.appendChild(fsEl);
        fsEl.querySelector('.sc-fs-close').addEventListener('click', closeFs);
        return fsEl;
      }

      function fsRender() {
        if (!fsOpen || !fsEl) return;
        var art = typeof window.__scFindArtwork === 'function' ? window.__scFindArtwork() : null;
        if (art) fsEl.querySelector('.sc-fs-bg').style.backgroundImage = 'url("' + art + '")';
        fsEl.querySelector('.sc-fs-title').textContent = curTitle;
        fsEl.querySelector('.sc-fs-artist').textContent = curArtist;
        var body = fsEl.querySelector('.sc-fs-body');
        body.scrollTop = 0;
        fsLineEls = [];
        fsActive = -1;
        if (!curResult) { body.innerHTML = '<div class="sc-fs-msg">' + esc(_t('lyrics.not_found')) + '</div>'; return; }
        if (syncedLines && syncedLines.length) {
          var html = '';
          for (var i = 0; i < syncedLines.length; i++) html += '<div class="sc-fs-line" data-i="' + i + '">' + esc(syncedLines[i].text) + '</div>';
          body.innerHTML = html;
          fsLineEls = Array.prototype.slice.call(body.querySelectorAll('.sc-fs-line'));
          fsLineEls.forEach(function(el) {
            el.addEventListener('click', function() {
              var au = window.__scAudioElement;
              var line = syncedLines[Number(el.getAttribute('data-i'))];
              if (au && line) au.currentTime = Math.max(0, line.t - offsetMs / 1000);
            });
          });
        } else {
          body.innerHTML = '<div class="sc-fs-plain">' + esc(curResult.lyrics) + '</div>';
        }
      }

      function fsTick() {
        if (!fsOpen || !fsLineEls.length) return;
        var au = window.__scAudioElement;
        if (!au || !isFinite(au.currentTime)) return;
        var now = au.currentTime + offsetMs / 1000, k = -1;
        for (var i = 0; i < syncedLines.length; i++) { if (syncedLines[i].t <= now) k = i; else break; }
        if (k === fsActive) return;
        if (fsActive >= 0 && fsLineEls[fsActive]) fsLineEls[fsActive].classList.remove('active');
        fsActive = k;
        if (k >= 0 && fsLineEls[k]) {
          var el = fsLineEls[k];
          el.classList.add('active');
          var body = fsEl.querySelector('.sc-fs-body');
          body.scrollTo({ top: el.offsetTop - body.clientHeight / 2 + el.clientHeight / 2, behavior: 'smooth' });
        }
      }

      function openFs() {
        ensureFs();
        fsOpen = true;
        if (typeof window.__scCloseOverlay === 'function') window.__scCloseOverlay();
        fsEl.classList.add('open');
        fsRender();
        if (!fsTimer) fsTimer = setInterval(fsTick, 120);
        startPolling();
      }
      function closeFs() {
        fsOpen = false;
        if (fsEl) fsEl.classList.remove('open');
        if (fsTimer) { clearInterval(fsTimer); fsTimer = null; }
        if (!isPanelActive()) stopPolling();
      }
      window.__scLyricsToggleFs = function() { if (fsOpen) closeFs(); else openFs(); };
      panel.querySelector('#sc-lyr-fs').addEventListener('click', openFs);
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && fsOpen) { e.stopPropagation(); closeFs(); } }, true);

      // A new track should replace the lyrics at once, not on the next 3s poll.
      (function hookTrackEvents() {
        if (window.__scPlayer) window.__scPlayer.on('track', function() { if (isPanelActive()) setTimeout(function() { try { detectAndFetch(); } catch (e) {} }, 250); });
        else setTimeout(hookTrackEvents, 1000);
      })();

      // Lyrics are only useful while their panel is visible. Keep no timer alive
      // for hidden sections/windows and resume with an immediate detection.
      var pollTimer = null;
      var polling = false;
      function isPanelVisible() {
        var container = document.getElementById('sc-overlay-container');
        return !document.hidden && panel.classList.contains('active') && !!(container && container.classList.contains('open'));
      }
      // Lyrics keep updating while the full-screen view is open, even with the sheet closed.
      function isPanelActive() { return isPanelVisible() || (fsOpen && !document.hidden); }
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
      // Reopening the sheet changes the container's class, not the panel's:
      // without this, lyrics stayed on whatever track was playing at close time.
      (function watchContainer() {
        var container = document.getElementById('sc-overlay-container');
        if (!container) { setTimeout(watchContainer, 500); return; }
        new MutationObserver(function() {
          if (isPanelActive()) startPolling(); else stopPolling();
        }).observe(container, { attributes: true, attributeFilter: ['class'] });
      })();
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

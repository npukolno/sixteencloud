import { t, getScriptTranslations } from '../../shared/i18n';

// "Player" panel: promoted-track skipping, playback speed, sleep timer,
// track notifications and ListenBrainz scrobbling.

export function getPlayerToolsOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('player.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-toggle">
        <div>
          <span class="sc-overlay-toggle-label">${t('player.skip_promoted')}</span>
          <div class="sc-pl-desc">${t('player.skip_promoted_desc')}</div>
        </div>
        <label class="sc-overlay-switch"><input type="checkbox" id="sc-pl-skip-promoted"><span class="sc-overlay-switch-slider"></span></label>
      </div>
      <div class="sc-overlay-toggle">
        <div>
          <span class="sc-overlay-toggle-label">${t('player.skip_previews')}</span>
          <div class="sc-pl-desc">${t('player.skip_previews_desc')}</div>
        </div>
        <label class="sc-overlay-switch"><input type="checkbox" id="sc-pl-skip-previews"><span class="sc-overlay-switch-slider"></span></label>
      </div>

      <div class="sc-overlay-group" style="margin-top:16px">
        <span class="sc-overlay-label">${t('player.speed')}</span>
        <div style="display:flex;align-items:center;gap:10px">
          <input type="range" min="0.5" max="2" step="0.05" value="1" id="sc-pl-speed" style="flex:1;accent-color:var(--sc-accent)">
          <span id="sc-pl-speed-val" style="min-width:42px;text-align:right;font-size:12px;color:var(--sc-text-muted)">1.00x</span>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-pl-speed-reset">${t('settings.reset')}</button>
        </div>
      </div>

      <div class="sc-overlay-group" style="margin-top:16px">
        <span class="sc-overlay-label">${t('player.sleep')}</span>
        <div class="sc-pl-chips" id="sc-pl-sleep-chips">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-min="15">15 ${t('player.min')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-min="30">30 ${t('player.min')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-min="45">45 ${t('player.min')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-min="60">60 ${t('player.min')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-min="90">90 ${t('player.min')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-min="track">${t('player.end_of_track')}</button>
        </div>
        <div style="display:flex;align-items:center;gap:10px;margin-top:8px">
          <span id="sc-pl-sleep-status" style="font-size:12px;color:var(--sc-text-muted);flex:1">${t('player.sleep_off')}</span>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-pl-sleep-cancel" style="display:none">${t('player.cancel')}</button>
        </div>
      </div>

      <div class="sc-overlay-toggle" style="margin-top:16px">
        <div>
          <span class="sc-overlay-toggle-label">${t('player.notifications')}</span>
          <div class="sc-pl-desc">${t('player.notifications_desc')}</div>
        </div>
        <label class="sc-overlay-switch"><input type="checkbox" id="sc-pl-notify"><span class="sc-overlay-switch-slider"></span></label>
      </div>

      <div class="sc-overlay-toggle">
        <div>
          <span class="sc-overlay-toggle-label">${t('player.scrobble')}</span>
          <div class="sc-pl-desc">${t('player.scrobble_desc')}</div>
        </div>
        <label class="sc-overlay-switch"><input type="checkbox" id="sc-pl-scrobble"><span class="sc-overlay-switch-slider"></span></label>
      </div>
      <div class="sc-overlay-group" id="sc-pl-scrobble-box" style="display:none">
        <span class="sc-overlay-label">${t('player.lb_token')}</span>
        <div style="display:flex;gap:8px">
          <input type="password" class="sc-overlay-input" id="sc-pl-lb-token" placeholder="${t('player.lb_placeholder')}" style="flex:1">
          <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-pl-lb-save">${t('player.lb_save')}</button>
        </div>
        <div id="sc-pl-lb-status" style="font-size:12px;margin-top:6px;color:var(--sc-text-muted)"></div>
      </div>
    </div>
  `;
}

export function getPlayerToolsOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'player.sleep_off', 'player.sleep_in', 'player.sleep_track', 'player.lb_ok', 'player.lb_bad', 'player.lb_none', 'player.lb_checking',
  ]));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="player"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }
      var api = window.sixteenCloud;
      if (!api) return;

      var style = document.createElement('style');
      style.textContent =
        '.sc-pl-desc{font-size:11px;opacity:.6;margin-top:2px;max-width:320px}' +
        '.sc-pl-chips{display:flex;flex-wrap:wrap;gap:6px}' +
        '.sc-pl-chips .sc-overlay-btn.on{background:var(--sc-accent);color:var(--sc-accent-foreground,#fff)}';
      document.head.appendChild(style);

      function $(id) { return panel.querySelector(id); }
      var skipPromoted = $('#sc-pl-skip-promoted'), skipPreviews = $('#sc-pl-skip-previews');
      var speed = $('#sc-pl-speed'), speedVal = $('#sc-pl-speed-val'), speedReset = $('#sc-pl-speed-reset');
      var notify = $('#sc-pl-notify'), scrobble = $('#sc-pl-scrobble'), scrobbleBox = $('#sc-pl-scrobble-box');
      var lbToken = $('#sc-pl-lb-token'), lbSave = $('#sc-pl-lb-save'), lbStatus = $('#sc-pl-lb-status');
      var sleepChips = $('#sc-pl-sleep-chips'), sleepStatus = $('#sc-pl-sleep-status'), sleepCancel = $('#sc-pl-sleep-cancel');

      function cfg() { return window.__scCfg || {}; }
      function syncUi() {
        var c = cfg();
        skipPromoted.checked = c.skipPromoted !== false;
        skipPreviews.checked = !!c.skipPreviews;
        notify.checked = !!c.notifications;
        scrobble.checked = !!c.scrobble;
        scrobbleBox.style.display = scrobble.checked ? 'block' : 'none';
        speed.value = String(c.speed || 1);
        speedVal.textContent = (Number(speed.value)).toFixed(2) + 'x';
      }
      window.__scOnCfg = function() { syncUi(); applySpeed(); };
      syncUi();

      skipPromoted.addEventListener('change', function() { window.__scCfgSet('skipPromoted', skipPromoted.checked); });
      skipPreviews.addEventListener('change', function() { window.__scCfgSet('skipPreviews', skipPreviews.checked); });
      notify.addEventListener('change', function() { window.__scCfgSet('notifications', notify.checked); });
      scrobble.addEventListener('change', function() {
        window.__scCfgSet('scrobble', scrobble.checked);
        scrobbleBox.style.display = scrobble.checked ? 'block' : 'none';
        if (scrobble.checked) refreshScrobbleStatus();
      });

      // ---- Playback speed ----
      function applySpeed() {
        var au = window.__scAudioElement;
        var v = Number(cfg().speed) || 1;
        if (!au || au.playbackRate === v) return;
        try { au.preservesPitch = true; au.playbackRate = v; } catch (e) {}
      }
      speed.addEventListener('input', function() {
        var v = Number(speed.value);
        speedVal.textContent = v.toFixed(2) + 'x';
        window.__scCfg.speed = v;
        applySpeed();
      });
      speed.addEventListener('change', function() { window.__scCfgSet('speed', Number(speed.value)); });
      speedReset.addEventListener('click', function() { speed.value = '1'; speedVal.textContent = '1.00x'; window.__scCfgSet('speed', 1); applySpeed(); });
      // SoundCloud resets the rate whenever it loads the next stream.
      setInterval(applySpeed, 1500);

      // ---- Sleep timer ----
      var sleepEnd = 0;       // epoch ms, 0 = off
      var sleepTrack = false; // stop at the end of the current track
      var fading = false;

      function fmt(ms) {
        var s = Math.max(0, Math.round(ms / 1000));
        var m = Math.floor(s / 60);
        return m + ':' + ('0' + (s % 60)).slice(-2);
      }
      function sleepUi() {
        Array.prototype.forEach.call(sleepChips.querySelectorAll('button'), function(b) {
          var on = (b.getAttribute('data-min') === 'track') ? sleepTrack : (sleepEnd && b.getAttribute('data-on') === '1');
          b.classList.toggle('on', !!on);
        });
        if (sleepTrack) sleepStatus.textContent = _t('player.sleep_track');
        else if (sleepEnd) sleepStatus.textContent = _t('player.sleep_in').replace('{time}', fmt(sleepEnd - Date.now()));
        else sleepStatus.textContent = _t('player.sleep_off');
        sleepCancel.style.display = (sleepEnd || sleepTrack) ? '' : 'none';
      }
      function sleepClear() {
        sleepEnd = 0; sleepTrack = false;
        Array.prototype.forEach.call(sleepChips.querySelectorAll('button'), function(b) { b.removeAttribute('data-on'); });
        sleepUi();
      }
      function pauseNow() {
        var btn = document.querySelector('.playControls__play.playing');
        if (btn) btn.click();
      }
      function stopWithFade() {
        if (fading) return;
        var au = window.__scAudioElement;
        sleepClear();
        if (!au) { pauseNow(); return; }
        fading = true;
        var v0 = au.volume, steps = 24, i = 0;
        var timer = setInterval(function() {
          i++;
          try { au.volume = Math.max(0, v0 * (1 - i / steps)); } catch (e) {}
          if (i >= steps) {
            clearInterval(timer);
            pauseNow();
            setTimeout(function() { try { au.volume = v0; } catch (e) {} fading = false; }, 400);
          }
        }, 250);
      }
      sleepChips.addEventListener('click', function(e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        var m = b.getAttribute('data-min');
        sleepClear();
        if (m === 'track') sleepTrack = true;
        else { sleepEnd = Date.now() + Number(m) * 60000; b.setAttribute('data-on', '1'); }
        sleepUi();
      });
      sleepCancel.addEventListener('click', sleepClear);
      setInterval(function() {
        if (sleepEnd) {
          if (Date.now() >= sleepEnd) { stopWithFade(); return; }
          sleepUi();
        } else if (sleepTrack) {
          var au = window.__scAudioElement;
          if (au && isFinite(au.duration) && au.duration > 5 && au.duration - au.currentTime < 1.2) stopWithFade();
        }
      }, 500);

      // ---- ListenBrainz ----
      function refreshScrobbleStatus() {
        api.scrobbleStatus().then(function(s) {
          if (s && s.hasToken) { lbStatus.textContent = _t('player.lb_ok') + (s.user ? ' (' + s.user + ')' : ''); lbStatus.style.color = 'var(--sc-success)'; }
          else { lbStatus.textContent = _t('player.lb_none'); lbStatus.style.color = 'var(--sc-text-muted)'; }
        }).catch(function() {});
      }
      lbSave.addEventListener('click', function() {
        var tok = lbToken.value.trim();
        lbStatus.textContent = _t('player.lb_checking'); lbStatus.style.color = 'var(--sc-text-muted)';
        api.scrobbleSetToken(tok).then(function(r) {
          if (r && r.success) { lbToken.value = ''; refreshScrobbleStatus(); }
          else { lbStatus.textContent = _t('player.lb_bad'); lbStatus.style.color = 'var(--sc-danger)'; }
        }).catch(function() { lbStatus.textContent = _t('player.lb_bad'); lbStatus.style.color = 'var(--sc-danger)'; });
      });
      refreshScrobbleStatus();

      // ---- Track notifications + scrobbling ----
      var curTrack = null; // { path, artist, title, start, maxPos, duration }
      function finishTrack() {
        var tr = curTrack;
        curTrack = null;
        if (!tr || !cfg().scrobble) return;
        var dur = tr.duration || 0;
        var need = dur > 0 ? Math.min(dur / 2, 240) : 120;
        if (tr.maxPos >= Math.max(30, need) || (dur > 0 && dur < 30 && tr.maxPos >= dur * 0.9)) {
          api.scrobbleSubmit({ kind: 'listen', artist: tr.artist, title: tr.title, durationMs: dur ? Math.round(dur * 1000) : undefined, listenedAt: Math.floor(tr.start / 1000) });
        }
      }
      function hookPlayer() {
        if (!window.__scPlayer) { setTimeout(hookPlayer, 1000); return; }
        window.__scPlayer.on('track', function(c) {
          finishTrack();
          var au = window.__scAudioElement;
          curTrack = { path: c.path, artist: c.artist, title: c.title, start: Date.now(), maxPos: 0, duration: 0 };
          if (cfg().scrobble) setTimeout(function() {
            if (curTrack && curTrack.path === c.path) api.scrobbleSubmit({ kind: 'now', artist: c.artist, title: c.title });
          }, 1500);
          if (!c.first && cfg().notifications && window.__scPlayer.isPlaying() && !document.hasFocus()) {
            setTimeout(function() {
              var now = window.__scPlayer.current();
              if (now && now.path === c.path) api.notifyTrack({ title: now.title, artist: now.artist, artwork: now.artwork || undefined });
            }, 900);
          }
        });
        setInterval(function() {
          var au = window.__scAudioElement;
          var now = window.__scPlayer.current();
          if (!curTrack || !au || !now || now.path !== curTrack.path || !window.__scPlayer.isPlaying()) return;
          if (isFinite(au.currentTime)) curTrack.maxPos = Math.max(curTrack.maxPos, au.currentTime);
          if (isFinite(au.duration) && au.duration > 1) curTrack.duration = au.duration;
        }, 1000);
      }
      hookPlayer();
      window.addEventListener('beforeunload', finishTrack);
    })();
  `;
}

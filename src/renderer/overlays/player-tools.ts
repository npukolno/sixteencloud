import { t, getScriptTranslations } from '../../shared/i18n';
import { abLoopMark, abLoopTarget, seekTarget, normalizeSeekStep, SEEK_STEPS } from '../../shared/ab-loop';
import { defaultKeybinds } from '../../shared/keybinds';
import { scJs } from '../../shared/sc-selectors';

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
      <div class="sc-overlay-toggle">
        <div>
          <span class="sc-overlay-toggle-label">${t('player.resume')}</span>
          <div class="sc-pl-desc">${t('player.resume_desc')}</div>
        </div>
        <label class="sc-overlay-switch"><input type="checkbox" id="sc-pl-resume"><span class="sc-overlay-switch-slider"></span></label>
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
        <span class="sc-overlay-label">${t('player.seek')}</span>
        <div class="sc-pl-line">
          <span class="sc-pl-sub">${t('player.seek_step')}</span>
          <div class="sc-pl-chips" id="sc-pl-step-chips">
            ${SEEK_STEPS.map(step => `<button class="sc-overlay-btn sc-overlay-btn-secondary" data-step="${step}">${step} ${t('player.sec')}</button>`).join('')}
          </div>
        </div>
        <div class="sc-pl-line" style="margin-top:8px">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-pl-seek-back"></button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-pl-seek-fwd"></button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-pl-ab">${t('player.ab_set_a')}</button>
          <span id="sc-pl-ab-status" class="sc-pl-status">${t('player.ab_off')}</span>
        </div>
        <div class="sc-pl-desc" id="sc-pl-ab-hint" style="margin-top:6px;max-width:none"></div>
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
    'player.sleep_off', 'player.sleep_in', 'player.sleep_track', 'player.sleep_toast',
    'player.sec', 'player.ab_set_a', 'player.ab_set_b', 'player.ab_clear', 'player.ab_off', 'player.ab_waiting', 'player.ab_on',
    'player.ab_toast_a', 'player.ab_toast_on', 'player.ab_toast_off', 'player.ab_hint', 'player.lb_ok', 'player.lb_bad', 'player.lb_none', 'player.lb_checking',
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
        '.sc-pl-chips .sc-overlay-btn.on{background:var(--sc-accent);color:var(--sc-accent-foreground,#fff)}' +
        '.sc-pl-line{display:flex;flex-wrap:wrap;align-items:center;gap:8px}' +
        '.sc-pl-sub{font-size:12px;color:var(--sc-text-muted);min-width:36px}' +
        '.sc-pl-status{font-size:12px;color:var(--sc-text-muted);flex:1;min-width:120px;font-variant-numeric:tabular-nums}' +
        '#sc-pl-ab.on{background:var(--sc-accent);color:var(--sc-accent-foreground,#fff)}' +
        '.sc-ab-band{position:absolute;top:0;bottom:0;pointer-events:none;z-index:1;border-left:2px solid var(--sc-accent);background:rgba(var(--sc-accent-rgb),.22)}' +
        '.sc-ab-band.open{background:none;width:0 !important}';
      document.head.appendChild(style);

      function $(id) { return panel.querySelector(id); }
      var skipPromoted = $('#sc-pl-skip-promoted'), skipPreviews = $('#sc-pl-skip-previews'), resume = $('#sc-pl-resume');
      var speed = $('#sc-pl-speed'), speedVal = $('#sc-pl-speed-val'), speedReset = $('#sc-pl-speed-reset');
      var notify = $('#sc-pl-notify'), scrobble = $('#sc-pl-scrobble'), scrobbleBox = $('#sc-pl-scrobble-box');
      var lbToken = $('#sc-pl-lb-token'), lbSave = $('#sc-pl-lb-save'), lbStatus = $('#sc-pl-lb-status');
      var sleepChips = $('#sc-pl-sleep-chips'), sleepStatus = $('#sc-pl-sleep-status'), sleepCancel = $('#sc-pl-sleep-cancel');

      function cfg() { return window.__scCfg || {}; }
      function syncUi() {
        var c = cfg();
        skipPromoted.checked = c.skipPromoted !== false;
        skipPreviews.checked = !!c.skipPreviews;
        resume.checked = c.resume !== false;
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
      resume.addEventListener('change', function() { window.__scCfgSet('resume', resume.checked); });
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

      // ---- Seek steps and the A-B loop (math in shared/ab-loop.ts) ----
      ${abLoopMark.toString()}
      ${abLoopTarget.toString()}
      ${seekTarget.toString()}
      ${normalizeSeekStep.toString()}

      var TIMELINE = ${scJs('TIMELINE_WRAPPER')};
      var stepChips = $('#sc-pl-step-chips'), seekBackBtn = $('#sc-pl-seek-back'), seekFwdBtn = $('#sc-pl-seek-fwd');
      var abBtn = $('#sc-pl-ab'), abStatus = $('#sc-pl-ab-status'), abHint = $('#sc-pl-ab-hint');
      var loop = null, loopPath = '', loopTimer = null;

      function clock(sec) {
        var s = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
        return (h ? h + ':' + ('0' + m).slice(-2) : String(m)) + ':' + ('0' + r).slice(-2);
      }
      function fill(key, p) { var str = _t(key); for (var k in p) str = str.replace('{' + k + '}', p[k]); return str; }

      // Position from the audio element (precise), else from the timeline.
      function position() {
        var au = window.__scAudioElement;
        if (au && isFinite(au.currentTime) && isFinite(au.duration) && au.duration > 0) return { t: au.currentTime, d: au.duration };
        var w = document.querySelector(TIMELINE);
        if (!w) return null;
        var t = parseFloat(w.getAttribute('aria-valuenow')), d = parseFloat(w.getAttribute('aria-valuemax'));
        return isFinite(t) && isFinite(d) && d > 0 ? { t: t, d: d } : null;
      }
      // While audio is loaded, currentTime seeks to the exact second (the
      // timeline is one pixel per several seconds on a long mix); otherwise
      // go through SoundCloud's own timeline like a click would.
      function seekTo(t) {
        var au = window.__scAudioElement;
        if (au && au.readyState >= 2 && isFinite(au.duration) && au.duration > 0) {
          try { au.currentTime = t; return true; } catch (e) {}
        }
        var p = position();
        return !!(p && typeof window.__scPlayerSeek === 'function' && window.__scPlayerSeek(t / p.d));
      }
      function step() { return normalizeSeekStep(cfg().seekStep); }
      function seekBy(sign) {
        var p = position();
        if (p) seekTo(seekTarget(p.t, sign * step(), p.d));
      }
      function currentPath() {
        var c = window.__scPlayer && window.__scPlayer.current();
        return c ? c.path : '';
      }

      function renderBand() {
        var old = document.querySelector('.sc-ab-band');
        var p = position();
        if (!loop || loop.a === null || !p) { if (old) old.remove(); return; }
        var wrap = document.querySelector(TIMELINE);
        if (!wrap) return;
        var band = old && old.parentNode === wrap ? old : null;
        if (!band) {
          if (old) old.remove();
          if (getComputedStyle(wrap).position === 'static') wrap.style.position = 'relative';
          band = document.createElement('div');
          band.className = 'sc-ab-band';
          wrap.appendChild(band);
        }
        band.classList.toggle('open', loop.b === null);
        band.style.left = (loop.a / p.d * 100) + '%';
        band.style.width = loop.b === null ? '0' : ((loop.b - loop.a) / p.d * 100) + '%';
      }
      function renderAB() {
        var s = step();
        seekBackBtn.textContent = '−' + s + ' ' + _t('player.sec');
        seekFwdBtn.textContent = '+' + s + ' ' + _t('player.sec');
        Array.prototype.forEach.call(stepChips.querySelectorAll('button'), function(b) {
          b.classList.toggle('on', Number(b.getAttribute('data-step')) === s);
        });
        var on = !!(loop && loop.a !== null);
        abBtn.classList.toggle('on', on);
        if (!on) { abBtn.textContent = _t('player.ab_set_a'); abStatus.textContent = _t('player.ab_off'); }
        else if (loop.b === null) { abBtn.textContent = _t('player.ab_set_b'); abStatus.textContent = fill('player.ab_waiting', { a: clock(loop.a) }); }
        else { abBtn.textContent = _t('player.ab_clear'); abStatus.textContent = fill('player.ab_on', { a: clock(loop.a), b: clock(loop.b) }); }
        renderBand();
      }
      function stopLoopTimer() { if (loopTimer) { clearInterval(loopTimer); loopTimer = null; } }
      function clearLoop() { loop = null; stopLoopTimer(); renderAB(); }
      function markAB() {
        var p = position();
        if (!p) return;
        loop = abLoopMark(loop && currentPath() === loopPath ? loop : null, p.t, p.d);
        loopPath = currentPath();
        renderAB();
        var toast = window.__scToast;
        if (loop.a === null) { stopLoopTimer(); if (toast) toast(_t('player.ab_toast_off')); return; }
        if (loop.b === null) { if (toast) toast(fill('player.ab_toast_a', { a: clock(loop.a) })); }
        else if (toast) toast(fill('player.ab_toast_on', { a: clock(loop.a), b: clock(loop.b) }), { kind: 'success' });
        if (!loopTimer) loopTimer = setInterval(function() {
          // A loop belongs to its track: a new track drops it.
          if (currentPath() !== loopPath) { clearLoop(); return; }
          var au = window.__scAudioElement;
          var target = au && !au.paused ? abLoopTarget(loop, au.currentTime, 0.15) : null;
          if (target !== null) seekTo(target);
        }, 100);
      }

      stepChips.addEventListener('click', function(e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        window.__scCfgSet('seekStep', normalizeSeekStep(Number(b.getAttribute('data-step'))));
        renderAB();
      });
      seekBackBtn.addEventListener('click', function() { seekBy(-1); });
      seekFwdBtn.addEventListener('click', function() { seekBy(1); });
      abBtn.addEventListener('click', markAB);
      window.addEventListener('resize', function() { if (loop) renderBand(); });

      // Hotkeys are matched in the main process (registerKeybinds) and land here.
      window.__scKeyAction = function(action) {
        if (action === 'seekBack') seekBy(-1);
        else if (action === 'seekForward') seekBy(1);
        else if (action === 'loopAB') markAB();
      };

      var KEY_DEFAULTS = ${JSON.stringify(defaultKeybinds(process.platform))};
      function keyLabel(combo) {
        return String(combo || '').split('+').map(function(p) {
          return p.replace(/^Key([A-Z])$/, '$1').replace(/^Digit([0-9])$/, '$1').replace(/^Arrow/, '');
        }).join('+');
      }
      function renderHint() {
        api.storeGet('settings.keybinds').then(function(kb) {
          var k = Object.assign({}, KEY_DEFAULTS, kb && typeof kb === 'object' ? kb : {});
          abHint.textContent = fill('player.ab_hint', { back: keyLabel(k.seekBack), fwd: keyLabel(k.seekForward), loop: keyLabel(k.loopAB) });
        }).catch(function() {});
      }
      renderHint();
      renderAB();
      // Settings may have changed the keys while this panel was closed.
      new MutationObserver(function() { if (panel.classList.contains('active')) renderHint(); })
        .observe(panel, { attributes: true, attributeFilter: ['class'] });

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
        var st = window.__scStatus && window.__scStatus.sleep;
        if (window.__scStatusSet && (!st || st.end !== sleepEnd || st.track !== sleepTrack)) {
          window.__scStatusSet('sleep', { end: sleepEnd, track: sleepTrack });
        }
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
        if (window.__scToast) {
          window.__scToast(m === 'track' ? _t('player.sleep_track') : _t('player.sleep_toast').replace('{min}', String(Number(m))));
        }
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

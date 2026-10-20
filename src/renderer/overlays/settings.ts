import { app } from 'electron';
import { t, getScriptTranslations } from '../../shared/i18n';

export function getSettingsOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('settings.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('settings.language')}</span>
        <select class="sc-overlay-select" id="sc-set-language">
          <option value="en">English</option>
          <option value="ru">Русский</option>
        </select>
      </div>

      <div class="sc-overlay-toggle" style="margin-top: 12px;">
        <span class="sc-overlay-toggle-label">${t('settings.start_minimized')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-set-minimized">
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('settings.launch_startup')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-set-startup">
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('settings.accent_color')}</span>
        <div class="sc-color-field">
          <button type="button" class="sc-color-swatch" id="sc-set-accent" aria-label="${t('settings.accent_color')}">
            <span class="sc-color-swatch-fill"></span>
          </button>
          <input class="sc-color-hex" id="sc-set-accent-val" value="#ff5500" spellcheck="false" autocomplete="off" maxlength="7">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-set-accent-reset" style="margin-left: auto;">${t('settings.reset')}</button>
        </div>
        <div class="sc-color-pop" id="sc-set-accent-pop" hidden>
          <div class="sc-color-sv" id="sc-set-accent-sv"><span class="sc-color-sv-handle"></span></div>
          <input type="range" class="sc-color-hue" id="sc-set-accent-hue" min="0" max="360" step="1" value="16">
          <div class="sc-color-presets" id="sc-set-accent-presets"></div>
        </div>
      </div>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('settings.keyboard_shortcuts')}</span>
        <div style="font-size: 12px; color: #888; margin-bottom: 8px;">${t('settings.press_new_key')}</div>
        <div id="sc-set-keybinds">
          <div class="sc-overlay-list-item">
            <span class="sc-overlay-list-item-title">${t('settings.bookmarks_sidebar')}</span>
            <span class="sc-overlay-badge">Ctrl+B</span>
          </div>
          <div class="sc-overlay-list-item">
            <span class="sc-overlay-list-item-title">${t('settings.play_pause')}</span>
            <span class="sc-overlay-badge">Space</span>
          </div>
          <div class="sc-overlay-list-item">
            <span class="sc-overlay-list-item-title">${t('settings.volume')}</span>
            <span class="sc-overlay-badge">Ctrl+Up/Down</span>
          </div>
          <div class="sc-overlay-list-item">
            <span class="sc-overlay-list-item-title">${t('settings.close_panel')}</span>
            <span class="sc-overlay-badge">Esc</span>
          </div>
        </div>
      </div>

      <div class="sc-overlay-toggle" style="margin-top: 16px;">
        <span class="sc-overlay-toggle-label">${t('settings.visualizer')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-set-visualizer" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div id="sc-set-visualizer-type-group" style="margin-left: 24px; margin-top: 8px; display: none;">
        <span class="sc-overlay-label" style="font-size: 12px;">${t('settings.visualizer_type')}</span>
        <div class="sc-custom-dropdown" id="sc-set-visualizer-type-dropdown" style="margin-top: 4px;">
          <div class="sc-custom-dropdown-trigger" id="sc-set-visualizer-type-trigger">
            <span id="sc-set-visualizer-type-value">${t('settings.viz_side')}</span>
            <svg class="sc-custom-dropdown-arrow" width="12" height="12" viewBox="0 0 12 12">
              <path fill="currentColor" d="M6 8L1 3h10z"/>
            </svg>
          </div>
          <div class="sc-custom-dropdown-menu" id="sc-set-visualizer-type-menu">
            <div class="sc-custom-dropdown-item" data-value="side">${t('settings.viz_side')}</div>
            <div class="sc-custom-dropdown-item" data-value="above">${t('settings.viz_above')}</div>
            <div class="sc-custom-dropdown-item" data-value="wave">${t('settings.viz_wave')}</div>
            <div class="sc-custom-dropdown-item" data-value="glow">${t('settings.viz_glow')}</div>
          </div>
        </div>
      </div>

      <div class="sc-overlay-toggle" style="margin-top: 16px;">
        <span class="sc-overlay-toggle-label">${t('settings.auto_update')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-set-autoupdate" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-group" style="margin-top: 8px;">
        <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-set-check-update">
          ${t('settings.check_updates')}
        </button>
        <div style="font-size: 12px; color: #888; margin-top: 6px;" id="sc-set-update-status"></div>
        <button class="sc-overlay-btn sc-overlay-btn-primary sc-overlay-btn-full" id="sc-set-download-update" style="display:none;margin-top:6px;"></button>
        <div id="sc-set-update-progress" style="display:none;margin-top:6px;width:100%;height:6px;background:#333;border-radius:3px;overflow:hidden;">
          <div id="sc-set-update-progress-fill" style="height:100%;width:0%;background:#f50;border-radius:3px;transition:width 0.3s;"></div>
        </div>
      </div>

      <div class="sc-overlay-group" style="margin-top: 20px;">
        <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-set-clear-cache">
          ${t('settings.clear_cache')}
        </button>
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px;">
        <button class="sc-overlay-btn sc-overlay-btn-danger sc-overlay-btn-full" id="sc-set-reset">
          ${t('settings.reset_all')}
        </button>
      </div>

      <div style="text-align: center; margin-top: 20px; color: #666; font-size: 12px;">
        SixteenCloud v${app.getVersion()}
      </div>
    </div>
  `;
}

export function getSettingsOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'settings.checking', 'settings.update_available', 'settings.up_to_date',
    'settings.check_failed', 'settings.clearing', 'settings.cache_cleared',
    'settings.clear_cache', 'settings.reset_confirm',
    'settings.download_update', 'settings.downloading_update', 'settings.restart_to_update',
    'common.yes', 'common.no',
  ]));
  const _appVersion = app.getVersion();
  return `
    (function() {
      const panel = document.querySelector('[data-overlay="settings"]');
      if (!panel || panel.dataset.initialized) return;
      var _currentVersion = '${_appVersion}';
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) { for (var pk in p) s = s.replace('{' + pk + '}', p[pk]); } return s; }

      const api = window.sixteenCloud;
      if (!api) return;

      const langSelect = panel.querySelector('#sc-set-language');
      const minimized = panel.querySelector('#sc-set-minimized');
      const startup = panel.querySelector('#sc-set-startup');
      const accentSwatch = panel.querySelector('#sc-set-accent');
      const accentHex = panel.querySelector('#sc-set-accent-val');
      const accentReset = panel.querySelector('#sc-set-accent-reset');
      const accentPop = panel.querySelector('#sc-set-accent-pop');
      const accentSv = panel.querySelector('#sc-set-accent-sv');
      const accentSvHandle = accentSv.querySelector('.sc-color-sv-handle');
      const accentHue = panel.querySelector('#sc-set-accent-hue');
      const accentPresets = panel.querySelector('#sc-set-accent-presets');
      const clearCache = panel.querySelector('#sc-set-clear-cache');
      const resetAll = panel.querySelector('#sc-set-reset');
      const visualizer = panel.querySelector('#sc-set-visualizer');
      const visualizerTypeGroup = panel.querySelector('#sc-set-visualizer-type-group');
      const visualizerTypeDropdown = panel.querySelector('#sc-set-visualizer-type-dropdown');
      const visualizerTypeTrigger = panel.querySelector('#sc-set-visualizer-type-trigger');
      const visualizerTypeValue = panel.querySelector('#sc-set-visualizer-type-value');
      const visualizerTypeMenu = panel.querySelector('#sc-set-visualizer-type-menu');
      const visualizerTypeItems = panel.querySelectorAll('.sc-custom-dropdown-item');
      const autoUpdate = panel.querySelector('#sc-set-autoupdate');
      const checkUpdateBtn = panel.querySelector('#sc-set-check-update');
      const updateStatus = panel.querySelector('#sc-set-update-status');

      // Custom dropdown state
      let currentVisualizerType = 'side';

      // Dropdown toggle
      visualizerTypeTrigger.addEventListener('click', function(e) {
        e.stopPropagation();
        visualizerTypeDropdown.classList.toggle('open');
      });

      // Close dropdown when clicking outside
      document.addEventListener('click', function(e) {
        if (!visualizerTypeDropdown.contains(e.target)) {
          visualizerTypeDropdown.classList.remove('open');
        }
      });

      // Dropdown item selection
      visualizerTypeItems.forEach(function(item) {
        item.addEventListener('click', function() {
          const value = item.getAttribute('data-value');
          const text = item.textContent;

          // Update UI
          visualizerTypeValue.textContent = text;
          visualizerTypeItems.forEach(function(i) { i.classList.remove('selected'); });
          item.classList.add('selected');
          visualizerTypeDropdown.classList.remove('open');

          // Update store and visualizer
          currentVisualizerType = value;
          api.storeGet('visualizer').then(function(v) {
            var state = Object.assign({ enabled: true, type: 'side', version: 2 }, v || {});
            state.type = value;
            api.storeSet('visualizer', state);
            if (typeof window.__scVizSetType === 'function') window.__scVizSetType(state.type);
          });
        });
      });

      // Load language
      api.storeGet('language').then(function(lang) {
        langSelect.value = lang || 'en';
      });

      langSelect.addEventListener('change', function() {
        api.storeSet('language', langSelect.value).then(function() {
          window.location.reload();
        });
      });

      // Visualizer is on by default; only an explicit false disables it.
      api.storeGet('visualizer').then(function(v) {
        visualizer.checked = !v || v.enabled !== false;
        const vizType = (v && v.type) || 'side';
        currentVisualizerType = vizType;

        // Update dropdown UI
        visualizerTypeItems.forEach(function(item) {
          if (item.getAttribute('data-value') === vizType) {
            visualizerTypeValue.textContent = item.textContent;
            item.classList.add('selected');
          }
        });

        visualizerTypeGroup.style.display = visualizer.checked ? 'block' : 'none';
      });

      visualizer.addEventListener('change', function() {
        visualizerTypeGroup.style.display = visualizer.checked ? 'block' : 'none';
        api.storeGet('visualizer').then(function(v) {
          var state = Object.assign({ enabled: true, type: 'side', version: 2 }, v || {});
          state.enabled = visualizer.checked;
          api.storeSet('visualizer', state);
          if (typeof window.__scVizSetEnabled === 'function') window.__scVizSetEnabled(state.enabled);
        });
      });

      // Load settings
      api.storeGet('settings').then(function(s) {
        if (!s) return;
        minimized.checked = s.startMinimized || false;
        startup.checked = s.launchOnStartup || false;
        var loaded = _hexToHsv(s.accentColor || '#ff5500');
        if (loaded) _hsv = loaded;
        _renderAccent(true);
        window.scApplyAccent(_hsvToHex(_hsv.h, _hsv.s, _hsv.v));
        autoUpdate.checked = s.autoUpdate !== false;
      });

      minimized.addEventListener('change', function() {
        api.storeSet('settings.startMinimized', minimized.checked);
      });

      startup.addEventListener('change', function() {
        api.storeSet('settings.launchOnStartup', startup.checked);
      });

      // ---- Accent colour picker (custom HSV picker, no native <input type=color>) ----
      function _hexToHsv(hex) {
        var m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return null;
        var raw = m[1];
        if (raw.length === 3) raw = raw[0] + raw[0] + raw[1] + raw[1] + raw[2] + raw[2];
        var r = parseInt(raw.slice(0, 2), 16) / 255,
            g = parseInt(raw.slice(2, 4), 16) / 255,
            b = parseInt(raw.slice(4, 6), 16) / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b), d = max - min, h = 0;
        if (d) {
          if (max === r) h = ((g - b) / d) % 6;
          else if (max === g) h = (b - r) / d + 2;
          else h = (r - g) / d + 4;
          h *= 60;
          if (h < 0) h += 360;
        }
        return { h: h, s: max ? d / max : 0, v: max };
      }

      function _hsvToRgb(h, s, v) {
        var c = v * s, x = c * (1 - Math.abs((h / 60) % 2 - 1)), m = v - c, r, g, b;
        if (h < 60) { r = c; g = x; b = 0; }
        else if (h < 120) { r = x; g = c; b = 0; }
        else if (h < 180) { r = 0; g = c; b = x; }
        else if (h < 240) { r = 0; g = x; b = c; }
        else if (h < 300) { r = x; g = 0; b = c; }
        else { r = c; g = 0; b = x; }
        return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
      }

      function _hsvToHex(h, s, v) {
        return '#' + _hsvToRgb(h, s, v).map(function(n) {
          return ('0' + n.toString(16)).slice(-2);
        }).join('');
      }

      var _hsv = { h: 16, s: 1, v: 1 };

      function _renderAccent(silent) {
        var hex = _hsvToHex(_hsv.h, _hsv.s, _hsv.v);
        accentSv.style.setProperty('--cb-h', _hsv.h);
        accentSvHandle.style.setProperty('--cb-sv', hex);
        accentSvHandle.style.left = (_hsv.s * 100) + '%';
        accentSvHandle.style.top = ((1 - _hsv.v) * 100) + '%';
        accentHue.value = String(Math.round(_hsv.h));
        if (document.activeElement !== accentHex) accentHex.value = hex;
        if (!silent) window.scApplyAccent(hex);
        return hex;
      }

      var accentSaveTimer = null;
      function saveAccent(value) {
        if (accentSaveTimer) clearTimeout(accentSaveTimer);
        accentSaveTimer = setTimeout(function() {
          api.storeSet('settings.accentColor', value);
          accentSaveTimer = null;
        }, 150);
      }

      function _commitAccent() {
        var hex = _renderAccent();
        saveAccent(hex);
      }

      var _svDragging = false;
      function _svFromEvent(e) {
        var r = accentSv.getBoundingClientRect();
        if (!r.width || !r.height) return;
        var x = Math.min(Math.max(e.clientX - r.left, 0), r.width);
        var y = Math.min(Math.max(e.clientY - r.top, 0), r.height);
        _hsv.s = x / r.width;
        _hsv.v = 1 - y / r.height;
        _commitAccent();
      }

      accentSv.addEventListener('pointerdown', function(e) {
        _svDragging = true;
        try { accentSv.setPointerCapture(e.pointerId); } catch (_) {}
        _svFromEvent(e);
      });
      accentSv.addEventListener('pointermove', function(e) { if (_svDragging) _svFromEvent(e); });
      accentSv.addEventListener('pointerup', function(e) {
        _svDragging = false;
        try { accentSv.releasePointerCapture(e.pointerId); } catch (_) {}
      });
      accentSv.addEventListener('pointercancel', function() { _svDragging = false; });

      accentHue.addEventListener('input', function() {
        _hsv.h = Number(accentHue.value) || 0;
        _commitAccent();
      });

      accentHex.addEventListener('change', function() {
        var parsed = _hexToHsv(accentHex.value);
        if (!parsed) { _renderAccent(true); return; }
        _hsv = parsed;
        _commitAccent();
      });
      accentHex.addEventListener('keydown', function(e) { if (e.key === 'Enter') accentHex.blur(); });

      accentSwatch.addEventListener('click', function(e) {
        e.stopPropagation();
        accentPop.hidden = !accentPop.hidden;
        if (!accentPop.hidden) _renderAccent(true);
      });
      accentPop.addEventListener('click', function(e) { e.stopPropagation(); });
      document.addEventListener('click', function() { accentPop.hidden = true; });
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape') accentPop.hidden = true; });

      ['#ff5500', '#f43f5e', '#a855f7', '#6366f1', '#3b82f6', '#06b6d4', '#22c55e', '#eab308', '#f97316', '#e2e8f0']
        .forEach(function(c) {
          var b = document.createElement('button');
          b.type = 'button';
          b.className = 'sc-color-preset';
          b.style.background = c;
          b.title = c;
          b.addEventListener('click', function() {
            var p = _hexToHsv(c);
            if (p) { _hsv = p; _commitAccent(); }
          });
          accentPresets.appendChild(b);
        });

      accentReset.addEventListener('click', function() {
        if (accentSaveTimer) { clearTimeout(accentSaveTimer); accentSaveTimer = null; }
        _hsv = _hexToHsv('#ff5500') || { h: 16, s: 1, v: 1 };
        _renderAccent();
        api.storeSet('settings.accentColor', '#ff5500');
      });

      _renderAccent(true);

      autoUpdate.addEventListener('change', function() {
        api.storeSet('settings.autoUpdate', autoUpdate.checked);
      });

      var downloadBtn = panel.querySelector('#sc-set-download-update');
      var progressWrap = panel.querySelector('#sc-set-update-progress');
      var progressFill = panel.querySelector('#sc-set-update-progress-fill');
      var _foundVersion = '';

      checkUpdateBtn.addEventListener('click', function() {
        checkUpdateBtn.disabled = true;
        updateStatus.textContent = _t('settings.checking');
        api.updaterCheck().then(function(result) {
          checkUpdateBtn.disabled = false;
          if (result && result.available && result.version !== _currentVersion) {
            _foundVersion = result.version;
            updateStatus.textContent = _t('settings.update_available', {version: result.version});
            updateStatus.style.color = '#2ecc71';
            downloadBtn.textContent = _t('settings.download_update', {version: result.version});
            downloadBtn.style.display = 'block';
          } else {
            updateStatus.textContent = _t('settings.up_to_date');
            updateStatus.style.color = '#888';
            downloadBtn.style.display = 'none';
          }
        }).catch(function() {
          checkUpdateBtn.disabled = false;
          updateStatus.textContent = _t('settings.check_failed');
          updateStatus.style.color = '#e74c3c';
        });
      });

      downloadBtn.addEventListener('click', function() {
        downloadBtn.disabled = true;
        downloadBtn.style.opacity = '0.6';
        progressWrap.style.display = 'block';
        updateStatus.textContent = _t('settings.downloading_update', {percent: '0'});
        api.updaterDownload();
      });

      api.onUpdaterProgress(function(p) {
        var pct = Math.round(p.percent);
        updateStatus.textContent = _t('settings.downloading_update', {percent: pct});
        progressFill.style.width = pct + '%';
      });

      api.onUpdaterStatus(function(status) {
        if (status && status.downloaded) {
          progressWrap.style.display = 'none';
          updateStatus.textContent = '';
          downloadBtn.textContent = _t('settings.restart_to_update');
          downloadBtn.disabled = false;
          downloadBtn.style.opacity = '1';
          downloadBtn.onclick = function() { api.updaterInstall(); };
        }
      });

      clearCache.addEventListener('click', function() {
        clearCache.disabled = true;
        clearCache.textContent = _t('settings.clearing');
        api.settingsClearCache().then(function() {
          clearCache.textContent = _t('settings.cache_cleared');
          setTimeout(function() {
            clearCache.textContent = _t('settings.clear_cache');
            clearCache.disabled = false;
          }, 2000);
        });
      });

      resetAll.addEventListener('click', function() {
        var existing = panel.querySelector('#sc-confirm-reset');
        if (existing) { existing.remove(); return; }
        var box = document.createElement('div');
        box.id = 'sc-confirm-reset';
        box.style.cssText = 'margin-top:8px;padding:10px;background:#2a1a1a;border:1px solid #e74c3c;border-radius:6px;display:flex;align-items:center;justify-content:space-between;';
        box.innerHTML = '<span style="color:#e74c3c;font-size:12px;">' + _t('settings.reset_confirm') + '</span><div style="display:flex;gap:6px;"><button id="sc-confirm-yes" style="background:#e74c3c;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">' + _t('common.yes') + '</button><button id="sc-confirm-no" style="background:#333;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">' + _t('common.no') + '</button></div>';
        resetAll.parentNode.insertBefore(box, resetAll.nextSibling);
        box.querySelector('#sc-confirm-yes').onclick = function() {
          api.storeSet('settings', { startMinimized: false, launchOnStartup: false, accentColor: '#ff5500', autoUpdate: true, keybinds: {} }).then(function() {
            minimized.checked = false; startup.checked = false;
            _hsv = _hexToHsv('#ff5500') || { h: 16, s: 1, v: 1 };
            _renderAccent();
          });
          box.remove();
        };
        box.querySelector('#sc-confirm-no').onclick = function() { box.remove(); };
      });

    })();
  `;
}

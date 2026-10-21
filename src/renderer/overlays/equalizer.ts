import { t, getScriptTranslations } from '../../shared/i18n';

export function getEqualizerOverlayHTML(): string {
  const freqs = ['32', '64', '125', '250', '500', '1k', '2k', '4k', '8k', '16k'];
  const sliders = freqs.map(function(f, i) {
    return `
      <div class="sc-eq-band">
        <input type="range" min="-12" max="12" value="0" orient="vertical" class="sc-eq-slider" data-band="${i}">
        <span class="sc-eq-freq">${f}</span>
      </div>`;
  }).join('');

  return `
    <div class="sc-overlay-header">
      <h2>${t('eq.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('eq.enable')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-eq-enabled">
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div id="sc-eq-status" style="font-size: 12px; color: #555; margin-top: 4px; margin-bottom: 8px;">
        ${t('eq.audio_hint')}
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px;">
        <span class="sc-overlay-label">${t('eq.preset')}</span>
        <select class="sc-overlay-select" id="sc-eq-preset">
          <option value="flat">${t('eq.flat')}</option>
          <option value="bass">${t('eq.bass')}</option>
          <option value="treble">${t('eq.treble')}</option>
          <option value="vocal">${t('eq.vocal')}</option>
          <option value="rock">${t('eq.rock')}</option>
          <option value="electronic">${t('eq.electronic')}</option>
        </select>
      </div>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('eq.bands')}</span>
        <div class="sc-eq-bands" id="sc-eq-bands">
          ${sliders}
        </div>
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px; display: flex; flex-direction: column; gap: 14px;">
        <input type="text" class="sc-overlay-input" id="sc-eq-custom-name" placeholder="${t('eq.preset_name')}" style="width: 100%;">
        <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-eq-save-custom" style="align-self: flex-start;">${t('eq.save')}</button>
      </div>

      <div class="sc-overlay-group" style="margin-top: 8px;" id="sc-eq-custom-presets"></div>
    </div>
  `;
}

export function getEqualizerOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'eq.active', 'eq.waiting',
  ]));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="equalizer"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      var api = window.sixteenCloud;
      if (!api) return;

      var FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
      var PRESETS = {
        flat: [0,0,0,0,0,0,0,0,0,0],
        bass: [6,5,4,2,1,0,0,0,0,0],
        treble: [0,0,0,0,0,1,2,4,5,6],
        vocal: [-2,-1,0,2,4,4,3,1,0,-1],
        rock: [4,3,1,0,-1,0,2,3,4,4],
        electronic: [4,3,1,0,-1,-1,0,2,4,5]
      };

      var enabledToggle = panel.querySelector('#sc-eq-enabled');
      var presetSelect = panel.querySelector('#sc-eq-preset');
      var sliders = panel.querySelectorAll('.sc-eq-slider');
      var saveBtn = panel.querySelector('#sc-eq-save-custom');
      var customName = panel.querySelector('#sc-eq-custom-name');
      var customContainer = panel.querySelector('#sc-eq-custom-presets');
      var statusEl = panel.querySelector('#sc-eq-status');

      var filters = [];
      var customPresets = {};
      var filtersConnected = false;

      function setupFilters() {
        if (filtersConnected) return true;
        var ctx = window.__scAudioContext;
        var source = window.__scAudioSource;
        var analyser = window.__scAudioAnalyser;
        if (!ctx || !source) return false;

        try {
          try { source.disconnect(); } catch(e) {}
          try { if (analyser) analyser.disconnect(); } catch(e) {}

          filters = FREQS.map(function(freq) {
            var filter = ctx.createBiquadFilter();
            filter.type = 'peaking';
            filter.frequency.value = freq;
            filter.Q.value = 1.4;
            filter.gain.value = 0;
            return filter;
          });

          var chain = source;
          filters.forEach(function(f) {
            chain.connect(f);
            chain = f;
          });
          if (analyser) {
            chain.connect(analyser);
            analyser.connect(ctx.destination);
          } else {
            chain.connect(ctx.destination);
          }

          window.__scEqFilters = filters;
          filtersConnected = true;
          statusEl.textContent = _t('eq.active');
          statusEl.style.color = 'var(--sc-success)';
          return true;
        } catch(e) {
          console.log('[EQ] Setup error:', e);
          statusEl.textContent = 'Error: ' + e.message;
          statusEl.style.color = 'var(--sc-danger)';
          return false;
        }
      }

      function applyBands(bands) {
        if (!filters.length) return;
        bands.forEach(function(gain, i) {
          if (filters[i]) filters[i].gain.value = gain;
        });
      }

      function flattenBands() {
        filters.forEach(function(f) { f.gain.value = 0; });
      }

      function updateSliders(bands) {
        sliders.forEach(function(s, i) { s.value = bands[i] || 0; });
      }

      function getBands() {
        var bands = [];
        sliders.forEach(function(s) { bands.push(parseInt(s.value)); });
        return bands;
      }

      var saveTimer = null;
      function saveState() {
        if (saveTimer) clearTimeout(saveTimer);
        var state = {
          enabled: enabledToggle.checked,
          preset: presetSelect.value,
          bands: getBands(),
          customPresets: customPresets
        };
        saveTimer = setTimeout(function() {
          api.storeSet('equalizer', state);
          saveTimer = null;
        }, 150);
      }

      function trySetup() {
        if (!setupFilters()) {
          statusEl.textContent = _t('eq.waiting');
          statusEl.style.color = 'var(--sc-warning)';
          setTimeout(trySetup, 2000);
          return;
        }
        if (enabledToggle.checked) applyBands(getBands());
      }

      function renderCustomPresets() {
        var html = '';
        for (var name in customPresets) {
          html += '<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--sc-border)">' +
            '<span style="color:var(--sc-text);font-size:13px;cursor:pointer" class="sc-eq-custom-apply" data-name="' + window.__scEscapeHtml(name) + '">' + window.__scEscapeHtml(name) + '</span>' +
            '<button class="sc-overlay-btn-icon sc-eq-custom-del" data-name="' + window.__scEscapeHtml(name) + '" style="font-size:14px" data-sc-icon="x" aria-label="Remove"></button></div>';
        }
        customContainer.innerHTML = html;

        customContainer.querySelectorAll('.sc-eq-custom-apply').forEach(function(el) {
          el.addEventListener('click', function() {
            var n = el.getAttribute('data-name');
            if (customPresets[n]) { updateSliders(customPresets[n]); applyBands(customPresets[n]); presetSelect.value = 'flat'; saveState(); }
          });
        });
        customContainer.querySelectorAll('.sc-eq-custom-del').forEach(function(el) {
          el.addEventListener('click', function() {
            delete customPresets[el.getAttribute('data-name')];
            renderCustomPresets();
            saveState();
          });
        });
      }

      // Load state
      api.storeGet('equalizer').then(function(state) {
        if (!state) return;
        enabledToggle.checked = !!state.enabled;
        presetSelect.value = state.preset || 'flat';
        customPresets = state.customPresets || {};
        if (state.bands && state.bands.length === 10) updateSliders(state.bands);
        renderCustomPresets();
        if (state.enabled) trySetup();
      });

      enabledToggle.addEventListener('change', function() {
        if (enabledToggle.checked) {
          if (setupFilters()) applyBands(getBands());
          else trySetup();
        } else {
          if (filtersConnected) flattenBands();
        }
        saveState();
      });

      presetSelect.addEventListener('change', function() {
        var preset = PRESETS[presetSelect.value] || PRESETS.flat;
        updateSliders(preset);
        if (enabledToggle.checked && filtersConnected) applyBands(preset);
        saveState();
      });

      sliders.forEach(function(s) {
        s.addEventListener('input', function() {
          if (enabledToggle.checked && filtersConnected) applyBands(getBands());
          saveState();
        });
      });

      saveBtn.addEventListener('click', function() {
        var name = customName.value.trim();
        if (!name) return;
        customPresets[name] = getBands();
        customName.value = '';
        renderCustomPresets();
        saveState();
      });
    })();
  `;
}

import { t, getScriptTranslations } from '../../shared/i18n';

export function getGeoBypassOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('geo.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('geo.enable')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-geo-toggle" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-status" id="sc-geo-status">
        <span class="sc-overlay-status-dot gray" id="sc-geo-status-dot"></span>
        <span class="sc-overlay-status-text" id="sc-geo-status-text">${t('geo.no_proxy')}</span>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('geo.target_country')}</span>
        <select class="sc-overlay-select" id="sc-geo-country">
          <option value="US" selected>${t('geo.us')}</option>
          <option value="GB">${t('geo.gb')}</option>
          <option value="DE">${t('geo.de')}</option>
          <option value="FR">${t('geo.fr')}</option>
          <option value="JP">${t('geo.jp')}</option>
          <option value="CA">${t('geo.ca')}</option>
          <option value="AU">${t('geo.au')}</option>
          <option value="NL">${t('geo.nl')}</option>
          <option value="SE">${t('geo.se')}</option>
          <option value="BR">${t('geo.br')}</option>
        </select>
        <div class="sc-overlay-hint">${t('geo.lang_hint')}</div>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('geo.proxy_label')}</span>
        <input type="text" class="sc-overlay-input" id="sc-geo-proxy" placeholder="${t('geo.proxy_placeholder')}">
        <div class="sc-overlay-hint">${t('geo.proxy_hint')}</div>
        <div style="display: flex; gap: 8px; margin-top: 10px;">
          <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-geo-apply" style="flex:1">${t('geo.apply_reload')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-geo-test">${t('geo.test')}</button>
        </div>
      </div>

      <div id="sc-geo-test-result" class="sc-overlay-status" style="display: none;">
        <span class="sc-overlay-status-dot gray" id="sc-geo-test-dot"></span>
        <span class="sc-overlay-status-text" id="sc-geo-test-text"></span>
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px;">
        <button class="sc-overlay-btn sc-overlay-btn-danger sc-overlay-btn-full" id="sc-geo-clear" style="display:none;">${t('geo.remove_proxy')}</button>
      </div>
    </div>
  `;
}

export function getGeoBypassOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'geo.disabled', 'geo.proxy_active', 'geo.header_only', 'geo.applying',
    'geo.applied', 'geo.apply_reload', 'geo.testing', 'geo.reachable',
    'geo.unreachable', 'geo.test_failed',
  ]));
  return `
    (function() {
      const panel = document.querySelector('[data-overlay="geo-bypass"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) { for (var pk in p) s = s.replace('{' + pk + '}', p[pk]); } return s; }

      const api = window.sixteenCloud;
      if (!api) return;

      const toggle = panel.querySelector('#sc-geo-toggle');
      const countrySelect = panel.querySelector('#sc-geo-country');
      const proxyInput = panel.querySelector('#sc-geo-proxy');
      const applyBtn = panel.querySelector('#sc-geo-apply');
      const testBtn = panel.querySelector('#sc-geo-test');
      const clearBtn = panel.querySelector('#sc-geo-clear');
      const statusDot = panel.querySelector('#sc-geo-status-dot');
      const statusText = panel.querySelector('#sc-geo-status-text');
      const testResult = panel.querySelector('#sc-geo-test-result');
      const testDot = panel.querySelector('#sc-geo-test-dot');
      const testText = panel.querySelector('#sc-geo-test-text');

      // Load state
      api.storeGet('geoBypass').then(function(state) {
        if (!state) return;
        toggle.checked = state.enabled;
        countrySelect.value = state.spoofCountry || 'US';
        proxyInput.value = state.proxyUrl || '';
        updateStatus(state.enabled, state.proxyUrl, state.spoofCountry);
      });

      function updateStatus(enabled, proxyUrl, country) {
        if (!enabled) {
          statusDot.className = 'sc-overlay-status-dot gray';
          statusText.textContent = _t('geo.disabled');
          clearBtn.style.display = 'none';
        } else if (proxyUrl) {
          statusDot.className = 'sc-overlay-status-dot green';
          statusText.textContent = _t('geo.proxy_active', {country: country});
          clearBtn.style.display = 'block';
        } else {
          statusDot.className = 'sc-overlay-status-dot yellow';
          statusText.textContent = _t('geo.header_only');
          clearBtn.style.display = 'none';
        }
      }

      toggle.addEventListener('change', function() {
        api.storeSet('geoBypass.enabled', toggle.checked);
        updateStatus(toggle.checked, proxyInput.value.trim(), countrySelect.value);
      });

      applyBtn.addEventListener('click', function() {
        var proxy = proxyInput.value.trim();
        var country = countrySelect.value;
        applyBtn.disabled = true;
        applyBtn.textContent = _t('geo.applying');
        api.geoSetProxy(proxy, country).then(function() {
          updateStatus(toggle.checked, proxy, country);
          applyBtn.textContent = _t('geo.applied');
          setTimeout(function() {
            window.location.reload();
          }, 500);
          setTimeout(function() {
            applyBtn.disabled = false;
            applyBtn.textContent = _t('geo.apply_reload');
          }, 2000);
        });
      });

      clearBtn.addEventListener('click', function() {
        proxyInput.value = '';
        api.geoSetProxy('', countrySelect.value).then(function() {
          updateStatus(toggle.checked, '', countrySelect.value);
          window.location.reload();
        });
      });

      testBtn.addEventListener('click', function() {
        testResult.style.display = 'flex';
        testDot.className = 'sc-overlay-status-dot yellow';
        testText.textContent = _t('geo.testing');
        var proxy = proxyInput.value.trim();
        api.geoTestProxy(proxy).then(function(ok) {
          testDot.className = 'sc-overlay-status-dot ' + (ok ? 'green' : 'red');
          testText.textContent = ok ? _t('geo.reachable') : _t('geo.unreachable');
        }).catch(function() {
          testDot.className = 'sc-overlay-status-dot red';
          testText.textContent = _t('geo.test_failed');
        });
      });
    })();
  `;
}

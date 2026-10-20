import { t, getScriptTranslations } from '../../shared/i18n';

export function getOfflineOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('offline.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-group">
        <div class="sc-overlay-toggle" style="margin-bottom: 12px;">
          <span class="sc-overlay-toggle-label">${t('offline.enable')}</span>
          <label class="sc-overlay-switch">
            <input type="checkbox" id="sc-offline-enabled">
            <span class="sc-overlay-switch-slider"></span>
          </label>
        </div>
        <div class="sc-overlay-toggle" style="margin-bottom: 12px;">
          <span class="sc-overlay-toggle-label">${t('offline.autocache')}</span>
          <label class="sc-overlay-switch">
            <input type="checkbox" id="sc-offline-autocache">
            <span class="sc-overlay-switch-slider"></span>
          </label>
        </div>
        <div style="margin-bottom: 12px;">
          <span class="sc-overlay-label">${t('offline.max_size')}: <span id="sc-offline-maxsize-label">500</span> MB</span>
          <input type="range" id="sc-offline-maxsize" min="100" max="2000" step="100" value="500" style="width: 100%; margin-top: 6px; accent-color: #f50;">
        </div>
        <div id="sc-offline-status" style="color: #888; font-size: 13px; margin-bottom: 12px;"></div>
      </div>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <div style="display: flex; align-items: center; justify-content: space-between;">
          <span class="sc-overlay-label">${t('offline.cached_tracks')}</span>
          <button class="sc-overlay-btn sc-overlay-btn-danger" id="sc-offline-clear" style="font-size: 12px; padding: 4px 10px;">${t('offline.clear_all')}</button>
        </div>
        <ul class="sc-overlay-list" id="sc-offline-list" style="margin-top: 8px; max-height: 300px; overflow-y: auto;"></ul>
        <div id="sc-offline-empty" style="color: #666; font-size: 13px; text-align: center; padding: 20px 0;">${t('offline.no_cached')}</div>
      </div>
    </div>
  `;
}

export function getOfflineOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations(['offline.status_text']));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="offline-cache"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) { for (var pk in p) s = s.replace('{' + pk + '}', p[pk]); } return s; }

      var api = window.sixteenCloud;
      if (!api) return;

      var enabledCb = panel.querySelector('#sc-offline-enabled');
      var autoCb = panel.querySelector('#sc-offline-autocache');
      var maxSlider = panel.querySelector('#sc-offline-maxsize');
      var maxLabel = panel.querySelector('#sc-offline-maxsize-label');
      var statusEl = panel.querySelector('#sc-offline-status');
      var listEl = panel.querySelector('#sc-offline-list');
      var emptyEl = panel.querySelector('#sc-offline-empty');
      var clearBtn = panel.querySelector('#sc-offline-clear');

      // Load settings
      api.storeGet('offlineCache.enabled').then(function(v) { enabledCb.checked = !!v; });
      api.storeGet('offlineCache.autoCache').then(function(v) { autoCb.checked = !!v; });
      api.storeGet('offlineCache.maxSizeMB').then(function(v) {
        var val = v || 500;
        maxSlider.value = val;
        maxLabel.textContent = val;
      });

      enabledCb.addEventListener('change', function() { api.storeSet('offlineCache.enabled', enabledCb.checked); });
      autoCb.addEventListener('change', function() { api.storeSet('offlineCache.autoCache', autoCb.checked); });
      var maxSizeSaveTimer = null;
      function saveMaxSize(value) {
        if (maxSizeSaveTimer) clearTimeout(maxSizeSaveTimer);
        maxSizeSaveTimer = setTimeout(function() {
          api.storeSet('offlineCache.maxSizeMB', parseInt(value));
          maxSizeSaveTimer = null;
        }, 150);
      }

      maxSlider.addEventListener('input', function() {
        maxLabel.textContent = maxSlider.value;
        saveMaxSize(maxSlider.value);
      });

      function formatSize(bytes) {
        if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(0) + ' KB';
        return (bytes / 1024 / 1024).toFixed(1) + ' MB';
      }

      function loadStatus() {
        api.offlineCacheStatus().then(function(s) {
          statusEl.textContent = _t('offline.status_text', { count: '' + s.count, size: '' + s.sizeMB, max: '' + s.maxSizeMB });
        });
      }

      function loadList() {
        api.offlineCacheList().then(function(tracks) {
          listEl.innerHTML = '';
          if (!tracks || !tracks.length) {
            emptyEl.style.display = 'block';
            return;
          }
          emptyEl.style.display = 'none';
          tracks.forEach(function(t) {
            var li = document.createElement('li');
            li.className = 'sc-overlay-list-item';
            li.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #222;';
            li.innerHTML = '<div style="flex:1;min-width:0;">' +
              '<div style="font-size:13px;color:#eee;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">' + window.__scEscapeHtml(t.title) + '</div>' +
              '<div style="font-size:11px;color:#888;">' + window.__scEscapeHtml(t.artist) + ' — ' + window.__scEscapeHtml(formatSize(t.fileSize)) + '</div>' +
              '</div>' +
              '<button class="sc-overlay-btn-icon sc-offline-remove" data-id="' + window.__scEscapeHtml(t.trackId) + '" style="color:#888;font-size:16px;cursor:pointer;" title="Remove" data-sc-icon="x" aria-label="Remove"></button>';
            listEl.appendChild(li);
          });

          listEl.querySelectorAll('.sc-offline-remove').forEach(function(btn) {
            btn.addEventListener('click', function() {
              api.offlineCacheRemove(btn.dataset.id).then(function() {
                loadList();
                loadStatus();
              });
            });
          });
        });
      }

      clearBtn.addEventListener('click', function() {
        api.offlineCacheClear().then(function() {
          loadList();
          loadStatus();
        });
      });

      loadStatus();
      loadList();
    })();
  `;
}

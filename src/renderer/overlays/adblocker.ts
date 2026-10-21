import { t, getScriptTranslations } from '../../shared/i18n';

export function getAdblockerOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('adblocker.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('adblocker.enable')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-ad-toggle" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('adblocker.blocked_requests')}</span>
        <div class="sc-overlay-status">
          <span class="sc-overlay-status-dot green"></span>
          <span class="sc-overlay-status-text">
            <span id="sc-ad-count">0</span> ${t('adblocker.requests_blocked')}
          </span>
        </div>
        <div style="font-size: 11px; color: var(--sc-text-subtle); margin-top: 8px;">
          ${t('adblocker.last_updated')}: <span id="sc-ad-last-updated">-</span>
        </div>
      </div>

      <div class="sc-overlay-group">
        <button class="sc-overlay-btn sc-overlay-btn-primary sc-overlay-btn-full" id="sc-ad-update-lists">
          ${t('adblocker.update_lists')}
        </button>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('adblocker.custom_rules')}</span>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="text" class="sc-overlay-input" id="sc-ad-custom-rule" placeholder="${t('adblocker.placeholder_rule')}" style="flex:1">
          <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-ad-add-rule">${t('adblocker.add')}</button>
        </div>
        <ul class="sc-overlay-list" id="sc-ad-rules-list"></ul>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('adblocker.whitelist')}</span>
        <div style="display: flex; gap: 8px; margin-bottom: 8px;">
          <input type="text" class="sc-overlay-input" id="sc-ad-whitelist-input" placeholder="${t('adblocker.placeholder_whitelist')}" style="flex:1">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-ad-add-whitelist">${t('adblocker.add')}</button>
        </div>
        <ul class="sc-overlay-list" id="sc-ad-whitelist-list"></ul>
      </div>
    </div>
  `;
}

export function getAdblockerOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'adblocker.update_lists', 'adblocker.updating', 'adblocker.updated', 'adblocker.update_failed',
  ]));
  return `
    (function() {
      const panel = document.querySelector('[data-overlay="adblocker"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) { for (var pk in p) s = s.replace('{' + pk + '}', p[pk]); } return s; }

      const api = window.sixteenCloud;
      if (!api) return;

      const toggle = panel.querySelector('#sc-ad-toggle');
      const countEl = panel.querySelector('#sc-ad-count');
      const lastUpdatedEl = panel.querySelector('#sc-ad-last-updated');
      const updateBtn = panel.querySelector('#sc-ad-update-lists');
      const ruleInput = panel.querySelector('#sc-ad-custom-rule');
      const addRuleBtn = panel.querySelector('#sc-ad-add-rule');
      const rulesList = panel.querySelector('#sc-ad-rules-list');
      const whitelistInput = panel.querySelector('#sc-ad-whitelist-input');
      const addWhitelistBtn = panel.querySelector('#sc-ad-add-whitelist');
      const whitelistList = panel.querySelector('#sc-ad-whitelist-list');

      // Load state
      api.storeGet('adblocker').then(function(state) {
        if (!state) return;
        toggle.checked = state.enabled;
        countEl.textContent = state.blockedCount || 0;
        if (state.lastUpdated) {
          var date = new Date(state.lastUpdated);
          lastUpdatedEl.textContent = date.toLocaleString();
        }
        renderList(rulesList, state.customRules || [], 'adblocker.customRules');
        renderList(whitelistList, state.whitelist || [], 'adblocker.whitelist');
      });

      toggle.addEventListener('change', function() {
        api.adToggle(toggle.checked);
      });

      api.onAdBlockCount(function(count) {
        countEl.textContent = count;
      });

      updateBtn.addEventListener('click', function() {
        updateBtn.disabled = true;
        updateBtn.textContent = _t('adblocker.updating');
        api.adUpdateLists().then(function(result) {
          updateBtn.disabled = false;
          updateBtn.textContent = _t('adblocker.update_lists');
          if (result.success) {
            lastUpdatedEl.textContent = new Date().toLocaleString();
            updateBtn.textContent = _t('adblocker.updated', { count: '' + result.count });
            setTimeout(function() { updateBtn.textContent = _t('adblocker.update_lists'); }, 3000);
          } else {
            updateBtn.textContent = _t('adblocker.update_failed');
            updateBtn.style.color = 'var(--sc-danger)';
            setTimeout(function() { updateBtn.textContent = _t('adblocker.update_lists'); updateBtn.style.color = ''; }, 3000);
          }
        }).catch(function() {
          updateBtn.disabled = false;
          updateBtn.textContent = _t('adblocker.update_failed');
          updateBtn.style.color = 'var(--sc-danger)';
          setTimeout(function() { updateBtn.textContent = _t('adblocker.update_lists'); updateBtn.style.color = ''; }, 3000);
        });
      });

      addRuleBtn.addEventListener('click', function() {
        const val = ruleInput.value.trim();
        if (!val) return;
        api.storeGet('adblocker.customRules').then(function(rules) {
          const arr = rules || [];
          arr.push(val);
          api.storeSet('adblocker.customRules', arr);
          renderList(rulesList, arr, 'adblocker.customRules');
          ruleInput.value = '';
        });
      });

      addWhitelistBtn.addEventListener('click', function() {
        const val = whitelistInput.value.trim();
        if (!val) return;
        api.storeGet('adblocker.whitelist').then(function(wl) {
          const arr = wl || [];
          arr.push(val);
          api.storeSet('adblocker.whitelist', arr);
          renderList(whitelistList, arr, 'adblocker.whitelist');
          whitelistInput.value = '';
        });
      });

      function renderList(listEl, items, storeKey) {
        listEl.innerHTML = items.map(function(item, i) {
          return '<li class="sc-overlay-list-item">' +
            '<span class="sc-overlay-list-item-title">' + window.__scEscapeHtml(item) + '</span>' +
            '<button class="sc-overlay-btn-icon" data-remove="' + i + '" title="Remove" data-sc-icon="x" aria-label="Remove"></button>' +
            '</li>';
        }).join('');

        listEl.querySelectorAll('[data-remove]').forEach(function(btn) {
          btn.addEventListener('click', function() {
            const idx = parseInt(btn.getAttribute('data-remove'));
            items.splice(idx, 1);
            api.storeSet(storeKey, items);
            renderList(listEl, items, storeKey);
          });
        });
      }
    })();
  `;
}

import { t, getScriptTranslations } from '../../shared/i18n';

export function getCustomCssOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('css.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('css.code')}</span>
        <textarea id="sc-custom-css-editor" class="sc-overlay-input" style="min-height: 300px; font-family: 'SF Mono', 'Cascadia Code', 'Consolas', monospace; font-size: 13px; line-height: 1.5; resize: vertical; white-space: pre; tab-size: 2;" placeholder="/* Enter your custom CSS here */&#10;&#10;.playControls {&#10;  background: #1a1a1a !important;&#10;}"></textarea>
      </div>

      <div style="display: flex; gap: 8px;">
        <button class="sc-overlay-btn sc-overlay-btn-primary" id="sc-custom-css-save" style="flex:1">${t('css.save')}</button>
        <button class="sc-overlay-btn sc-overlay-btn-danger" id="sc-custom-css-clear">${t('css.clear')}</button>
      </div>

      <div style="font-size: 12px; color: #666; margin-top: 12px;" id="sc-custom-css-status"></div>
    </div>
  `;
}

export function getCustomCssOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations(['css.saved', 'css.cleared']));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="custom-css"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      var api = window.sixteenCloud;
      if (!api) return;

      var editor = panel.querySelector('#sc-custom-css-editor');
      var saveBtn = panel.querySelector('#sc-custom-css-save');
      var clearBtn = panel.querySelector('#sc-custom-css-clear');
      var status = panel.querySelector('#sc-custom-css-status');

      function applyCSS(code) {
        var existing = document.getElementById('sc-custom-css');
        if (existing) existing.remove();
        if (code) {
          var style = document.createElement('style');
          style.id = 'sc-custom-css';
          style.textContent = code;
          document.head.appendChild(style);
        }
      }

      // Live preview on input
      editor.addEventListener('input', function() {
        applyCSS(editor.value);
      });

      // Tab key support
      editor.addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          var start = editor.selectionStart;
          var end = editor.selectionEnd;
          editor.value = editor.value.substring(0, start) + '  ' + editor.value.substring(end);
          editor.selectionStart = editor.selectionEnd = start + 2;
          applyCSS(editor.value);
        }
      });

      saveBtn.addEventListener('click', function() {
        api.storeSet('customCss.code', editor.value);
        applyCSS(editor.value);
        status.textContent = _t('css.saved');
        status.style.color = '#2ecc71';
        setTimeout(function() { status.textContent = ''; }, 2000);
      });

      clearBtn.addEventListener('click', function() {
        editor.value = '';
        api.storeSet('customCss.code', '');
        applyCSS('');
        status.textContent = _t('css.cleared');
        status.style.color = '#888';
        setTimeout(function() { status.textContent = ''; }, 2000);
      });

      // Load saved CSS
      api.storeGet('customCss.code').then(function(code) {
        if (code) {
          editor.value = code;
          applyCSS(code);
        }
      });
    })();
  `;
}

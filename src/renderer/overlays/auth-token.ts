import { t, getScriptTranslations } from '../../shared/i18n';

export function getAuthTokenOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('auth.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div id="sc-auth-logged-out">
        <div class="sc-overlay-group">
          <span class="sc-overlay-label">${t('auth.token_label')}</span>
          <input type="password" class="sc-overlay-input" id="sc-auth-token-input" placeholder="${t('auth.placeholder')}">
        </div>
        <button class="sc-overlay-btn sc-overlay-btn-primary sc-overlay-btn-full" id="sc-auth-login-btn">
          ${t('auth.paste_login')}
        </button>
        <div id="sc-auth-status" class="sc-overlay-status" style="margin-top: 12px; display: none;">
          <span class="sc-overlay-status-dot gray" id="sc-auth-status-dot"></span>
          <span class="sc-overlay-status-text" id="sc-auth-status-text"></span>
        </div>
      </div>

      <div id="sc-auth-logged-in" style="display: none;">
        <div class="sc-overlay-user-card" id="sc-auth-user-card">
          <img class="sc-overlay-user-avatar" id="sc-auth-avatar" src="" alt="">
          <div>
            <div class="sc-overlay-user-name" id="sc-auth-username"></div>
            <div class="sc-overlay-user-id" id="sc-auth-userid"></div>
          </div>
        </div>
        <div class="sc-overlay-status" style="margin-bottom: 12px;">
          <span class="sc-overlay-status-dot green"></span>
          <span class="sc-overlay-status-text">${t('auth.authenticated')}</span>
        </div>
        <button class="sc-overlay-btn sc-overlay-btn-danger sc-overlay-btn-full" id="sc-auth-logout-btn">
          ${t('auth.logout')}
        </button>
      </div>
    </div>
  `;
}

export function getAuthTokenOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'auth.validating', 'auth.invalid', 'auth.error_validating', 'auth.unknown',
  ]));
  return `
    (function() {
      const panel = document.querySelector('[data-overlay="auth-token"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      const api = window.sixteenCloud;
      if (!api) return;

      const loggedOutSection = panel.querySelector('#sc-auth-logged-out');
      const loggedInSection = panel.querySelector('#sc-auth-logged-in');
      const tokenInput = panel.querySelector('#sc-auth-token-input');
      const loginBtn = panel.querySelector('#sc-auth-login-btn');
      const logoutBtn = panel.querySelector('#sc-auth-logout-btn');
      const statusEl = panel.querySelector('#sc-auth-status');
      const statusDot = panel.querySelector('#sc-auth-status-dot');
      const statusText = panel.querySelector('#sc-auth-status-text');
      const avatarEl = panel.querySelector('#sc-auth-avatar');
      const usernameEl = panel.querySelector('#sc-auth-username');
      const useridEl = panel.querySelector('#sc-auth-userid');

      function showStatus(msg, color) {
        statusEl.style.display = 'flex';
        statusDot.className = 'sc-overlay-status-dot ' + color;
        statusText.textContent = msg;
      }

      function showLoggedIn(user) {
        loggedOutSection.style.display = 'none';
        loggedInSection.style.display = 'block';
        avatarEl.src = user.avatarUrl || '';
        usernameEl.textContent = user.username || _t('auth.unknown');
        useridEl.textContent = 'ID: ' + (user.userId || '');
      }

      function showLoggedOut() {
        loggedOutSection.style.display = 'block';
        loggedInSection.style.display = 'none';
        statusEl.style.display = 'none';
        tokenInput.value = '';
      }

      loginBtn.addEventListener('click', function() {
        const token = tokenInput.value.trim();
        if (!token) return;
        loginBtn.disabled = true;
        showStatus(_t('auth.validating'), 'yellow');
        api.authSetToken(token).then(function(result) {
          loginBtn.disabled = false;
          if (result && result.success) {
            showLoggedIn(result.user);
          } else {
            showStatus(result && result.error || _t('auth.invalid'), 'red');
          }
        }).catch(function() {
          loginBtn.disabled = false;
          showStatus(_t('auth.error_validating'), 'red');
        });
      });

      logoutBtn.addEventListener('click', function() {
        api.authLogout().then(function() {
          showLoggedOut();
        });
      });

      // Check initial state
      api.onAuthState(function(state) {
        if (state && state.isLoggedIn) {
          showLoggedIn(state);
        } else {
          showLoggedOut();
        }
      });

      // Check if already logged in
      api.authValidate().then(function(result) {
        if (result && result.success) {
          showLoggedIn(result.user);
        }
      }).catch(function() {});
    })();
  `;
}

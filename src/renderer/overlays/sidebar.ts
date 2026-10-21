import { t, getScriptTranslations } from '../../shared/i18n';

export function getSidebarOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('sidebar.title')}</h2>
      <div class="sc-overlay-header-actions">
        <button class="sc-overlay-btn-icon" onclick="window.__scCloseSidebar()" title="${t('common.close')}"><span data-sc-icon="x"></span></button>
      </div>
    </div>
    <div class="sc-overlay-body">
      <button class="sc-overlay-btn sc-overlay-btn-primary sc-overlay-btn-full" id="sc-sidebar-add">
        ${t('sidebar.add_page')}
      </button>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('sidebar.your_bookmarks')}</span>
        <ul class="sc-overlay-list" id="sc-sidebar-list"></ul>
        <div id="sc-sidebar-empty" style="color: var(--sc-text-subtle); font-size: 13px; text-align: center; padding: 20px 0;">${t('sidebar.no_bookmarks')}</div>
      </div>
    </div>
  `;
}

export function getSidebarOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'sidebar.already_bookmarked', 'sidebar.added', 'sidebar.add_page',
  ]));
  return `
    (function() {
      var panel = document.querySelector('#sc-sidebar-container .sc-sidebar-panel');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      var api = window.sixteenCloud;
      if (!api) return;

      var addBtn = panel.querySelector('#sc-sidebar-add');
      var listEl = panel.querySelector('#sc-sidebar-list');
      var emptyEl = panel.querySelector('#sc-sidebar-empty');

      var bookmarks = [];

      function detectType(url) {
        // Decide from the pathname only: a track opened from a set keeps
        // "?in=<user>/sets/<set>" in its query string.
        var path;
        try {
          path = new URL(url).pathname;
        } catch (e) {
          path = String(url).replace('https://soundcloud.com/', '/');
        }
        var parts = path.replace(/\\/+$/, '').split('/').filter(Boolean);
        if (parts.indexOf('sets') !== -1) return 'playlist';
        if (parts.length >= 2 && parts[1]) return 'track';
        return 'artist';
      }

      function renderBookmarks() {
        if (bookmarks.length === 0) {
          listEl.innerHTML = '';
          emptyEl.style.display = 'block';
          return;
        }
        emptyEl.style.display = 'none';
        listEl.innerHTML = bookmarks.map(function(b, i) {
          var icon = b.type === 'track' ? 'music' : b.type === 'playlist' ? 'list' : 'user';
          return '<li class="sc-overlay-list-item" style="cursor: pointer;">' +
            '<div style="flex:1;min-width:0;display:flex;align-items:center;gap:8px" class="sc-sidebar-nav" data-index="' + i + '">' +
            '<span class="sc-sidebar-bookmark-icon" data-sc-icon="' + icon + '"></span>' +
            '<div style="min-width:0">' +
            '<div class="sc-overlay-list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + window.__scEscapeHtml(b.name || '') + '</div>' +
            '<div class="sc-overlay-list-item-sub">' + window.__scEscapeHtml(b.type || '') + '</div>' +
            '</div></div>' +
            '<button class="sc-overlay-btn-icon sc-sidebar-del" data-index="' + i + '" style="font-size:14px;flex-shrink:0" data-sc-icon="x" aria-label="Remove"></button>' +
            '</li>';
        }).join('');
        if (window.__scIconify) window.__scIconify(listEl);
      }

      // One delegated handler on the list instead of per-row listeners: rows are
      // rebuilt on every render, and a re-rendered row must never end up inert.
      listEl.addEventListener('click', function(e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var del = target.closest('.sc-sidebar-del');
        if (del) {
          e.stopPropagation();
          var delIdx = parseInt(del.getAttribute('data-index'), 10);
          if (!isNaN(delIdx)) {
            bookmarks.splice(delIdx, 1);
            api.storeSet('sidebar.bookmarks', bookmarks);
            renderBookmarks();
          }
          return;
        }
        var nav = target.closest('.sc-sidebar-nav');
        if (!nav) return;
        var idx = parseInt(nav.getAttribute('data-index'), 10);
        var bookmark = isNaN(idx) ? null : bookmarks[idx];
        if (bookmark && bookmark.url) window.__scNavigate(bookmark.url);
      });

      addBtn.addEventListener('click', function() {
        var url = window.location.href;
        if (!url.includes('soundcloud.com')) return;

        var titleEl = document.querySelector('.soundTitle__title span, .profileHeaderInfo__userName, .fullHero__title span');
        var name = titleEl ? titleEl.textContent.trim() : url.replace('https://soundcloud.com/', '');
        var type = detectType(url);

        if (bookmarks.some(function(b) { return b.url === url; })) {
          addBtn.textContent = _t('sidebar.already_bookmarked');
          setTimeout(function() { addBtn.textContent = _t('sidebar.add_page'); }, 1500);
          return;
        }

        bookmarks.push({ name: name, url: url, type: type });
        api.storeSet('sidebar.bookmarks', bookmarks);
        renderBookmarks();

        addBtn.textContent = _t('sidebar.added');
        setTimeout(function() { addBtn.textContent = _t('sidebar.add_page'); }, 1500);
      });

      // Load bookmarks
      api.storeGet('sidebar.bookmarks').then(function(bm) {
        bookmarks = bm || [];
        renderBookmarks();
      });
    })();
  `;
}

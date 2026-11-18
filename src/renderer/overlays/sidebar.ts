import { t, getScriptTranslations } from '../../shared/i18n';
import { cleanBookmark } from '../../shared/bookmarks';
import { scJs } from '../../shared/sc-selectors';

// Bookmarks drawer: cover thumbnails, pins, folders, drag-to-reorder and
// timecode bookmarks ("this moment of this mix"). Entries are kept in the
// canonical shape of shared/bookmarks.ts, which the main process enforces on
// store:set; the page uses the very same cleanBookmark (via toString).

const PIN_SVG = '<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4h6l-1 6 3 3H7l3-3-1-6ZM12 13v7"/></svg>';
const FOLDER_SVG = '<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/></svg>';
const X_SVG = '<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';

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
      <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-sidebar-add-moment" style="margin-top: 8px;">
        ${t('sidebar.add_moment')}
      </button>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('sidebar.your_bookmarks')}</span>
        <div id="sc-sidebar-list" class="sc-bm-list"></div>
        <div id="sc-sidebar-empty" style="color: var(--sc-text-subtle); font-size: 13px; text-align: center; padding: 20px 0;">${t('sidebar.no_bookmarks')}</div>
        <div id="sc-sidebar-hint" class="sc-bm-hint">${t('sidebar.drag_hint')}</div>
      </div>
      <datalist id="sc-bm-folders"></datalist>
    </div>
  `;
}

export function getSidebarOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'sidebar.already_bookmarked', 'sidebar.added', 'sidebar.add_page', 'sidebar.add_moment',
    'sidebar.pinned', 'sidebar.unfiled', 'sidebar.pin', 'sidebar.unpin', 'sidebar.folder',
    'sidebar.folder_placeholder', 'sidebar.moment_added', 'sidebar.press_play', 'sidebar.nothing_playing',
    'sidebar.type_track', 'sidebar.type_playlist', 'sidebar.type_artist', 'common.remove',
  ]));
  return `
    (function() {
      var panel = document.querySelector('#sc-sidebar-container .sc-sidebar-panel');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) for (var x in p) s = s.replace('{' + x + '}', p[x]); return s; }

      var api = window.sixteenCloud;
      if (!api) return;

      ${cleanBookmark.toString()}

      var addBtn = panel.querySelector('#sc-sidebar-add');
      var momentBtn = panel.querySelector('#sc-sidebar-add-moment');
      var listEl = panel.querySelector('#sc-sidebar-list');
      var emptyEl = panel.querySelector('#sc-sidebar-empty');
      var hintEl = panel.querySelector('#sc-sidebar-hint');
      var folderList = panel.querySelector('#sc-bm-folders');
      var TIMELINE = ${scJs('TIMELINE_WRAPPER')};
      var HERO_PLAY = ${scJs('HERO_PLAY')};
      var PAGE_ART = ${scJs('PAGE_ARTWORK')};
      var SVG = { pin: ${JSON.stringify(PIN_SVG)}, folder: ${JSON.stringify(FOLDER_SVG)}, x: ${JSON.stringify(X_SVG)} };

      var bookmarks = [];
      var collapsed = {};
      try { collapsed = JSON.parse(localStorage.getItem('sc16:bm-collapsed') || '{}') || {}; } catch (e) { collapsed = {}; }

      function save() {
        bookmarks = bookmarks.map(cleanBookmark).filter(Boolean);
        api.storeSet('sidebar.bookmarks', bookmarks).catch(function(e) { console.warn('[Bookmarks] save failed', e); });
      }
      function flash(btn, key, back) {
        btn.textContent = _t(key);
        setTimeout(function() { btn.textContent = _t(back); }, 1500);
      }

      function detectType(url) {
        // Decide from the pathname only: a track opened from a set keeps
        // "?in=<user>/sets/<set>" in its query string.
        var path;
        try { path = new URL(url).pathname; } catch (e) { path = String(url).replace('https://soundcloud.com/', '/'); }
        var parts = path.replace(/\\/+$/, '').split('/').filter(Boolean);
        if (parts.indexOf('sets') !== -1) return 'playlist';
        if (parts.length >= 2 && parts[1]) return 'track';
        return 'artist';
      }
      function pathOf(url) {
        try { return new URL(url, location.origin).pathname.replace(/\\/+$/, ''); } catch (e) { return ''; }
      }
      function clock(sec) {
        var s = Math.max(0, Math.floor(sec || 0));
        var h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
        return (h ? h + ':' + ('0' + m).slice(-2) : String(m)) + ':' + ('0' + r).slice(-2);
      }
      function bgUrl(el) {
        var m = el ? /url\\(["']?([^"')]+)["']?\\)/.exec(el.getAttribute('style') || '') : null;
        return m ? m[1] : '';
      }
      function bigArt(url) {
        return url ? String(url).replace(/-(?:large|t\\d+x\\d+|small|badge|crop)\\./, '-t200x200.') : '';
      }
      // Artwork for a page: the API catalogue knows tracks, the page hero the rest.
      function artworkFor(url) {
        var info = window.__scTracks && window.__scTracks.byPath ? window.__scTracks.byPath[pathOf(url)] : null;
        if (info && info.artwork) return bigArt(info.artwork);
        if (pathOf(url) === pathOf(location.href)) return bigArt(bgUrl(document.querySelector(PAGE_ART)));
        return '';
      }

      // ---- Rendering ----
      function folders() {
        var seen = {}, out = [];
        bookmarks.forEach(function(b) { if (b.folder && !seen[b.folder]) { seen[b.folder] = true; out.push(b.folder); } });
        return out.sort(function(a, b) { return a.localeCompare(b); });
      }
      function el(tag, cls, text) {
        var e = document.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
      }
      function iconBtn(cls, icon, label) {
        var b = el('button', 'sc-bm-act ' + cls);
        b.type = 'button';
        b.title = label;
        b.setAttribute('aria-label', label);
        b.innerHTML = SVG[icon]; // static markup, never page data
        return b;
      }
      function row(b, index) {
        var li = el('div', 'sc-bm-row' + (b.pinned ? ' pinned' : ''));
        li.draggable = true;
        li.setAttribute('data-index', String(index));
        var nav = el('div', 'sc-bm-nav');
        nav.setAttribute('data-index', String(index));
        var thumb = el('span', 'sc-bm-thumb');
        if (b.artwork) {
          var img = el('img');
          img.alt = '';
          img.loading = 'lazy';
          img.src = b.artwork;
          img.addEventListener('error', function() { img.remove(); thumb.setAttribute('data-sc-icon', b.type === 'track' ? 'music' : b.type === 'playlist' ? 'list' : 'user'); if (window.__scIconify) window.__scIconify(thumb.parentNode); });
          thumb.appendChild(img);
        } else {
          thumb.setAttribute('data-sc-icon', b.type === 'track' ? 'music' : b.type === 'playlist' ? 'list' : 'user');
        }
        var text = el('div', 'sc-bm-text');
        text.appendChild(el('div', 'sc-overlay-list-item-title sc-bm-name', b.name));
        var sub = el('div', 'sc-overlay-list-item-sub sc-bm-sub', _t('sidebar.type_' + b.type));
        if (b.time) { var tc = el('span', 'sc-bm-time', clock(b.time)); sub.insertBefore(tc, sub.firstChild); }
        text.appendChild(sub);
        nav.appendChild(thumb);
        nav.appendChild(text);
        li.appendChild(nav);
        var acts = el('div', 'sc-bm-acts');
        acts.appendChild(iconBtn('sc-bm-pin', 'pin', b.pinned ? _t('sidebar.unpin') : _t('sidebar.pin')));
        acts.appendChild(iconBtn('sc-bm-folder', 'folder', _t('sidebar.folder')));
        acts.appendChild(iconBtn('sc-bm-del', 'x', _t('common.remove')));
        li.appendChild(acts);
        return li;
      }
      // group: 'pinned' | 'loose' for the built-in sections, '' for a folder.
      function section(title, name, indexes, group) {
        var key = group ? 'g:' + group : 'f:' + name;
        var box = el('div', 'sc-bm-section');
        if (title) {
          var head = el('button', 'sc-bm-head' + (collapsed[key] ? ' collapsed' : ''));
          head.type = 'button';
          head.setAttribute('data-key', key);
          if (group) head.setAttribute('data-group', group); else head.setAttribute('data-folder', name);
          head.appendChild(el('span', 'sc-bm-caret'));
          head.appendChild(el('span', 'sc-bm-head-name', title));
          head.appendChild(el('span', 'sc-bm-count', String(indexes.length)));
          box.appendChild(head);
        }
        if (!title || !collapsed[key]) indexes.forEach(function(i) { box.appendChild(row(bookmarks[i], i)); });
        return box;
      }
      function render() {
        listEl.textContent = '';
        emptyEl.style.display = bookmarks.length ? 'none' : 'block';
        hintEl.style.display = bookmarks.length > 1 ? '' : 'none';
        if (!bookmarks.length) return;
        var pinned = [], byFolder = {}, loose = [];
        bookmarks.forEach(function(b, i) {
          if (b.pinned) pinned.push(i);
          else if (b.folder) (byFolder[b.folder] = byFolder[b.folder] || []).push(i);
          else loose.push(i);
        });
        var names = folders();
        if (pinned.length) listEl.appendChild(section(_t('sidebar.pinned'), '', pinned, 'pinned'));
        names.forEach(function(name) { if (byFolder[name]) listEl.appendChild(section(name, name, byFolder[name], '')); });
        if (loose.length) listEl.appendChild(section(names.length || pinned.length ? _t('sidebar.unfiled') : '', '', loose, 'loose'));
        folderList.textContent = '';
        names.forEach(function(name) { var o = el('option'); o.value = name; folderList.appendChild(o); });
        if (window.__scIconify) window.__scIconify(listEl);
      }

      // ---- Opening a bookmark (with a pending jump for timecodes) ----
      var pendingSeek = null; // { path, time, until }
      function seekNow(time) {
        var au = window.__scAudioElement;
        if (au && au.readyState >= 2 && isFinite(au.duration) && au.duration > time) {
          try { au.currentTime = time; return true; } catch (e) {}
        }
        var w = document.querySelector(TIMELINE);
        var total = w ? parseFloat(w.getAttribute('aria-valuemax')) : NaN;
        return isFinite(total) && total > 0 && typeof window.__scPlayerSeek === 'function' && window.__scPlayerSeek(time / total);
      }
      function playingPath() {
        var c = window.__scPlayer && window.__scPlayer.current();
        return c ? c.path : '';
      }
      setInterval(function() {
        if (!pendingSeek) return;
        if (Date.now() > pendingSeek.until) { pendingSeek = null; return; }
        var au = window.__scAudioElement;
        if (playingPath() !== pendingSeek.path || !au || au.paused || au.readyState < 3 || au.currentTime < 0.3) return;
        var target = pendingSeek.time;
        pendingSeek = null;
        seekNow(target);
      }, 400);
      function open(b) {
        if (!b || !b.url) return;
        if (!b.time) {
          window.__scNavigate(b.url);
          if (!b.artwork) backfillArtwork(b.url);
          return;
        }
        var path = pathOf(b.url);
        if (playingPath() === path) { seekNow(b.time); if (window.__scCloseSidebar) window.__scCloseSidebar(); return; }
        pendingSeek = { path: path, time: b.time, until: Date.now() + 120000 };
        window.__scNavigate(b.url);
        // Start it from the track page when SoundCloud shows its big play button.
        var tries = 0;
        var poll = setInterval(function() {
          if (++tries > 20 || !pendingSeek) { clearInterval(poll); if (pendingSeek && window.__scToast) window.__scToast(_t('sidebar.press_play', { time: clock(b.time) })); return; }
          if (pathOf(location.href) !== path) return;
          var play = document.querySelector(HERO_PLAY);
          if (play) { clearInterval(poll); play.click(); }
        }, 250);
      }
      // Older bookmarks have no cover: pick it up the next time the page is open.
      function backfillArtwork(url) {
        setTimeout(function() {
          if (pathOf(location.href) !== pathOf(url)) return;
          var art = artworkFor(url);
          if (!art) return;
          var changed = false;
          bookmarks.forEach(function(b) { if (b.url === url && !b.artwork) { b.artwork = art; changed = true; } });
          if (changed) { save(); render(); }
        }, 2500);
      }

      // ---- Actions (one delegated handler; rows are rebuilt on render) ----
      function closeFolderEditors() {
        var open = listEl.querySelectorAll('.sc-bm-folder-edit');
        for (var i = 0; i < open.length; i++) open[i].remove();
      }
      function editFolder(rowEl, index) {
        closeFolderEditors();
        var b = bookmarks[index];
        var box = el('div', 'sc-bm-folder-edit');
        var input = el('input', 'sc-overlay-input');
        input.setAttribute('list', 'sc-bm-folders');
        input.maxLength = 60;
        input.placeholder = _t('sidebar.folder_placeholder');
        input.value = b.folder || '';
        box.appendChild(input);
        rowEl.parentNode.insertBefore(box, rowEl.nextSibling);
        input.focus();
        var done = false;
        function commit(apply) {
          if (done) return;
          done = true;
          if (apply) {
            var v = input.value.trim().slice(0, 60);
            if (v) bookmarks[index].folder = v; else delete bookmarks[index].folder;
            if (v) delete bookmarks[index].pinned;
            save();
          }
          render();
        }
        input.addEventListener('keydown', function(e) {
          if (e.key === 'Enter') { e.preventDefault(); commit(true); }
          else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); commit(false); }
        });
        input.addEventListener('blur', function() { commit(true); });
      }
      listEl.addEventListener('click', function(e) {
        var target = e.target;
        if (!target || !target.closest) return;
        var head = target.closest('.sc-bm-head');
        if (head) {
          var key = head.getAttribute('data-key');
          collapsed[key] = !collapsed[key];
          try { localStorage.setItem('sc16:bm-collapsed', JSON.stringify(collapsed)); } catch (err) {}
          render();
          return;
        }
        var rowEl = target.closest('.sc-bm-row');
        if (!rowEl) return;
        var index = parseInt(rowEl.getAttribute('data-index'), 10);
        var b = bookmarks[index];
        if (!b) return;
        if (target.closest('.sc-bm-del')) {
          e.stopPropagation();
          bookmarks.splice(index, 1);
          save(); render();
        } else if (target.closest('.sc-bm-pin')) {
          e.stopPropagation();
          if (b.pinned) delete b.pinned; else { b.pinned = true; delete b.folder; }
          save(); render();
        } else if (target.closest('.sc-bm-folder')) {
          e.stopPropagation();
          editFolder(rowEl, index);
        } else if (target.closest('.sc-bm-nav')) {
          open(b);
        }
      });

      // ---- Drag to reorder (drop on a row: take its place and its group;
      // drop on a folder header: move into that folder) ----
      var dragIndex = -1;
      function clearDropMarks() {
        var marked = listEl.querySelectorAll('.drop-before, .drop-after, .drop-into');
        for (var i = 0; i < marked.length; i++) marked[i].classList.remove('drop-before', 'drop-after', 'drop-into');
      }
      listEl.addEventListener('dragstart', function(e) {
        var r = e.target.closest ? e.target.closest('.sc-bm-row') : null;
        if (!r) return;
        dragIndex = parseInt(r.getAttribute('data-index'), 10);
        r.classList.add('dragging');
        try { e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(dragIndex)); } catch (err) {}
      });
      listEl.addEventListener('dragend', function() {
        dragIndex = -1;
        clearDropMarks();
        var d = listEl.querySelector('.dragging');
        if (d) d.classList.remove('dragging');
      });
      listEl.addEventListener('dragover', function(e) {
        if (dragIndex < 0) return;
        var r = e.target.closest ? e.target.closest('.sc-bm-row, .sc-bm-head') : null;
        if (!r) return;
        e.preventDefault();
        clearDropMarks();
        if (r.classList.contains('sc-bm-head')) { r.classList.add('drop-into'); return; }
        var rect = r.getBoundingClientRect();
        r.classList.add(e.clientY < rect.top + rect.height / 2 ? 'drop-before' : 'drop-after');
      });
      listEl.addEventListener('drop', function(e) {
        if (dragIndex < 0) return;
        var r = e.target.closest ? e.target.closest('.sc-bm-row, .sc-bm-head') : null;
        if (!r) return;
        e.preventDefault();
        var moving = bookmarks[dragIndex];
        if (!moving) return;
        if (r.classList.contains('sc-bm-head')) {
          var group = r.getAttribute('data-group');
          delete moving.pinned; delete moving.folder;
          if (group === 'pinned') moving.pinned = true;
          else if (!group) moving.folder = r.getAttribute('data-folder') || '';
          bookmarks.splice(dragIndex, 1);
          bookmarks.push(moving);
        } else {
          var targetIndex = parseInt(r.getAttribute('data-index'), 10);
          var target = bookmarks[targetIndex];
          if (!target || target === moving) { clearDropMarks(); return; }
          var after = r.classList.contains('drop-after');
          delete moving.pinned; delete moving.folder;
          if (target.pinned) moving.pinned = true;
          if (target.folder) moving.folder = target.folder;
          bookmarks.splice(dragIndex, 1);
          var at = bookmarks.indexOf(target) + (after ? 1 : 0);
          bookmarks.splice(at, 0, moving);
        }
        dragIndex = -1;
        save(); render();
      });

      // ---- Adding ----
      addBtn.addEventListener('click', function() {
        var url = window.location.href;
        if (!window.__scIsTrustedSoundCloudUrl(url)) return;
        var titleEl = document.querySelector('.soundTitle__title span, .profileHeaderInfo__userName, .fullHero__title span');
        var name = titleEl ? titleEl.textContent.trim() : url.replace('https://soundcloud.com/', '');
        if (bookmarks.some(function(b) { return b.url === url && !b.time; })) { flash(addBtn, 'sidebar.already_bookmarked', 'sidebar.add_page'); return; }
        var b = cleanBookmark({ name: name, url: url, type: detectType(url), artwork: artworkFor(url) });
        if (!b) return;
        bookmarks.push(b);
        save(); render();
        flash(addBtn, 'sidebar.added', 'sidebar.add_page');
      });

      // A timecode bookmark: the playing track at the current second.
      momentBtn.addEventListener('click', function() {
        var c = window.__scPlayer && window.__scPlayer.current();
        var au = window.__scAudioElement;
        var at = au && isFinite(au.currentTime) ? au.currentTime : NaN;
        if (!isFinite(at)) {
          var w = document.querySelector(TIMELINE);
          at = w ? parseFloat(w.getAttribute('aria-valuenow')) : NaN;
        }
        if (!c || !c.path || !isFinite(at)) { if (window.__scToast) window.__scToast(_t('sidebar.nothing_playing'), { kind: 'error' }); return; }
        var url = 'https://soundcloud.com' + c.path;
        var info = window.__scTracks && window.__scTracks.byPath ? window.__scTracks.byPath[c.path] : null;
        var name = (info && info.title) || c.title || c.path;
        var b = cleanBookmark({ name: name, url: url, type: 'track', artwork: bigArt((info && info.artwork) || c.artwork || ''), time: Math.max(1, Math.floor(at)) });
        if (!b) return;
        bookmarks.push(b);
        save(); render();
        if (window.__scToast) window.__scToast(_t('sidebar.moment_added', { time: clock(b.time) }), { kind: 'success' });
      });

      // Load bookmarks; anything stored in an older or broken shape is cleaned once.
      api.storeGet('sidebar.bookmarks').then(function(bm) {
        var raw = Array.isArray(bm) ? bm : [];
        bookmarks = raw.map(cleanBookmark).filter(Boolean);
        if (JSON.stringify(bookmarks) !== JSON.stringify(raw)) save();
        render();
      });
    })();
  `;
}

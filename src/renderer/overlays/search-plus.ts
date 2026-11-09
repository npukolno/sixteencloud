import { t, getScriptTranslations } from '../../shared/i18n';

// Search helpers: "/" and Ctrl+K focus the search box, and a history dropdown
// opens when the empty box is focused. SoundCloud's results page already has
// its own type / length / date / tag filters, so none are duplicated here.

export function getSearchPlusScript(): string {
  const _tr = JSON.stringify(getScriptTranslations(['search.recent', 'search.clear', 'search.remove']));
  void t;
  return `
    (function() {
      if (window.__scSearchPlus) return;
      window.__scSearchPlus = true;
      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }
      var api = window.sixteenCloud;
      var hist = [];
      var MAX = 15;

      if (api && typeof api.storeGet === 'function') {
        api.storeGet('searchHistory').then(function(h) { if (Array.isArray(h)) hist = h.slice(0, MAX); }).catch(function() {});
      }
      function save() {
        if (api && typeof api.storeSet === 'function') api.storeSet('searchHistory', hist).catch(function() {});
      }
      function add(q) {
        q = String(q || '').trim().slice(0, 200);
        if (!q) return;
        hist = [q].concat(hist.filter(function(x) { return x.toLowerCase() !== q.toLowerCase(); })).slice(0, MAX);
        save();
      }

      var style = document.createElement('style');
      style.textContent =
        '#sc-search-hist{position:fixed;z-index:99000;min-width:260px;max-width:420px;background:var(--sc-surface,#17181b);color:var(--sc-text,#eee);border:1px solid var(--sc-border,rgba(255,255,255,.1));border-radius:12px;box-shadow:0 14px 40px rgba(0,0,0,.5);padding:6px;font-size:13px;display:none}' +
        '#sc-search-hist .sh-head{display:flex;justify-content:space-between;align-items:center;padding:6px 10px;font-size:11px;letter-spacing:.06em;text-transform:uppercase;opacity:.6}' +
        '#sc-search-hist .sh-head button{background:none;border:0;color:inherit;cursor:pointer;font-size:11px;text-transform:uppercase;letter-spacing:.06em}' +
        '#sc-search-hist .sh-item{display:flex;align-items:center;gap:8px;padding:7px 10px;border-radius:8px;cursor:pointer}' +
        '#sc-search-hist .sh-item:hover{background:rgba(var(--sc-accent-rgb,255,85,0),.16)}' +
        '#sc-search-hist .sh-q{flex:1;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '#sc-search-hist .sh-x{background:none;border:0;color:inherit;opacity:.45;cursor:pointer;font-size:14px;padding:0 4px}' +
        '#sc-search-hist .sh-x:hover{opacity:1}';
      document.head.appendChild(style);

      var box = document.createElement('div');
      box.id = 'sc-search-hist';
      document.body.appendChild(box);

      function input() {
        var list = document.querySelectorAll('.headerSearch__input');
        for (var i = 0; i < list.length; i++) {
          var el = list[i];
          var r = el.getBoundingClientRect();
          var shown = typeof el.checkVisibility === 'function' ? el.checkVisibility() : el.offsetParent !== null;
          if (shown && r.width > 40 && r.height > 12 && r.bottom > 0 && r.top < window.innerHeight) return el;
        }
        return null;
      }
      function go(q) {
        add(q);
        var a = document.createElement('a');
        a.href = '/search?q=' + encodeURIComponent(q);
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { a.remove(); }, 0);
        hide();
      }
      function hide() { box.style.display = 'none'; }

      function render(target) {
        var inp = target || input();
        if (!inp || inp.value || !hist.length) { hide(); return; }
        var r = inp.getBoundingClientRect();
        box.style.left = Math.max(8, r.left) + 'px';
        box.style.top = (r.bottom + 6) + 'px';
        box.style.minWidth = Math.max(260, r.width) + 'px';
        box.innerHTML = '';
        var head = document.createElement('div');
        head.className = 'sh-head';
        head.innerHTML = '<span></span><button type="button"></button>';
        head.firstChild.textContent = _t('search.recent');
        head.lastChild.textContent = _t('search.clear');
        head.lastChild.addEventListener('mousedown', function(e) { e.preventDefault(); hist = []; save(); hide(); });
        box.appendChild(head);
        hist.forEach(function(q) {
          var row = document.createElement('div');
          row.className = 'sh-item';
          var span = document.createElement('span');
          span.className = 'sh-q';
          span.textContent = q;
          var x = document.createElement('button');
          x.type = 'button'; x.className = 'sh-x'; x.textContent = '\\u00d7'; x.title = _t('search.remove');
          row.appendChild(span); row.appendChild(x);
          row.addEventListener('mousedown', function(e) {
            e.preventDefault();
            if (e.target === x) { hist = hist.filter(function(h) { return h !== q; }); save(); render(inp); return; }
            go(q);
          });
          box.appendChild(row);
        });
        box.style.display = 'block';
      }

      document.addEventListener('focusin', function(e) {
        if (e.target && e.target.classList && e.target.classList.contains('headerSearch__input')) render(e.target);
      });
      document.addEventListener('focusout', function(e) {
        if (e.target && e.target.classList && e.target.classList.contains('headerSearch__input')) setTimeout(hide, 120);
      });
      document.addEventListener('input', function(e) {
        if (e.target && e.target.classList && e.target.classList.contains('headerSearch__input')) render(e.target);
      });
      document.addEventListener('submit', function(e) {
        var f = e.target;
        if (f && f.classList && f.classList.contains('headerSearch')) {
          var inp = f.querySelector('.headerSearch__input');
          if (inp) add(inp.value);
        }
      }, true);

      // Searches reached through suggestions or links still land in the history.
      var lastSeen = '';
      function noteRoute() {
        try {
          if (location.pathname.indexOf('/search') !== 0) return;
          var q = new URLSearchParams(location.search).get('q') || '';
          if (q && q !== lastSeen) { lastSeen = q; add(q); }
        } catch (e) {}
      }
      // Record on navigation itself (not on a timer), so a quick search followed
      // by leaving the page is not lost; the interval is only a safety net.
      ['pushState', 'replaceState'].forEach(function(fn) {
        var orig = history[fn];
        history[fn] = function() {
          var r = orig.apply(this, arguments);
          setTimeout(noteRoute, 0);
          return r;
        };
      });
      window.addEventListener('popstate', noteRoute);
      setInterval(noteRoute, 1000);
      noteRoute();

      function typing(el) {
        if (!el) return false;
        var tag = (el.tagName || '').toLowerCase();
        return tag === 'input' || tag === 'textarea' || tag === 'select' || el.isContentEditable;
      }
      document.addEventListener('keydown', function(e) {
        var isK = (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.key === 'k' || e.key === 'K');
        var isSlash = e.key === '/' && !e.ctrlKey && !e.metaKey && !e.altKey && !typing(document.activeElement);
        if (!isK && !isSlash) return;
        var inp = input();
        if (!inp) return;
        e.preventDefault();
        inp.focus();
        inp.select();
      }, true);
      document.addEventListener('keydown', function(e) { if (e.key === 'Escape') hide(); });
    })();
  `;
}

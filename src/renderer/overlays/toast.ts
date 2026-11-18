// In-app toasts: short, non-blocking confirmations ("Saved to offline",
// "Queue: 24 tracks", "Sleep timer: 15 min") shown above the player bar.
//
//   window.__scToast(message, { kind: 'info' | 'success' | 'error', ms })
//
// The message is always written with textContent, so track titles and other
// page-provided strings can be passed straight in.

export function getToastScript(): string {
  return `
    (function() {
      if (window.__scToast) return;
      var MAX = 3;
      var host = null;

      function ensureHost() {
        if (host && host.isConnected) return host;
        host = document.createElement('div');
        host.id = 'sc-toasts';
        host.setAttribute('role', 'status');
        host.setAttribute('aria-live', 'polite');
        document.body.appendChild(host);
        return host;
      }

      function dismiss(el) {
        if (!el || el.dataset.leaving) return;
        el.dataset.leaving = '1';
        el.classList.remove('sc-toast-in');
        setTimeout(function() { if (el.parentNode) el.parentNode.removeChild(el); }, 260);
      }

      window.__scToast = function(message, opts) {
        try {
          var text = String(message == null ? '' : message).slice(0, 300);
          if (!text) return;
          opts = opts || {};
          var kind = opts.kind === 'success' || opts.kind === 'error' ? opts.kind : 'info';
          var ms = Math.max(1200, Math.min(10000, Number(opts.ms) || 3200));
          var box = ensureHost();
          // The same text twice in a row refreshes the existing toast.
          var last = box.lastElementChild;
          if (last && !last.dataset.leaving && last.dataset.text === text) {
            clearTimeout(Number(last.dataset.timer));
            last.dataset.timer = String(setTimeout(function() { dismiss(last); }, ms));
            return;
          }
          while (box.children.length >= MAX) box.removeChild(box.firstElementChild);
          var el = document.createElement('div');
          el.className = 'sc-toast sc-toast-' + kind;
          el.dataset.text = text;
          var dot = document.createElement('span');
          dot.className = 'sc-toast-dot';
          var label = document.createElement('span');
          label.className = 'sc-toast-text';
          label.textContent = text;
          el.appendChild(dot);
          el.appendChild(label);
          el.addEventListener('click', function() { dismiss(el); });
          box.appendChild(el);
          void el.offsetWidth;
          el.classList.add('sc-toast-in');
          el.dataset.timer = String(setTimeout(function() { dismiss(el); }, ms));
        } catch (e) { /* toasts are best effort */ }
      };
    })();
  `;
}

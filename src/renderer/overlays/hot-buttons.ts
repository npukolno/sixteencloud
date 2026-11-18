import { getScriptTranslations } from '../../shared/i18n';
import { scJs } from '../../shared/sc-selectors';

// Quick actions in SoundCloud's bottom bar, right after the cover/title
// badge: full-screen lyrics, add to the download queue, save for offline.
// SoundCloud may re-render the bar, so the group is re-attached when missing.

const ICONS = {
  lyrics: '<path d="M4 6h10M4 10h10M4 14h6"/><path d="M18 5v9.5"/><circle cx="16" cy="16.5" r="2.5"/>',
  download: '<path d="M12 4v11m-4-4 4 4 4-4M5 20h14"/>',
  offline: '<path d="M7 18a4 4 0 0 1-.6-7.95A6 6 0 0 1 18 9.5a3.5 3.5 0 0 1 .5 6.96"/><path d="M12 11v7m0 0-2.5-2.5M12 18l2.5-2.5"/>',
};

function iconSvg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

export function getHotButtonsScript(): string {
  const tr = JSON.stringify(getScriptTranslations([
    'hot.lyrics', 'hot.download', 'hot.offline', 'hot.queued', 'hot.queue_failed', 'hot.offline_saved',
    'hot.offline_already', 'hot.offline_failed', 'hot.offline_disabled', 'hot.saving', 'hot.no_track',
  ]));
  return `
    (function() {
      if (window.__scHotButtons) return;
      window.__scHotButtons = true;
      var api = window.sixteenCloud;
      if (!api) return;
      var _tr = ${tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) for (var x in p) s = s.replace('{' + x + '}', p[x]); return s; }
      var SLOT = ${scJs('SOUND_BADGE_SLOT')};
      var ELEMENTS = ${scJs('PLAYER_ELEMENTS')};
      var ICONS = ${JSON.stringify({ lyrics: iconSvg(ICONS.lyrics), download: iconSvg(ICONS.download), offline: iconSvg(ICONS.offline) })};
      function toast(msg, kind) { if (window.__scToast) window.__scToast(msg, { kind: kind }); }

      function button(id, label) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sc-hot-btn';
        b.setAttribute('data-hot', id);
        b.title = label;
        b.setAttribute('aria-label', label);
        b.innerHTML = ICONS[id];
        return b;
      }

      var group = document.createElement('div');
      group.id = 'sc-hot-buttons';
      group.appendChild(button('lyrics', _t('hot.lyrics')));
      group.appendChild(button('download', _t('hot.download')));
      group.appendChild(button('offline', _t('hot.offline')));

      function attach() {
        if (group.isConnected) return;
        var slot = document.querySelector(SLOT);
        if (slot && slot.parentNode) { slot.parentNode.insertBefore(group, slot.nextSibling); return; }
        var elements = document.querySelector(ELEMENTS);
        if (elements) elements.appendChild(group);
      }
      attach();
      setInterval(attach, 2000);

      // The playing track, with the cleanest metadata available: the API
      // catalogue first (exact title/artist), the player badge otherwise.
      function playing() {
        var c = window.__scPlayer && window.__scPlayer.current();
        if (!c || !c.path || c.path.split('/').filter(Boolean).length < 2) return null;
        var info = window.__scTracks && window.__scTracks.byPath ? window.__scTracks.byPath[c.path] : null;
        var art = (info && info.artwork) || c.artwork || '';
        if (art) art = String(art).replace(/-(?:large|t\\d+x\\d+|small|badge|crop)\\./, '-t500x500.');
        var au = window.__scAudioElement;
        return {
          trackUrl: 'https://soundcloud.com' + c.path,
          trackId: c.path.replace(/^\\/+/, ''),
          title: (info && info.title) || c.title || '',
          artist: (info && info.artist) || c.artist || '',
          artworkUrl: /^https:\\/\\/[^/]*sndcdn\\.com\\//i.test(art) ? art : '',
          duration: au && isFinite(au.duration) ? au.duration : 0
        };
      }

      function busy(btn, on) {
        btn.disabled = on;
        btn.classList.toggle('busy', on);
      }

      group.addEventListener('click', function(e) {
        var btn = e.target.closest ? e.target.closest('.sc-hot-btn') : null;
        if (!btn || btn.disabled) return;
        var action = btn.getAttribute('data-hot');
        if (action === 'lyrics') {
          if (typeof window.__scLyricsToggleFs === 'function') window.__scLyricsToggleFs();
          return;
        }
        var track = playing();
        if (!track) { toast(_t('hot.no_track'), 'error'); return; }
        if (action === 'download') {
          busy(btn, true);
          api.storeGet('downloader.quality').catch(function() { return null; }).then(function(q) {
            return api.downloadQueueAdd({
              trackUrl: track.trackUrl,
              trackId: track.trackId,
              title: track.title || track.trackId,
              artist: track.artist || 'Unknown',
              artworkUrl: track.artworkUrl,
              quality: q === '256' || q === 'original' ? q : '128'
            });
          }).then(function() {
            toast(_t('hot.queued', { title: track.title || track.trackId }), 'success');
          }).catch(function() {
            toast(_t('hot.queue_failed'), 'error');
          }).then(function() { busy(btn, false); });
          return;
        }
        if (action === 'offline') {
          busy(btn, true);
          api.storeGet('offlineCache.enabled').then(function(enabled) {
            if (!enabled) {
              toast(_t('hot.offline_disabled'));
              var item = document.querySelector('#sc-overlay-rail .sc-nav-item[data-target="offline-cache"]');
              if (item) item.click();
              return;
            }
            toast(_t('hot.saving'));
            return api.offlineCacheUrl(track).then(function(r) {
              if (r && r.success && r.message) toast(_t('hot.offline_already'));
              else if (r && r.success) toast(_t('hot.offline_saved', { title: track.title || track.trackId }), 'success');
              else toast(_t('hot.offline_failed'), 'error');
            });
          }).catch(function() {
            toast(_t('hot.offline_failed'), 'error');
          }).then(function() { busy(btn, false); });
        }
      });
    })();
  `;
}

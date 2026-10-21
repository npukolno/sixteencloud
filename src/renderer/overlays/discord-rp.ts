import { t, getScriptTranslations } from '../../shared/i18n';

export function getDiscordRpOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('discord.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-status" id="sc-discord-status">
        <span class="sc-overlay-status-dot gray" id="sc-discord-status-dot"></span>
        <span class="sc-overlay-status-text" id="sc-discord-status-text">${t('discord.not_connected')}</span>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.enable')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-toggle" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>
      <div class="sc-overlay-hint">${t('discord.browser_hint')}</div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.display_paused')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-paused">
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-section">
        <div class="sc-overlay-section-title">${t('discord.display_options')}</div>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.show_artist')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-show-artist" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.show_time')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-show-time" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.small_icon')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-small-icon" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.display_buttons')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-buttons" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>
      <div class="sc-overlay-hint">${t('discord.buttons_hint')}</div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.artist_app_name')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-artist-name">
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>
      <div class="sc-overlay-hint">${t('discord.artist_hint')}</div>

      <div class="sc-overlay-section">
        <div class="sc-overlay-section-title">${t('discord.preview')}</div>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('discord.enable_preview')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-discord-enable-preview" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div id="sc-discord-preview-wrap" style="margin-top: 12px;">
        <div style="background: var(--sc-bg); border-radius: 8px; padding: 14px; border: 1px solid var(--sc-border);">
          <div style="display: flex; gap: 12px; align-items: flex-start;">
            <div style="position: relative; flex-shrink: 0;">
              <div id="sc-discord-preview-art" style="width: 64px; height: 64px; background: var(--sc-surface-raised); border-radius: 8px;"></div>
              <div id="sc-discord-preview-small-icon" style="position: absolute; bottom: -3px; right: -3px; width: 26px; height: 26px; background: var(--sc-bg) url(data:image/png;base64,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) center/68% no-repeat; border-radius: 50%; border: 3px solid var(--sc-bg); display: flex;"></div>
            </div>
            <div style="flex: 1; min-width: 0;">
              <div style="font-weight: 700; color: #fff; font-size: 13px; margin-bottom: 2px;" id="sc-discord-preview-app">SixteenCloud</div>
              <div style="font-weight: 600; color: var(--sc-text); font-size: 13px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="sc-discord-preview-title">${t('discord.no_track')}</div>
              <div style="color: var(--sc-text-muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;" id="sc-discord-preview-artist"></div>
              <div style="color: var(--sc-text-muted); font-size: 11px; margin-top: 3px;" id="sc-discord-preview-time"></div>
            </div>
          </div>
          <div id="sc-discord-preview-btn" style="margin-top: 10px;">
            <div style="display: inline-block; padding: 6px 16px; background: var(--sc-surface-raised); border-radius: 4px; font-size: 12px; color: var(--sc-text); cursor: default;">${t('discord.listen_on_sc')}</div>
          </div>
        </div>
      </div>
    </div>
  `;
}

export function getDiscordRpOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'discord.connected', 'discord.not_connected', 'discord.no_track',
  ]));
  return `
    (function() {
      const panel = document.querySelector('[data-overlay="discord-rp"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      const api = window.sixteenCloud;
      if (!api) return;

      const toggle = panel.querySelector('#sc-discord-toggle');
      const paused = panel.querySelector('#sc-discord-paused');
      const showArtist = panel.querySelector('#sc-discord-show-artist');
      const showTime = panel.querySelector('#sc-discord-show-time');
      const smallIcon = panel.querySelector('#sc-discord-small-icon');
      const buttons = panel.querySelector('#sc-discord-buttons');
      const artistName = panel.querySelector('#sc-discord-artist-name');
      const enablePreview = panel.querySelector('#sc-discord-enable-preview');
      const statusDot = panel.querySelector('#sc-discord-status-dot');
      const statusText = panel.querySelector('#sc-discord-status-text');
      const previewTitle = panel.querySelector('#sc-discord-preview-title');
      const previewArtist = panel.querySelector('#sc-discord-preview-artist');
      const previewTime = panel.querySelector('#sc-discord-preview-time');
      const previewArt = panel.querySelector('#sc-discord-preview-art');
      const previewApp = panel.querySelector('#sc-discord-preview-app');
      const previewSmallIcon = panel.querySelector('#sc-discord-preview-small-icon');
      const previewBtn = panel.querySelector('#sc-discord-preview-btn');
      const previewWrap = panel.querySelector('#sc-discord-preview-wrap');

      // Load state
      api.storeGet('discordRp').then(function(state) {
        if (!state) return;
        toggle.checked = state.enabled !== false;
        paused.checked = state.displayWhenPaused || false;
        showArtist.checked = state.showArtist !== false;
        showTime.checked = state.showTime !== false;
        smallIcon.checked = state.displaySmallIcon !== false;
        buttons.checked = state.displayButtons !== false;
        artistName.checked = state.useArtistName || false;
        enablePreview.checked = state.enablePreview !== false;
        updatePreviewVisibility();
      });

      function save(key, val) { api.storeSet('discordRp.' + key, val); }

      toggle.addEventListener('change', function() {
        api.discordToggle(toggle.checked);
        save('enabled', toggle.checked);
      });
      paused.addEventListener('change', function() { save('displayWhenPaused', paused.checked); });
      showArtist.addEventListener('change', function() { save('showArtist', showArtist.checked); });
      showTime.addEventListener('change', function() { save('showTime', showTime.checked); });
      smallIcon.addEventListener('change', function() {
        save('displaySmallIcon', smallIcon.checked);
        previewSmallIcon.style.display = smallIcon.checked ? 'flex' : 'none';
      });
      buttons.addEventListener('change', function() {
        save('displayButtons', buttons.checked);
        previewBtn.style.display = buttons.checked ? 'block' : 'none';
      });
      artistName.addEventListener('change', function() { save('useArtistName', artistName.checked); });
      enablePreview.addEventListener('change', function() {
        save('enablePreview', enablePreview.checked);
        updatePreviewVisibility();
      });

      function updatePreviewVisibility() {
        previewWrap.style.display = enablePreview.checked ? 'block' : 'none';
      }

      api.onDiscordState(function(state) {
        if (state.connected) {
          statusDot.className = 'sc-overlay-status-dot green';
          statusText.textContent = _t('discord.connected');
        } else {
          statusDot.className = 'sc-overlay-status-dot red';
          statusText.textContent = state.error || _t('discord.not_connected');
        }

        if (state.track) {
          previewTitle.textContent = state.track.title || 'Unknown';
          previewArtist.textContent = showArtist.checked ? ('by ' + (state.track.artist || '')) : '';
          previewApp.textContent = artistName.checked && state.track.artist ? state.track.artist : 'SixteenCloud';
          if (showTime.checked && state.track.currentTime !== undefined) {
            previewTime.textContent = formatTime(state.track.currentTime) + ' / ' + formatTime(state.track.duration);
          } else {
            previewTime.textContent = '';
          }
          if (state.track.artworkUrl) {
            previewArt.style.backgroundImage = 'url(' + state.track.artworkUrl + ')';
            previewArt.style.backgroundSize = 'cover';
            previewArt.style.borderRadius = '8px';
          }
        }
      });

      function formatTime(s) {
        var m = Math.floor(s / 60);
        var sec = Math.floor(s % 60);
        return m + ':' + (sec < 10 ? '0' : '') + sec;
      }

      function parseTimeStr(str) {
        if (!str) return 0;
        var parts = str.trim().split(':');
        if (parts.length === 2) return parseInt(parts[0]) * 60 + parseInt(parts[1]);
        if (parts.length === 3) return parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseInt(parts[2]);
        return 0;
      }

      // Track detection. Presence updates are throttled to meaningful changes
      // (or a 15-second playback bucket) to avoid redundant IPC/RPC writes.
      var lastSentSignature = '';
      function detectAndSendTrack() {
        var audio = document.querySelector('audio');
        var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
        var artistEl = document.querySelector('.playbackSoundBadge__lightLink');

        if (titleEl) {
          var title = titleEl.getAttribute('title') || titleEl.textContent || '';
          var artist = artistEl ? (artistEl.getAttribute('title') || artistEl.textContent || '') : '';

          // Try multiple methods to find artwork URL
          var artworkUrl = '';

          // Method 1: playbackSoundBadge avatar with background-image
          var avatarSpans = document.querySelectorAll('.playbackSoundBadge__avatar span');
          for (var i = 0; i < avatarSpans.length; i++) {
            var bgImg = avatarSpans[i].style.backgroundImage;
            if (bgImg && bgImg.indexOf('url') !== -1) {
              artworkUrl = bgImg.replace(/url\\(["']?/, '').replace(/["']?\\)/, '');
              break;
            }
          }

          // Method 2: img inside playbackSoundBadge
          if (!artworkUrl) {
            var img = document.querySelector('.playbackSoundBadge__avatar img');
            if (img) artworkUrl = img.src || '';
          }

          // Method 3: any sc-artwork in the player bar
          if (!artworkUrl) {
            var scArt = document.querySelector('.playControls .sc-artwork span[style]');
            if (scArt && scArt.style.backgroundImage) {
              artworkUrl = scArt.style.backgroundImage.replace(/url\\(["']?/, '').replace(/["']?\\)/, '');
            }
          }

          // Upgrade to large size
          if (artworkUrl) {
            artworkUrl = artworkUrl
              .replace(/-t50x50/, '-t500x500')
              .replace(/-t120x120/, '-t500x500')
              .replace(/-t200x200/, '-t500x500')
              .replace(/-large/, '-t500x500');
            // Ensure https
            if (artworkUrl.startsWith('//')) artworkUrl = 'https:' + artworkUrl;
          }

          // Detect play state via multiple methods
          var isPlaying = false;
          var duration = 0;
          var currentTime = 0;

          // Method 1: <audio> element
          if (audio && !audio.paused) {
            isPlaying = true;
          }

          // Method 2: check all audio elements (SC may create multiple)
          if (!isPlaying) {
            var allAudio = document.querySelectorAll('audio');
            for (var a = 0; a < allAudio.length; a++) {
              if (!allAudio[a].paused) {
                isPlaying = true;
                audio = allAudio[a];
                break;
              }
            }
          }

          // Method 3: play button state — if it shows pause icon, music is playing
          if (!isPlaying) {
            var playBtn = document.querySelector('.playControl');
            if (playBtn && playBtn.classList.contains('playing')) {
              isPlaying = true;
            }
          }

          if (audio) {
            duration = audio.duration || 0;
            currentTime = audio.currentTime || 0;
          }

          // Method 4: progress bar for duration/time if audio element missing
          if (!duration) {
            var progressEl = document.querySelector('.playbackTimeline__progressWrapper');
            var timeEls = document.querySelectorAll('.playbackTimeline__timePassed span:last-child, .playbackTimeline__duration span:last-child');
            if (timeEls.length >= 2) {
              currentTime = parseTimeStr(timeEls[0].textContent || '');
              duration = parseTimeStr(timeEls[1].textContent || '');
            }
          }

          var info = {
            title: title.trim(),
            artist: artist.trim(),
            artworkUrl: artworkUrl,
            duration: duration,
            currentTime: currentTime,
            isPlaying: isPlaying,
            trackUrl: (function() {
              var linkEl = document.querySelector('.playbackSoundBadge__titleLink');
              if (linkEl && linkEl.getAttribute('href')) {
                var h = linkEl.getAttribute('href');
                return h.startsWith('/') ? 'https://soundcloud.com' + h : h;
              }
              return window.location.href;
            })(),
            trackId: ''
          };
          var signature = [
            info.title, info.artist, info.artworkUrl, info.duration,
            info.isPlaying ? '1' : '0', Math.floor(info.currentTime / 15), info.trackUrl
          ].join('|');
          if (signature !== lastSentSignature) {
            lastSentSignature = signature;
            api.sendTrackInfo(info);
          }
        }
      }

      var discordPollTimer = null;
      function scheduleDiscordPoll() {
        discordPollTimer = setTimeout(function() {
          discordPollTimer = null;
          detectAndSendTrack();
          scheduleDiscordPoll();
        }, document.hidden ? 10000 : 3000);
      }
      document.addEventListener('visibilitychange', function() {
        if (!document.hidden) detectAndSendTrack();
        if (!discordPollTimer) scheduleDiscordPoll();
      });
      detectAndSendTrack();
      scheduleDiscordPoll();
    })();
  `;
}

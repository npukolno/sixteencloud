import { t, getScriptTranslations } from '../../shared/i18n';

const QUEUE_PAUSE_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" stroke="none"><rect x="6.6" y="4.5" width="4.4" height="15" rx="1.7"/><rect x="13" y="4.5" width="4.4" height="15" rx="1.7"/></svg>';
const QUEUE_PLAY_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="currentColor" stroke="none"><path d="M8 5.1c0-1.06 1.15-1.72 2.06-1.18l10.02 6.9c.85.59.85 1.77 0 2.36L10.06 20.08C9.15 20.62 8 19.96 8 18.9V5.1Z"/></svg>';

export function getDownloaderOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('downloader.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('downloader.current_track')}</span>
        <div class="sc-overlay-status" id="sc-dl-track-status">
          <span class="sc-overlay-status-dot gray" id="sc-dl-track-dot"></span>
          <span class="sc-overlay-status-text" id="sc-dl-track-text">${t('downloader.navigate')}</span>
        </div>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('downloader.quality')}</span>
        <select class="sc-overlay-select" id="sc-dl-quality">
          <option value="128">${t('downloader.mp3_128')}</option>
          <option value="256">${t('downloader.mp3_256')}</option>
          <option value="original">${t('downloader.original')}</option>
        </select>
      </div>

      <button class="sc-overlay-btn sc-overlay-btn-primary sc-overlay-btn-full" id="sc-dl-download-btn" disabled>
        ${t('downloader.download_track')}
      </button>

      <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-dl-queue-btn" style="margin-top: 8px;">
        ${t('downloader.add_to_queue')}
      </button>

      <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-dl-playlist-btn" style="display: none; margin-top: 8px;">
        ${t('downloader.download_playlist')}
      </button>

      <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-dl-liked-btn" style="margin-top: 8px;">
        ${t('downloader.download_liked')}
      </button>

      <!-- Single track progress -->
      <div id="sc-dl-single-progress" style="display: none; margin-top: 12px;">
        <div style="font-size: 13px; color: #ccc; margin-bottom: 6px;" id="sc-dl-single-track-name"></div>
        <div style="position: relative; height: 24px; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden;">
          <div id="sc-dl-single-bar" style="height: 100%; background: linear-gradient(90deg, #f50, #ff8c00); border-radius: 6px; transition: width 0.3s; width: 0%;"></div>
          <div id="sc-dl-single-percent" style="position: absolute; top: 0; left: 0; right: 0; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 12px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">0%</div>
        </div>
        <div style="font-size: 12px; color: #999; margin-top: 4px;" id="sc-dl-single-stage"></div>
      </div>

      <!-- Playlist progress -->
      <div id="sc-dl-playlist-progress" style="display: none; margin-top: 12px;">
        <div style="font-size: 13px; color: #ccc; margin-bottom: 4px;" id="sc-dl-playlist-track-name"></div>
        <div style="font-size: 12px; color: #999; margin-bottom: 6px;" id="sc-dl-playlist-status"></div>
        <!-- Overall playlist bar -->
        <div style="position: relative; height: 20px; background: rgba(255,255,255,0.08); border-radius: 6px; overflow: hidden; margin-bottom: 4px;">
          <div id="sc-dl-playlist-bar" style="height: 100%; background: linear-gradient(90deg, #f50, #ff8c00); border-radius: 6px; transition: width 0.3s; width: 0%;"></div>
          <div id="sc-dl-playlist-percent" style="position: absolute; top: 0; left: 0; right: 0; height: 100%; display: flex; align-items: center; justify-content: center; font-size: 11px; font-weight: 600; color: #fff; text-shadow: 0 1px 2px rgba(0,0,0,0.5);">0%</div>
        </div>
        <!-- Current track bar -->
        <div style="position: relative; height: 8px; background: rgba(255,255,255,0.06); border-radius: 4px; overflow: hidden;">
          <div id="sc-dl-playlist-track-bar" style="height: 100%; background: rgba(255,136,0,0.5); border-radius: 4px; transition: width 0.3s; width: 0%;"></div>
        </div>
      </div>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('downloader.output_folder')}</span>
        <button class="sc-overlay-btn sc-overlay-btn-secondary sc-overlay-btn-full" id="sc-dl-set-dir">
          ${t('downloader.choose_folder')}
        </button>
        <div style="font-size: 12px; color: #888; margin-top: 6px;" id="sc-dl-dir-display">~/Music/SixteenCloud/</div>
      </div>

      <!-- Queue section -->
      <div class="sc-overlay-group" style="margin-top: 16px;">
        <div style="display:flex;align-items:center;justify-content:space-between;">
          <span class="sc-overlay-label" style="margin-bottom:0;">${t('downloader.queue')}</span>
          <button class="sc-overlay-btn sc-overlay-btn-secondary sc-queue-toggle" id="sc-dl-queue-toggle" aria-label="${t('downloader.queue_pause')}" title="${t('downloader.queue_pause')}">${QUEUE_PAUSE_SVG}</button>
        </div>
        <ul class="sc-overlay-list" id="sc-dl-queue-list" style="max-height:200px;overflow-y:auto;">
          <li class="sc-overlay-list-item" style="color:#888;font-size:12px;">${t('downloader.queue_empty')}</li>
        </ul>
      </div>

      <div class="sc-overlay-group" style="margin-top: 16px;">
        <span class="sc-overlay-label">${t('downloader.download_history')}</span>
        <ul class="sc-overlay-list" id="sc-dl-history"></ul>
      </div>
    </div>
  `;
}

export function getDownloaderOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'downloader.navigate', 'downloader.starting', 'downloader.downloading',
    'downloader.converting', 'downloader.tagging', 'downloader.downloaded',
    'downloader.error', 'downloader.starting_playlist', 'downloader.track_of',
    'downloader.playlist_complete', 'downloader.download_playlist', 'downloader.btn_downloading',
    'downloader.downloading_track', 'downloader.playlist_track_progress', 'downloader.zipping',
    'downloader.queue_empty', 'downloader.queue_paused', 'downloader.queue_pause',
    'downloader.queue_resume', 'downloader.add_to_queue', 'downloader.download_liked',
    'downloader.liked_requires_auth', 'downloader.fetching_likes',
  ]));
  return `
    (function() {
      const panel = document.querySelector('[data-overlay="downloader"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k, p) { var s = _tr[k] || k; if (p) { for (var pk in p) s = s.replace('{' + pk + '}', p[pk]); } return s; }

      const api = window.sixteenCloud;
      if (!api) return;
      var QUEUE_PAUSE_SVG = ${JSON.stringify(QUEUE_PAUSE_SVG)};
      var QUEUE_PLAY_SVG = ${JSON.stringify(QUEUE_PLAY_SVG)};

      const dlBtn = panel.querySelector('#sc-dl-download-btn');
      const qualitySelect = panel.querySelector('#sc-dl-quality');
      const trackDot = panel.querySelector('#sc-dl-track-dot');
      const trackText = panel.querySelector('#sc-dl-track-text');
      const setDirBtn = panel.querySelector('#sc-dl-set-dir');
      const dirDisplay = panel.querySelector('#sc-dl-dir-display');
      const historyList = panel.querySelector('#sc-dl-history');

      // Single track progress elements
      var singleProgress = panel.querySelector('#sc-dl-single-progress');
      var singleTrackName = panel.querySelector('#sc-dl-single-track-name');
      var singleBar = panel.querySelector('#sc-dl-single-bar');
      var singlePercent = panel.querySelector('#sc-dl-single-percent');
      var singleStage = panel.querySelector('#sc-dl-single-stage');

      // Playlist progress elements
      var playlistBtn = panel.querySelector('#sc-dl-playlist-btn');
      var playlistProgressEl = panel.querySelector('#sc-dl-playlist-progress');
      var playlistTrackName = panel.querySelector('#sc-dl-playlist-track-name');
      var playlistStatus = panel.querySelector('#sc-dl-playlist-status');
      var playlistBar = panel.querySelector('#sc-dl-playlist-bar');
      var playlistPercent = panel.querySelector('#sc-dl-playlist-percent');
      var playlistTrackBar = panel.querySelector('#sc-dl-playlist-track-bar');

      let currentTrack = null;

      // Load settings
      api.storeGet('downloader').then(function(state) {
        if (!state) return;
        qualitySelect.value = state.quality || '128';
        if (state.outputDir) dirDisplay.textContent = state.outputDir;
        renderHistory(state.history || []);
      });

      // Detect current track. Only the pathname is authoritative: a track
      // opened from a playlist carries "?in=<user>/sets/<set>" in the query
      // string, which must never be mistaken for a playlist page.
      var NON_TRACK_ROOTS = ['you', 'discover', 'search', 'charts', 'stream', 'feed', 'upload', 'messages', 'settings', 'library', 'popular', 'tags', 'pro', 'artists', 'pages', 'mobile', 'imprint', 'terms-of-use', 'jobs', 'widget', 'premium', 'explore', 'account', 'dashboard'];
      function currentPathname() {
        return (window.location.pathname || '/').replace(/\\/+$/, '') || '/';
      }
      var lastDetectedUrl = null;
      var detectSeq = 0;
      // The player badge is the layout-independent source of the track that is
      // actually playing; the opened page can be showing a different one.
      function readPlayingTrack() {
        var link = document.querySelector('a.playbackSoundBadge__titleLink');
        if (!link) return null;
        var href = link.getAttribute('href') || '';
        if (href.indexOf('/') !== 0) return null;
        var title = (link.getAttribute('title') || '').trim();
        if (!title) {
          var span = link.querySelector('span[aria-hidden="true"]');
          if (span) title = (span.textContent || '').trim();
        }
        if (!title) title = (link.textContent || '').replace(/^Current track:\\s*/i, '').trim();
        if (!title) return null;
        var artist = '';
        var artistEl = document.querySelector('a.playbackSoundBadge__lightLink');
        if (artistEl) artist = (artistEl.getAttribute('title') || artistEl.textContent || '').trim();
        artist = artist.replace(/\\s*\\(@[^)]*\\)\\s*$/, '').trim();
        return { href: href, title: title, artist: artist };
      }

      function detectTrack() {
        var path = currentPathname();
        var segs = path.split('/').filter(Boolean);
        var isPlaylist = segs.indexOf('sets') !== -1;
        var isTrackPage = segs.length === 2 && !isPlaylist && NON_TRACK_ROOTS.indexOf(segs[0].toLowerCase()) === -1;

        if (isPlaylist) {
          playlistBtn.style.display = 'block';
          playlistBtn.disabled = false;
        } else {
          playlistBtn.style.display = 'none';
        }

        // What is playing wins; the page URL is only a fallback for when the
        // player holds nothing.
        var playing = readPlayingTrack();
        var playingPath = playing ? playing.href : '';
        var trackUrl = playing
          ? window.location.origin + playingPath
          : (isTrackPage ? window.location.origin + path : null);

        if (trackUrl === lastDetectedUrl) return;
        lastDetectedUrl = trackUrl;

        if (!trackUrl) {
          detectSeq++;
          currentTrack = null;
          trackDot.className = 'sc-overlay-status-dot gray';
          trackText.textContent = _t('downloader.navigate');
          dlBtn.disabled = true;
          return;
        }

        // Show the badge/slug instantly, then replace it with canonical API
        // metadata (the modern track page carries no static title markup).
        var seq = ++detectSeq;
        var immTitle, immArtist, immId;
        if (playing) {
          var dash = playing.title.lastIndexOf(' - ');
          immTitle = dash > 0 ? playing.title.slice(dash + 3) : playing.title;
          immArtist = dash > 0 ? playing.title.slice(0, dash) : playing.artist;
          immId = playingPath.replace(/^\\//, '');
        } else {
          immTitle = segs[1].replace(/-/g, ' ');
          immArtist = segs[0];
          immId = segs[0] + '/' + segs[1];
        }
        currentTrack = {
          trackUrl: trackUrl,
          trackId: immId,
          title: immTitle,
          artist: immArtist,
          artworkUrl: ''
        };
        trackDot.className = 'sc-overlay-status-dot green';
        trackText.textContent = currentTrack.title + ' — ' + currentTrack.artist;
        dlBtn.disabled = false;

        api.downloaderResolve(trackUrl).then(function(meta) {
          if (seq !== detectSeq || !currentTrack) return;
          if (!meta) return;
          if (meta.title) currentTrack.title = meta.title;
          if (meta.artist) currentTrack.artist = meta.artist;
          if (meta.artworkUrl) currentTrack.artworkUrl = meta.artworkUrl;
          trackText.textContent = currentTrack.title + ' — ' + currentTrack.artist;
        }).catch(function() { /* keep the instant fallback */ });
      }

      detectTrack();
      // URL changes are event-driven in normal SPA navigation. Keep a small
      // active-panel fallback for routers that do not emit history events.
      // detectTrack itself is change-gated, so calling it every tick is cheap.
      function refreshTrackFromUrl() {
        detectTrack();
      }
      window.addEventListener('popstate', refreshTrackFromUrl);
      window.addEventListener('hashchange', refreshTrackFromUrl);
      var trackPollTimer = null;
      var trackPolling = false;
      function isDownloaderActive() {
        var container = document.getElementById('sc-overlay-container');
        return !document.hidden && panel.classList.contains('active') && !!(container && container.classList.contains('open'));
      }
      function stopTrackPolling() {
        trackPolling = false;
        if (trackPollTimer) { clearTimeout(trackPollTimer); trackPollTimer = null; }
      }
      function scheduleTrackPoll() {
        if (!trackPolling) return;
        if (!isDownloaderActive()) { stopTrackPolling(); return; }
        trackPollTimer = setTimeout(function() {
          trackPollTimer = null;
          if (!isDownloaderActive()) { stopTrackPolling(); return; }
          refreshTrackFromUrl();
          scheduleTrackPoll();
        }, 2000);
      }
      function startTrackPolling() {
        if (trackPolling || !isDownloaderActive()) return;
        trackPolling = true;
        refreshTrackFromUrl();
        scheduleTrackPoll();
      }
      var downloaderSectionObserver = new MutationObserver(function() {
        if (isDownloaderActive()) startTrackPolling(); else stopTrackPolling();
      });
      downloaderSectionObserver.observe(panel, { attributes: true, attributeFilter: ['class'] });
      // Reopening the section that was last active does not touch the panel's
      // own class (it already has "active"), only the container's "open". Watch
      // the container too, otherwise the poller never restarts and the badge
      // keeps the track detected before the overlay was closed.
      var overlayContainer = document.getElementById('sc-overlay-container');
      if (overlayContainer) {
        new MutationObserver(function() {
          if (isDownloaderActive()) startTrackPolling(); else stopTrackPolling();
        }).observe(overlayContainer, { attributes: true, attributeFilter: ['class'] });
      }
      document.addEventListener('visibilitychange', function() {
        if (isDownloaderActive()) startTrackPolling(); else stopTrackPolling();
      });
      startTrackPolling();

      dlBtn.addEventListener('click', function() {
        if (!currentTrack) return;
        dlBtn.disabled = true;

        // Show single track progress
        singleProgress.style.display = 'block';
        singleTrackName.textContent = currentTrack.title + ' — ' + currentTrack.artist;
        singleBar.style.width = '0%';
        singlePercent.textContent = '0%';
        singleStage.textContent = _t('downloader.starting');

        api.downloadTrack({
          trackUrl: currentTrack.trackUrl,
          trackId: currentTrack.trackId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          artworkUrl: currentTrack.artworkUrl,
          quality: qualitySelect.value
        }).catch(function(err) {
          singleStage.textContent = _t('downloader.error', {error: err});
          singleStage.style.color = '#f44';
          dlBtn.disabled = false;
        });
      });

      setDirBtn.addEventListener('click', function() {
        api.downloadSetDir().then(function(dir) {
          if (dir) dirDisplay.textContent = dir;
        });
      });

      playlistBtn.addEventListener('click', function() {
        var url = window.location.href;
        if (currentPathname().split('/').indexOf('sets') === -1) return;
        playlistBtn.disabled = true;
        playlistBtn.textContent = _t('downloader.btn_downloading');
        playlistProgressEl.style.display = 'block';
        playlistStatus.textContent = _t('downloader.starting_playlist');
        playlistBar.style.width = '0%';
        playlistPercent.textContent = '0%';
        playlistTrackBar.style.width = '0%';
        playlistTrackName.textContent = '';

        // Extract OAuth token from page for private playlists
        var pageToken = '';
        try {
          // SoundCloud stores auth in multiple places
          var scData = document.querySelector('#__sc_hydration');
          if (scData) {
            var hydration = JSON.parse(scData.textContent || '[]');
            var authEntry = hydration.find(function(e) { return e.hydratable === 'anonymousId' || e.hydratable === 'user'; });
            if (authEntry && authEntry.data && authEntry.data.auth_token) pageToken = authEntry.data.auth_token;
          }
          if (!pageToken) {
            // Try getting from cookie directly
            var cookies = document.cookie.split(';');
            for (var ci = 0; ci < cookies.length; ci++) {
              var c = cookies[ci].trim();
              if (c.startsWith('oauth_token=')) { pageToken = c.substring(12); break; }
            }
          }
        } catch(e) {}

        api.downloadPlaylist(url, pageToken).catch(function(err) {
          playlistStatus.textContent = _t('downloader.error', {error: err});
          playlistBtn.disabled = false;
          playlistBtn.textContent = _t('downloader.download_playlist');
        });
      });

      api.onDownloadProgress(function(p) {
        if (p.playlistIndex !== undefined) {
          // Playlist progress
          var trackName = p.trackName || '';
          var idx = p.playlistIndex + 1;
          var total = p.playlistTotal;
          playlistTrackName.textContent = trackName || (_t('downloader.track_of', {index: '' + idx, total: '' + total, status: ''}));
          var stageText = p.status === 'downloading' ? _t('downloader.downloading', {percent: '' + (p.percent || 0)})
            : p.status === 'converting' ? _t('downloader.converting')
            : p.status === 'tagging' ? _t('downloader.tagging')
            : p.status === 'zipping' ? _t('downloader.zipping')
            : p.status;
          playlistStatus.textContent = idx + '/' + total + ' — ' + stageText;

          // Overall progress: completed tracks + current track fraction
          var overallPercent = Math.round(((p.playlistIndex) / total) * 100 + (p.percent || 0) / total);
          playlistBar.style.width = overallPercent + '%';
          playlistPercent.textContent = overallPercent + '%';

          // Current track bar
          playlistTrackBar.style.width = (p.percent || 0) + '%';
          return;
        }

        // Single track progress
        singleBar.style.width = (p.percent || 0) + '%';
        singlePercent.textContent = (p.percent || 0) + '%';
        singleStage.style.color = '#999';
        singleStage.textContent = p.status === 'downloading' ? _t('downloader.downloading', {percent: '' + p.percent})
          : p.status === 'converting' ? _t('downloader.converting')
          : p.status === 'tagging' ? _t('downloader.tagging')
          : p.status;
      });

      api.onDownloadComplete(function(result) {
        if (result.playlistDone) {
          playlistBtn.disabled = false;
          playlistBtn.textContent = _t('downloader.download_playlist');
          playlistBar.style.width = '100%';
          playlistPercent.textContent = '100%';
          playlistTrackBar.style.width = '100%';
          playlistStatus.textContent = _t('downloader.playlist_complete', {count: '' + result.total});
          playlistTrackName.textContent = '';
          api.storeGet('downloader.history').then(function(h) { renderHistory(h || []); });
          try { new Notification('SixteenCloud', { body: _t('downloader.playlist_complete', {count: '' + result.total}) }); } catch(e) {}
          return;
        }
        dlBtn.disabled = false;
        if (result.error) {
          singleStage.textContent = _t('downloader.error', {error: result.error});
          singleStage.style.color = '#f44';
        } else {
          singleBar.style.width = '100%';
          singlePercent.textContent = '100%';
          singleStage.style.color = '#4f4';
          singleStage.textContent = _t('downloader.downloaded');
          var trackName = currentTrack ? (currentTrack.title + ' — ' + currentTrack.artist) : '';
          try { new Notification('SixteenCloud', { body: _t('downloader.downloaded') + (trackName ? ' ' + trackName : '') }); } catch(e) {}
        }
        api.storeGet('downloader.history').then(function(h) { renderHistory(h || []); });
      });

      function renderHistory(items) {
        historyList.innerHTML = items.slice(-20).reverse().map(function(item) {
          return '<li class="sc-overlay-list-item"><div>' +
            '<div class="sc-overlay-list-item-title">' + window.__scEscapeHtml(item.title || '') + '</div>' +
            '<div class="sc-overlay-list-item-sub">' + window.__scEscapeHtml(item.artist || '') + ' · ' + window.__scEscapeHtml(item.date || '') + '</div>' +
            '</div></li>';
        }).join('');
      }

      // === Queue UI ===
      var queueBtn = panel.querySelector('#sc-dl-queue-btn');
      var queueList = panel.querySelector('#sc-dl-queue-list');
      var queueToggle = panel.querySelector('#sc-dl-queue-toggle');
      var likedBtn = panel.querySelector('#sc-dl-liked-btn');
      var queuePausedState = false;

      queueBtn.addEventListener('click', function() {
        if (!currentTrack) return;
        api.downloadQueueAdd({
          trackUrl: currentTrack.trackUrl,
          trackId: currentTrack.trackId,
          title: currentTrack.title,
          artist: currentTrack.artist,
          artworkUrl: currentTrack.artworkUrl,
          quality: qualitySelect.value
        });
      });

      queueToggle.addEventListener('click', function() {
        if (queuePausedState) {
          api.downloadQueueResume();
        } else {
          api.downloadQueuePause();
        }
      });

      api.onDownloadQueueState(function(state) {
        queuePausedState = state.paused;
        queueToggle.innerHTML = state.paused ? QUEUE_PLAY_SVG : QUEUE_PAUSE_SVG;
        queueToggle.title = state.paused ? _t('downloader.queue_resume') : _t('downloader.queue_pause');
        queueToggle.setAttribute('aria-label', queueToggle.title);
        if (!state.items || !state.items.length) {
          queueList.innerHTML = '<li class="sc-overlay-list-item" style="color:#888;font-size:12px;">' + _t('downloader.queue_empty') + '</li>';
          return;
        }
        queueList.innerHTML = state.items.map(function(item) {
          var statusClass = item.status === 'downloading' ? 'downloading' : item.status === 'done' ? 'done' : item.status === 'error' ? 'error' : 'pending';
          var statusIcon = '<span class="sc-queue-status ' + statusClass + '" aria-hidden="true"></span>';
          var removeBtn = (item.status === 'pending') ? ' <button class="sc-queue-remove sc-overlay-btn-icon" data-id="' + window.__scEscapeHtml(item.trackId) + '" title="Remove" aria-label="Remove">&times;</button>' : '';
          return '<li class="sc-overlay-list-item" style="font-size:12px;display:flex;align-items:center;justify-content:space-between;"><div>' +
            statusIcon + ' ' + window.__scEscapeHtml(item.title || '') + ' — ' + window.__scEscapeHtml(item.artist || '') +
            '</div>' + removeBtn + '</li>';
        }).join('');
        // Bind remove buttons
        queueList.querySelectorAll('.sc-queue-remove').forEach(function(el) {
          el.addEventListener('click', function() {
            api.downloadQueueRemove(el.dataset.id);
          });
        });
      });

      // === Liked tracks ===
      likedBtn.addEventListener('click', function() {
        likedBtn.disabled = true;
        likedBtn.textContent = _t('downloader.fetching_likes');
        api.downloadLiked().then(function() {
          likedBtn.disabled = false;
          likedBtn.textContent = _t('downloader.download_liked');
        }).catch(function(err) {
          likedBtn.disabled = false;
          likedBtn.textContent = _t('downloader.download_liked');
          if (String(err).includes('auth')) {
            likedBtn.textContent = _t('downloader.liked_requires_auth');
            likedBtn.style.color = '#f44';
            setTimeout(function() { likedBtn.textContent = _t('downloader.download_liked'); likedBtn.style.color = ''; }, 3000);
          }
        });
      });
    })();
  `;
}

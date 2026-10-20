import { t, getScriptTranslations } from '../../shared/i18n';

export function getHistoryOverlayHTML(): string {
  return `
    <div class="sc-overlay-header">
      <h2>${t('history.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-overlay-group">
        <input type="text" class="sc-overlay-input" id="sc-history-search" placeholder="${t('history.search')}">
      </div>

      <div class="sc-stats-grid" id="sc-history-stats">
        <div class="sc-stat-cell">
          <div class="sc-stat-value accent" id="sc-history-total">0</div>
          <div class="sc-stat-label">${t('history.tracks_played')}</div>
        </div>
        <div class="sc-stat-cell">
          <div class="sc-stat-value" id="sc-history-top-artist" style="white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">-</div>
          <div class="sc-stat-label">${t('history.top_artist')}</div>
        </div>
        <div class="sc-stat-cell">
          <div class="sc-stat-value" id="sc-history-listen-time">0h 0m</div>
          <div class="sc-stat-label">${t('history.listening_time')}</div>
        </div>
        <div class="sc-stat-cell">
          <div class="sc-stat-value" id="sc-history-avg-day">0</div>
          <div class="sc-stat-label">${t('history.avg_per_day')}</div>
        </div>
      </div>

      <div class="sc-overlay-group" id="sc-history-stats-section" style="margin-top: 12px;">
        <div style="display: flex; align-items: center; justify-content: space-between; cursor: pointer;" id="sc-history-stats-toggle">
          <span class="sc-overlay-label" style="margin: 0;">${t('history.statistics')}</span>
          <span style="color: #888; font-size: 12px;" id="sc-history-stats-arrow"><span data-sc-icon="down"></span></span>
        </div>
        <div id="sc-history-stats-body" style="display: none; margin-top: 12px;">
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; color: #888; margin-bottom: 8px;">${t('history.daily_activity')}</div>
            <div id="sc-history-chart" style="display: flex; align-items: flex-end; gap: 4px; height: 60px;"></div>
          </div>
          <div style="margin-bottom: 16px;">
            <div style="font-size: 12px; color: #888; margin-bottom: 8px;">${t('history.top_tracks')}</div>
            <ul class="sc-overlay-list" id="sc-history-top-tracks"></ul>
          </div>
          <div>
            <div style="font-size: 12px; color: #888; margin-bottom: 8px;">${t('history.top_artists')}</div>
            <ul class="sc-overlay-list" id="sc-history-top-artists-list"></ul>
          </div>
        </div>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('history.track_history')}</span>
        <label class="sc-overlay-switch">
          <input type="checkbox" id="sc-history-enabled" checked>
          <span class="sc-overlay-switch-slider"></span>
        </label>
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px;">
        <span class="sc-overlay-label">${t('history.max_tracks')}</span>
        <select class="sc-overlay-select" id="sc-history-limit">
          <option value="500">500</option>
          <option value="1000">1000</option>
          <option value="2000">2000</option>
          <option value="5000">5000</option>
          <option value="0">${t('history.unlimited')}</option>
        </select>
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px;">
        <button class="sc-overlay-btn sc-overlay-btn-danger sc-overlay-btn-full" id="sc-history-clear">
          ${t('history.clear')}
        </button>
      </div>

      <div class="sc-overlay-group" style="margin-top: 12px;">
        <span class="sc-overlay-label">${t('history.recent')}</span>
        <ul class="sc-overlay-list" id="sc-history-list"></ul>
      </div>
    </div>
  `;
}

export function getHistoryOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations(['history.clear_confirm', 'history.plays', 'common.yes', 'common.no']));
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="history"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }

      var api = window.sixteenCloud;
      if (!api) return;

      var searchInput = panel.querySelector('#sc-history-search');
      var totalEl = panel.querySelector('#sc-history-total');
      var topArtistEl = panel.querySelector('#sc-history-top-artist');
      var listenTimeEl = panel.querySelector('#sc-history-listen-time');
      var avgDayEl = panel.querySelector('#sc-history-avg-day');
      var enabledToggle = panel.querySelector('#sc-history-enabled');
      var limitSelect = panel.querySelector('#sc-history-limit');
      var clearBtn = panel.querySelector('#sc-history-clear');
      var listEl = panel.querySelector('#sc-history-list');
      var chartEl = panel.querySelector('#sc-history-chart');
      var topTracksEl = panel.querySelector('#sc-history-top-tracks');
      var topArtistsListEl = panel.querySelector('#sc-history-top-artists-list');
      var statsToggle = panel.querySelector('#sc-history-stats-toggle');
      var statsBody = panel.querySelector('#sc-history-stats-body');
      var statsArrow = panel.querySelector('#sc-history-stats-arrow');

      var allTracks = [];
      var statsOpen = false;
      // Lifetime counters live in history.stats and are never trimmed, so the
      // panel numbers stay right after the visible list hits its limit.
      var lifetime = null;
      var listen = { seconds: 0, flushed: 0, lastPosition: 0 };

      function emptyLifetime() {
        return { dataVersion: 1, tracksTotal: 0, secondsTotal: 0, artists: {}, days: {}, tracks: {} };
      }

      function seedLifetime(tracks) {
        var s = emptyLifetime();
        (tracks || []).forEach(function(t) {
          s.tracksTotal++;
          s.secondsTotal += (t.duration || 0);
          if (t.artist) s.artists[t.artist] = (s.artists[t.artist] || 0) + 1;
          var day = (t.timestamp || '').substring(0, 10);
          if (day) s.days[day] = (s.days[day] || 0) + 1;
          var key = t.trackUrl || (t.title + '|' + t.artist);
          var entry = s.tracks[key] || { count: 0, title: t.title, artist: t.artist, artworkUrl: t.artworkUrl, url: t.trackUrl };
          entry.count++;
          s.tracks[key] = entry;
        });
        return s;
      }

      function loadLifetime(callback) {
        api.storeGet('history.stats').then(function(stored) {
          if (stored && stored.dataVersion === 1) {
            lifetime = stored;
            if (callback) callback();
            return;
          }
          // First run after the update: the capped list is the only history we
          // have, so lifetime totals start from it.
          api.historyGet().then(function(tracks) {
            lifetime = seedLifetime(tracks);
            api.storeSet('history.stats', lifetime);
            if (callback) callback();
          });
        });
      }

      function countPlay(track) {
        if (!lifetime) return;
        lifetime.tracksTotal++;
        var day = new Date().toISOString().substring(0, 10);
        lifetime.days[day] = (lifetime.days[day] || 0) + 1;
        if (track.artist) lifetime.artists[track.artist] = (lifetime.artists[track.artist] || 0) + 1;
        var key = track.trackUrl || (track.title + '|' + track.artist);
        var entry = lifetime.tracks[key] || { count: 0, title: track.title, artist: track.artist, artworkUrl: track.artworkUrl, url: track.trackUrl };
        entry.count++;
        if (track.artworkUrl) entry.artworkUrl = track.artworkUrl;
        lifetime.tracks[key] = entry;
      }

      function audioElement() {
        return window.__scAudioElement || document.querySelector('audio');
      }

      function accumulateListened() {
        var el = audioElement();
        if (!el) return;
        var pos = el.currentTime;
        if (typeof pos !== 'number' || !isFinite(pos)) return;
        if (!el.paused) {
          var delta = pos - listen.lastPosition;
          // Seeks, stalls and track switches must not count as listening time.
          if (delta > 0 && delta < 30) listen.seconds += delta;
        }
        listen.lastPosition = pos;
      }

      function flushSeconds(force) {
        if (!lifetime) return;
        var pending = listen.seconds - listen.flushed;
        if (pending <= 0) return;
        if (!force && pending < 10) return;
        lifetime.secondsTotal += Math.round(pending);
        listen.flushed = listen.seconds;
        api.storeSet('history.stats', lifetime);
        updateStats();
      }

      function resetListen() {
        listen.seconds = 0;
        listen.flushed = 0;
        var el = audioElement();
        listen.lastPosition = el && typeof el.currentTime === 'number' ? el.currentTime : 0;
      }

      statsToggle.addEventListener('click', function() {
        statsOpen = !statsOpen;
        statsBody.style.display = statsOpen ? 'block' : 'none';
        statsArrow.innerHTML = '<span data-sc-icon="' + (statsOpen ? 'up' : 'down') + '"></span>';
        if (window.__scIconify) window.__scIconify(statsArrow);
      });

      function renderList(tracks) {
        listEl.innerHTML = tracks.slice().reverse().slice(0, 100).map(function(t) {
          var date = new Date(t.timestamp);
          var timeStr = date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'});
            return '<li class="sc-overlay-list-item" style="cursor:pointer" data-url="' + window.__scEscapeHtml(t.trackUrl || '') + '">' +
            '<div style="flex:1;min-width:0">' +
            '<div class="sc-overlay-list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' + window.__scEscapeHtml(t.title || '') + '</div>' +
            '<div class="sc-overlay-list-item-sub">' + window.__scEscapeHtml(t.artist || '') + ' &middot; ' + window.__scEscapeHtml(timeStr) + '</div>' +
            '</div></li>';
        }).join('');

        listEl.querySelectorAll('.sc-overlay-list-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var url = item.getAttribute('data-url');
            if (window.__scNavigate) window.__scNavigate(url);
          });
        });
      }

      function updateStats() {
        var s = lifetime || emptyLifetime();
        totalEl.textContent = s.tracksTotal;

        // Top artist
        var artists = s.artists;
        var topArtist = '-';
        var topCount = 0;
        for (var a in artists) {
          if (artists[a] > topCount) { topCount = artists[a]; topArtist = a; }
        }
        topArtistEl.textContent = topArtist;

        // Total listening time (actually played seconds, lifetime)
        var totalSeconds = s.secondsTotal || 0;
        var hours = Math.floor(totalSeconds / 3600);
        var minutes = Math.floor((totalSeconds % 3600) / 60);
        listenTimeEl.textContent = hours + 'h ' + minutes + 'm';

        // Avg tracks per active day (lifetime)
        var dayCount = Object.keys(s.days || {}).length || 1;
        avgDayEl.textContent = Math.round(s.tracksTotal / dayCount * 10) / 10;

        // Top 10 tracks from the lifetime counters
        var trackCounts = {};
        var trackNames = {};
        var lifetimeTracks = s.tracks || {};
        for (var ltKey in lifetimeTracks) {
          var lt = lifetimeTracks[ltKey];
          trackCounts[ltKey] = lt.count || 0;
          trackNames[ltKey] = { title: lt.title, artist: lt.artist, url: lt.url };
        }
        var sortedTracks = Object.keys(trackCounts).sort(function(a, b) { return trackCounts[b] - trackCounts[a]; }).slice(0, 10);
        topTracksEl.innerHTML = sortedTracks.map(function(key, i) {
          var info = trackNames[key];
          return '<li class="sc-overlay-list-item" style="cursor:pointer" data-url="' + window.__scEscapeHtml(info.url || '') + '">' +
            '<div style="flex:1;min-width:0">' +
            '<div class="sc-overlay-list-item-title" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">' +
            '<span style="color:#f50;font-weight:700;margin-right:6px;">' + (i + 1) + '</span>' + window.__scEscapeHtml(info.title || '') + '</div>' +
            '<div class="sc-overlay-list-item-sub">' + window.__scEscapeHtml(info.artist || '') + ' &middot; ' + trackCounts[key] + ' ' + _t('history.plays') + '</div>' +
            '</div></li>';
        }).join('') || '<li style="color:#666;font-size:12px;padding:8px 0;">-</li>';

        topTracksEl.querySelectorAll('.sc-overlay-list-item').forEach(function(item) {
          item.addEventListener('click', function() {
            var url = item.getAttribute('data-url');
            if (window.__scNavigate) window.__scNavigate(url);
          });
        });

        // Top 5 artists
        var sortedArtists = Object.keys(artists).sort(function(a, b) { return artists[b] - artists[a]; }).slice(0, 5);
        topArtistsListEl.innerHTML = sortedArtists.map(function(name, i) {
          return '<li class="sc-overlay-list-item">' +
            '<div style="flex:1;min-width:0">' +
            '<div class="sc-overlay-list-item-title">' +
              '<span style="color:#f50;font-weight:700;margin-right:6px;">' + (i + 1) + '</span>' + window.__scEscapeHtml(name) + '</div>' +
            '<div class="sc-overlay-list-item-sub">' + artists[name] + ' ' + _t('history.plays') + '</div>' +
            '</div></li>';
        }).join('') || '<li style="color:#666;font-size:12px;padding:8px 0;">-</li>';

        // 7-day activity chart
        var now = new Date();
        var dayLabels = [];
        var dayCounts = [];
        for (var d = 6; d >= 0; d--) {
          var date = new Date(now);
          date.setDate(date.getDate() - d);
          var key = date.toISOString().substring(0, 10);
          dayLabels.push(date.toLocaleDateString(undefined, { weekday: 'short' }));
          dayCounts.push((s.days || {})[key] || 0);
        }
        var maxDay = Math.max.apply(null, dayCounts) || 1;
        chartEl.innerHTML = dayCounts.map(function(count, i) {
          var pct = Math.round(count / maxDay * 100);
          return '<div style="flex:1;display:flex;flex-direction:column;align-items:center;gap:4px;">' +
            '<div style="font-size:10px;color:#aaa;">' + count + '</div>' +
            '<div style="width:100%;background:#f50;border-radius:3px;min-height:2px;height:' + Math.max(pct, 4) + '%;opacity:' + (count > 0 ? 1 : 0.2) + ';transition:height 0.3s;"></div>' +
            '<div style="font-size:9px;color:#666;">' + dayLabels[i] + '</div>' +
            '</div>';
        }).join('');
      }

      function loadHistory() {
        api.historyGet().then(function(tracks) {
          allTracks = tracks || [];
          renderList(allTracks);
          updateStats();
        });
      }

      api.storeGet('history.enabled').then(function(val) {
        enabledToggle.checked = val !== false;
        if (enabledToggle.checked) startHistoryPolling(); else stopHistoryPolling();
      });

      api.storeGet('history.maxTracks').then(function(val) {
        limitSelect.value = val !== undefined && val !== null ? '' + val : '500';
      });

      enabledToggle.addEventListener('change', function() {
        api.storeSet('history.enabled', enabledToggle.checked);
        if (enabledToggle.checked) startHistoryPolling(); else stopHistoryPolling();
      });

      limitSelect.addEventListener('change', function() {
        api.storeSet('history.maxTracks', parseInt(limitSelect.value) || 0);
      });

      searchInput.addEventListener('input', function() {
        var q = searchInput.value.toLowerCase();
        if (!q) { renderList(allTracks); return; }
        var filtered = allTracks.filter(function(t) {
          return (t.title || '').toLowerCase().includes(q) || (t.artist || '').toLowerCase().includes(q);
        });
        renderList(filtered);
      });

      clearBtn.addEventListener('click', function() {
        var existing = panel.querySelector('#sc-confirm-clear');
        if (existing) { existing.remove(); return; }
        var box = document.createElement('div');
        box.id = 'sc-confirm-clear';
        box.style.cssText = 'margin-top:8px;padding:10px;background:#2a1a1a;border:1px solid #e74c3c;border-radius:6px;display:flex;align-items:center;justify-content:space-between;';
        box.innerHTML = '<span style="color:#e74c3c;font-size:12px;">' + _t('history.clear_confirm') + '</span><div style="display:flex;gap:6px;"><button id="sc-confirm-yes" style="background:#e74c3c;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">' + _t('common.yes') + '</button><button id="sc-confirm-no" style="background:#333;color:#fff;border:none;padding:4px 12px;border-radius:4px;cursor:pointer;font-size:12px;">' + _t('common.no') + '</button></div>';
        clearBtn.parentNode.insertBefore(box, clearBtn.nextSibling);
        box.querySelector('#sc-confirm-yes').onclick = function() {
          api.historyClear().then(function() {
            allTracks = [];
            lifetime = emptyLifetime();
            resetListen();
            renderList([]);
            updateStats();
          });
          box.remove();
        };
        box.querySelector('#sc-confirm-no').onclick = function() { box.remove(); };
      });

      loadHistory();
      loadLifetime(function() { updateStats(); });

      // Auto-record tracks independently of the history panel. The fallback
      // cadence is relaxed while hidden, then refreshed immediately on resume.
      var lastTrackUrl = '';
      var historyPollTimer = null;
      var historyPolling = false;
      function isHistoryEnabled() { return enabledToggle.checked; }
      function recordCurrentTrack() {
        if (!isHistoryEnabled()) return;
        // The lifetime counters must be loaded before the first recording, or
        // the very first play of a session is dropped.
        if (!lifetime) { loadLifetime(function() { updateStats(); }); return; }
        accumulateListened();
        var titleEl = document.querySelector('.playbackSoundBadge__titleLink');
        var artistEl = document.querySelector('.playbackSoundBadge__lightLink');
        if (!titleEl) return;
        var title = titleEl.getAttribute('title') || titleEl.textContent.trim();
        var artist = artistEl ? (artistEl.getAttribute('title') || artistEl.textContent.trim()) : '';
        var trackUrl = titleEl.getAttribute('href') || '';
        if (trackUrl && trackUrl.startsWith('/')) trackUrl = 'https://soundcloud.com' + trackUrl;

        if (trackUrl && trackUrl !== lastTrackUrl) {
          lastTrackUrl = trackUrl;
          var artEl = document.querySelector('.playbackSoundBadge__avatar .image__full, .playbackSoundBadge__avatar span[style*="background-image"]');
          var artworkUrl = '';
          if (artEl) {
            var style = artEl.getAttribute('style') || '';
            var m = style.match(/url\\\\("?([^"\\\\)]+)"?\\\\)/);
            if (m) artworkUrl = m[1];
          }
          var durationEl = document.querySelector('.playbackTimeline__duration span[aria-hidden]');
          var dur = 0;
          if (durationEl) {
            var parts = durationEl.textContent.split(':');
            dur = (parseInt(parts[0])||0)*60 + (parseInt(parts[1])||0);
          }
          // The badge keeps the last track after a restart, so only count a
          // play once an audio element actually exists (the hook sets it from
          // HTMLMediaElement.play), otherwise every launch adds a phantom play.
          if (audioElement()) countPlay({ title: title, artist: artist, artworkUrl: artworkUrl, trackUrl: trackUrl });
          flushSeconds(true);
          resetListen();
          api.storeGet('history').then(function(h) {
            if (!h) h = { enabled: true, tracks: [] };
            var tracks = h.tracks || [];
            tracks.push({ title: title, artist: artist, artworkUrl: artworkUrl, trackUrl: trackUrl, timestamp: new Date().toISOString(), duration: dur });
            var maxTracks = parseInt(limitSelect.value) || 0;
            if (maxTracks > 0 && tracks.length > maxTracks) tracks = tracks.slice(tracks.length - maxTracks);
            api.storeSet('history.tracks', tracks);
            allTracks = tracks;
            renderList(tracks);
            updateStats();
          });
        } else {
          flushSeconds(false);
        }
      }
      function stopHistoryPolling() {
        historyPolling = false;
        if (historyPollTimer) { clearTimeout(historyPollTimer); historyPollTimer = null; }
      }
      function scheduleHistoryPoll() {
        if (!historyPolling) return;
        historyPollTimer = setTimeout(function() {
          historyPollTimer = null;
          if (!isHistoryEnabled()) { stopHistoryPolling(); return; }
          recordCurrentTrack();
          scheduleHistoryPoll();
        }, document.hidden ? 15000 : 3000);
      }
      function startHistoryPolling() {
        if (historyPolling || !isHistoryEnabled()) return;
        historyPolling = true;
        recordCurrentTrack();
        scheduleHistoryPoll();
      }
      document.addEventListener('visibilitychange', function() {
        if (document.hidden) return;
        if (isHistoryEnabled()) {
          recordCurrentTrack();
          if (!historyPollTimer) scheduleHistoryPoll();
        }
      });
    })();
  `;
}

// DEPRECATED / DISABLED. Wave is not registered in the UI (see main.ts) and
// nothing in the app can open it. The code is kept as a starting point; the
// design notes and open problems are in TODO.md ("Wave").
//
import fs from 'fs';
import path from 'path';
import { t, getScriptTranslations } from '../../shared/i18n';

// Wave: an endless personal radio. Candidates come from SoundCloud's own
// recommenders (track stations, related tracks, mood searches, charts), are
// ranked against a local taste profile that learns from likes, skips and
// finished tracks, and are played through the normal SoundCloud player.

const MOODS: Array<{ id: string; tags: string[] }> = [
  { id: 'chill', tags: ['chill', 'lofi', 'ambient'] },
  { id: 'energy', tags: ['energy', 'drum and bass', 'hardstyle'] },
  { id: 'focus', tags: ['focus', 'study', 'instrumental'] },
  { id: 'night', tags: ['night drive', 'synthwave', 'deep house'] },
  { id: 'sad', tags: ['sad', 'emotional', 'melancholic'] },
  { id: 'party', tags: ['party', 'dance', 'club'] },
];

// The brand mark (cloud + waveform + knocked-out "16") as a reusable <symbol>,
// stacked into slices in CSS to get a solid 3D body.
function logoSymbol(): string {
  try {
    const raw = fs.readFileSync(path.join(__dirname, '../../../assets/logo-mark.svg'), 'utf-8');
    const inner = raw.replace(/^[\s\S]*?<svg[^>]*>/, '').replace(/<\/svg>\s*$/, '').replace(/scLogoMark/g, 'scWaveMask');
    return `<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><symbol id="scWaveLogo" viewBox="-10 216 821 368">${inner}</symbol></defs></svg>`;
  } catch {
    return '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs><symbol id="scWaveLogo" viewBox="0 0 100 50"><circle cx="50" cy="25" r="22" fill="currentColor"/></symbol></defs></svg>';
  }
}

const ICON = {
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z" fill="currentColor"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/></svg>',
  like: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 11v9H4a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3Zm0 0 3.6-7.2A1.7 1.7 0 0 1 12.1 3c1.2 0 2.1 1 1.9 2.2L13.4 9H19a2 2 0 0 1 2 2.3l-1.1 7A2 2 0 0 1 17.9 20H7" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  dislike: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17 13V4h3a1 1 0 0 1 1 1v7a1 1 0 0 1-1 1h-3Zm0 0-3.6 7.2a1.7 1.7 0 0 1-1.5.8c-1.2 0-2.1-1-1.9-2.2L10.6 15H5a2 2 0 0 1-2-2.3l1.1-7A2 2 0 0 1 6.1 4H17" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  skip: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 5.5v13l9-6.5z" fill="currentColor"/><rect x="16.5" y="5.5" width="2.2" height="13" rx="1" fill="currentColor"/></svg>',
  heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.2C1.6 8 3.6 5 6.8 5c2 0 3.5 1.1 5.2 3 1.7-1.9 3.2-3 5.2-3 3.2 0 5.2 3 4 6.3-1.7 4.6-9.2 9.2-9.2 9.2Z" fill="currentColor"/></svg>',
};

export function getWaveOverlayHTML(): string {
  const moods = MOODS.map(m => `<button class="sc-overlay-btn sc-overlay-btn-secondary sc-wave-mood" data-mood="${m.id}">${t('wave.mood.' + m.id)}</button>`).join('');
  return `
    <div class="sc-overlay-header">
      <h2>${t('wave.title')}</h2>
    </div>
    <div class="sc-overlay-body">
      <div class="sc-wave-stage">
        ${logoSymbol()}
        <div class="sc-wave-scene idle" id="sc-wave-orb" role="button" tabindex="-1" aria-label="${t('wave.start')}">
          <div class="sc-wave-3d idle" id="sc-wave-3d">${Array.from({ length: 20 }, (_v, i) => `<svg class="sc-wave-slice${i === 0 ? ' front' : ''}" style="--i:${i}" viewBox="-10 216 821 368"><use href="#scWaveLogo" x="-10" y="216" width="821" height="368"/></svg>`).join('')}<svg class="sc-wave-gloss" viewBox="-10 216 821 368"><use href="#scWaveLogo" x="-10" y="216" width="821" height="368"/></svg></div>
        </div>
        <div class="sc-wave-heart" id="sc-wave-heart">${ICON.heart}</div>
        <button class="sc-wave-main" id="sc-wave-toggle" aria-label="${t('wave.start')}" title="${t('wave.start')}">${ICON.play}</button>
        <div id="sc-wave-status">${t('wave.hint')}</div>
      </div>

      <div id="sc-wave-now" style="display:none">
        <div class="sc-wave-card">
          <img id="sc-wave-cover" alt="">
          <div class="sc-wave-card-main">
            <div id="sc-wave-title" class="sc-wave-card-title"></div>
            <div id="sc-wave-artist" class="sc-wave-card-artist"></div>
          </div>
          <button class="sc-wave-round" id="sc-wave-dislike" title="${t('wave.dislike')}" aria-label="${t('wave.dislike')}">${ICON.dislike}</button>
          <button class="sc-wave-round" id="sc-wave-like" title="${t('wave.like')}" aria-label="${t('wave.like')}">${ICON.like}</button>
          <button class="sc-wave-round" id="sc-wave-skip" title="${t('wave.skip')}" aria-label="${t('wave.skip')}">${ICON.skip}</button>
        </div>
        <span class="sc-overlay-label" style="margin-top:10px">${t('wave.up_next')}</span>
        <div id="sc-wave-queue"></div>
      </div>

      <div class="sc-overlay-group" style="margin-top:14px">
        <span class="sc-overlay-label">${t('wave.mood')}</span>
        <div class="sc-pl-chips" id="sc-wave-moods">${moods}</div>
        <input class="sc-overlay-input" id="sc-wave-tag" placeholder="${t('wave.custom_tag')}" style="margin-top:8px">
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('wave.language')}</span>
        <div class="sc-pl-chips" id="sc-wave-lang">
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-lang="all">${t('wave.lang_all')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-lang="ru">${t('wave.lang_ru')}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-lang="foreign">${t('wave.lang_foreign')}</button>
        </div>
      </div>

      <div class="sc-overlay-group">
        <span class="sc-overlay-label">${t('wave.explore')}</span>
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:11px;color:var(--sc-text-muted)">${t('wave.familiar')}</span>
          <input type="range" min="0" max="100" value="50" id="sc-wave-explore" style="flex:1;accent-color:var(--sc-accent)">
          <span style="font-size:11px;color:var(--sc-text-muted)">${t('wave.discover')}</span>
        </div>
      </div>

      <div class="sc-overlay-toggle">
        <span class="sc-overlay-toggle-label">${t('wave.avoid_heard')}</span>
        <label class="sc-overlay-switch"><input type="checkbox" id="sc-wave-avoid" checked><span class="sc-overlay-switch-slider"></span></label>
      </div>
      <div style="text-align:center;margin-top:12px">
        <button class="sc-overlay-btn sc-overlay-btn-secondary" id="sc-wave-forget">${t('wave.forget')}</button>
      </div>
    </div>
  `;
}

export function getWaveOverlayScript(): string {
  const _tr = JSON.stringify(getScriptTranslations([
    'wave.start', 'wave.stop', 'wave.hint', 'wave.loading', 'wave.playing', 'wave.no_api', 'wave.failed', 'wave.empty',
    'wave.stopped_manual', 'wave.forgot', 'wave.listening_on',
  ]));
  const _moods = JSON.stringify(MOODS);
  const _icons = JSON.stringify({ play: ICON.play, stop: ICON.stop });
  return `
    (function() {
      var panel = document.querySelector('[data-overlay="wave"]');
      if (!panel || panel.dataset.initialized) return;
      panel.dataset.initialized = 'true';

      var _tr = ${_tr};
      function _t(k) { return _tr[k] || k; }
      var MOODS = ${_moods};
      var ICONS = ${_icons};
      var api = window.sixteenCloud;
      if (!api) return;

      var style = document.createElement('style');
      style.textContent =
        '.sc-wave-stage{text-align:center;padding:6px 0 4px;overflow-x:clip}' +
        '[data-overlay="wave"] .sc-overlay-body{overflow-x:hidden}' +
        '.sc-wave-scene,.sc-wave-scene:focus,.sc-wave-scene:focus-visible,.sc-wave-scene *{outline:none !important;-webkit-tap-highlight-color:transparent;user-select:none}' +
        '.sc-wave-scene{width:320px;height:180px;margin:0 auto;perspective:760px;cursor:pointer;display:flex;align-items:center;justify-content:center;filter:drop-shadow(0 14px 18px rgba(var(--sc-accent-rgb,255,85,0),.26));transition:filter .5s ease,transform .5s ease}' +
        '.sc-wave-scene.idle{filter:saturate(.75) drop-shadow(0 14px 18px rgba(0,0,0,.5))}' +
        '.sc-wave-3d{position:relative;width:252px;height:113px;transform-style:preserve-3d;transform:rotateX(16deg) rotateY(-22deg);animation:scWaveSway 7s ease-in-out infinite;color:var(--sc-accent,#ff5500)}' +
        '.sc-wave-3d.idle{animation:none;transform:rotateX(16deg) rotateY(-22deg)}' +
        '.sc-wave-scene:hover{transform:translateY(-3px)}' +
        '.sc-wave-slice,.sc-wave-gloss{position:absolute;inset:0;width:100%;height:100%;overflow:visible}' +
        '.sc-wave-slice{transform:translateZ(calc(var(--i) * -1.8px + 14px));filter:brightness(calc(.72 - var(--i) * .018))}' +
        '.sc-wave-slice.front{filter:brightness(1.12) saturate(1.08)}' +
        '.sc-wave-gloss{transform:translateZ(15px);color:#fff;opacity:.13;clip-path:polygon(0 0,100% 0,100% 48%,0 62%);pointer-events:none}' +
        '@keyframes scWaveSway{0%,100%{transform:rotateX(16deg) rotateY(-30deg) translateY(0)}50%{transform:rotateX(18deg) rotateY(30deg) translateY(-5px)}}' +
        '.sc-wave-heart{height:26px;margin-top:-6px;display:flex;align-items:center;justify-content:center;color:var(--sc-accent,#ff5500);opacity:0;transform:scale(.4);pointer-events:none}' +
        '.sc-wave-heart svg{width:22px;height:22px;filter:drop-shadow(0 0 8px rgba(var(--sc-accent-rgb,255,85,0),.7))}' +
        '.sc-wave-heart.show{animation:scHeart 2.6s ease both}' +
        '@keyframes scHeart{0%{opacity:0;transform:scale(.4)}12%{opacity:1;transform:scale(1.25)}24%{transform:scale(1)}75%{opacity:1;transform:translateY(0) scale(1)}100%{opacity:0;transform:translateY(-8px) scale(.9)}}' +
        '.sc-wave-main{width:44px;height:44px;margin:4px auto 0;border-radius:50%;border:0;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--sc-accent-foreground,#fff);background:var(--sc-accent);box-shadow:0 6px 18px rgba(var(--sc-accent-rgb,255,85,0),.4);transition:transform .15s,filter .2s}' +
        '.sc-wave-main:hover{filter:brightness(1.12);transform:scale(1.06)}.sc-wave-main svg{width:22px;height:22px}' +
        '#sc-wave-status{font-size:12px;color:var(--sc-text-muted);min-height:18px;margin-top:8px}' +
        '.sc-wave-card{display:flex;align-items:center;gap:10px;margin-top:14px;padding:10px;border-radius:12px;background:var(--sc-surface-raised,rgba(255,255,255,.05))}' +
        '.sc-wave-card img{width:52px;height:52px;border-radius:8px;object-fit:cover;background:#222}' +
        '.sc-wave-card-main{flex:1;min-width:0}.sc-wave-card-title{font-weight:700;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.sc-wave-card-artist{font-size:12px;color:var(--sc-text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.sc-wave-round{width:34px;height:34px;border-radius:50%;border:0;cursor:pointer;display:flex;align-items:center;justify-content:center;background:rgba(255,255,255,.08);color:inherit;transition:background .15s,color .15s,transform .15s}' +
        '.sc-wave-round svg{width:17px;height:17px}' +
        '.sc-wave-round:hover,.sc-wave-round.on{background:var(--sc-accent);color:var(--sc-accent-foreground,#fff)}' +
        '.sc-wave-round:active{transform:scale(.92)}' +
        '.sc-wave-q{display:flex;align-items:center;gap:8px;padding:5px 0;font-size:12px;border-top:1px solid var(--sc-border,rgba(255,255,255,.07))}' +
        '.sc-wave-q img{width:28px;height:28px;border-radius:5px;object-fit:cover}' +
        '.sc-wave-q span{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}' +
        '.sc-pl-chips{display:flex;flex-wrap:wrap;gap:6px}.sc-pl-chips .sc-overlay-btn.on{background:var(--sc-accent);color:var(--sc-accent-foreground,#fff)}';
      document.head.appendChild(style);

      function $(s) { return panel.querySelector(s); }
      var orb = $('#sc-wave-orb'), orb3d = $('#sc-wave-3d'), toggleBtn = $('#sc-wave-toggle'), heartEl = $('#sc-wave-heart'), statusEl = $('#sc-wave-status');
      var likeBtn = $('#sc-wave-like'), dislikeBtn = $('#sc-wave-dislike');
      var nowBox = $('#sc-wave-now'), coverEl = $('#sc-wave-cover'), titleEl = $('#sc-wave-title'), artistEl = $('#sc-wave-artist'), queueEl = $('#sc-wave-queue');
      var moodsEl = $('#sc-wave-moods'), langEl = $('#sc-wave-lang'), tagInput = $('#sc-wave-tag');
      var exploreEl = $('#sc-wave-explore'), avoidEl = $('#sc-wave-avoid');

      // ---------- Persistent state: settings + taste profile ----------
      var data = { moods: [], tag: '', lang: 'all', explore: 50, avoidHeard: true, artists: {}, tags: {}, seen: [] };
      var saveTimer = null;
      function save() {
        if (saveTimer) clearTimeout(saveTimer);
        saveTimer = setTimeout(function() {
          saveTimer = null;
          var out = JSON.parse(JSON.stringify(data));
          out.seen = out.seen.slice(-400);
          function prune(obj, max) {
            var keys = Object.keys(obj);
            if (keys.length <= max) return;
            keys.sort(function(a, b) { return Math.abs(obj[b]) - Math.abs(obj[a]); });
            keys.slice(max).forEach(function(k) { delete obj[k]; });
          }
          prune(out.artists, 300); prune(out.tags, 300);
          api.storeSet('wave', out).catch(function() {});
        }, 600);
      }
      function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
      function bump(map, key, delta) {
        if (!key) return;
        map[key] = clamp((map[key] || 0) + delta, -3, 4);
      }

      function paintControls() {
        Array.prototype.forEach.call(moodsEl.querySelectorAll('button'), function(b) {
          b.classList.toggle('on', data.moods.indexOf(b.getAttribute('data-mood')) >= 0);
        });
        Array.prototype.forEach.call(langEl.querySelectorAll('button'), function(b) {
          b.classList.toggle('on', b.getAttribute('data-lang') === data.lang);
        });
        tagInput.value = data.tag || '';
        exploreEl.value = String(data.explore);
        avoidEl.checked = !!data.avoidHeard;
      }
      api.storeGet('wave').then(function(w) {
        if (w && typeof w === 'object') {
          ['moods', 'tag', 'lang', 'explore', 'avoidHeard', 'artists', 'tags', 'seen'].forEach(function(k) { if (w[k] !== undefined) data[k] = w[k]; });
        }
        paintControls();
      }).catch(function() { paintControls(); });
      paintControls();

      moodsEl.addEventListener('click', function(e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        var id = b.getAttribute('data-mood');
        var i = data.moods.indexOf(id);
        if (i >= 0) data.moods.splice(i, 1); else data.moods.push(id);
        paintControls(); save(); S.pool = []; S.queue = [];
      });
      langEl.addEventListener('click', function(e) {
        var b = e.target.closest ? e.target.closest('button') : null;
        if (!b) return;
        data.lang = b.getAttribute('data-lang');
        paintControls(); save(); S.queue = [];
      });
      tagInput.addEventListener('change', function() { data.tag = tagInput.value.trim().slice(0, 40); save(); S.pool = []; S.queue = []; });
      exploreEl.addEventListener('input', function() { data.explore = Number(exploreEl.value); });
      exploreEl.addEventListener('change', function() { save(); S.queue = []; });
      avoidEl.addEventListener('change', function() { data.avoidHeard = avoidEl.checked; save(); });
      $('#sc-wave-forget').addEventListener('click', function() {
        data.artists = {}; data.tags = {}; data.seen = [];
        save(); setStatus(_t('wave.forgot'));
      });

      // ---------- SoundCloud API access ----------
      function apiGet(path) {
        var T = window.__scTracks;
        if (!T || !T.clientId) return Promise.reject(new Error('no client id'));
        var url = 'https://api-v2.soundcloud.com' + path + (path.indexOf('?') >= 0 ? '&' : '?') + 'client_id=' + encodeURIComponent(T.clientId);
        var opts = T.auth ? { headers: { Authorization: T.auth } } : undefined;
        return fetch(url, opts).then(function(r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); });
      }
      function pathOf(url) { try { return new URL(url).pathname; } catch (e) { return ''; } }
      function tagsOf(tr) {
        var out = [];
        var list = typeof tr.tag_list === 'string' ? tr.tag_list : '';
        var re = /"([^"]+)"|(\\S+)/g, m;
        while ((m = re.exec(list))) out.push((m[1] || m[2]).toLowerCase());
        if (tr.genre) out.push(String(tr.genre).toLowerCase());
        return out;
      }
      function normalize(tr) {
        if (!tr || tr.kind !== 'track' || !tr.permalink_url) return null;
        var path = pathOf(tr.permalink_url);
        if (!path) return null;
        var user = tr.user || {};
        return {
          id: tr.id, path: path,
          title: String(tr.title || ''),
          artist: String(user.username || path.split('/')[1] || ''),
          artistKey: path.split('/')[1] || '',
          tags: tagsOf(tr), duration: Number(tr.full_duration || tr.duration) || 0,
          likes: Number(tr.likes_count) || 0, plays: Number(tr.playback_count) || 0,
          artwork: String(tr.artwork_url || user.avatar_url || ''),
          policy: String(tr.policy || ''), streamable: tr.streamable !== false,
          raw: tr
        };
      }
      var CYR = /[\\u0400-\\u04FF]/;
      function isRussian(c) {
        if (CYR.test(c.title) || CYR.test(c.artist)) return true;
        return c.tags.some(function(t) { return CYR.test(t) || t === 'russian' || t === 'russian rap' || t === 'rus'; });
      }

      // ---------- Session state ----------
      var S = { active: false, pool: [], queue: [], served: [], current: null, starting: null, played: {}, filling: false, expected: '', recent: [], recentIds: [], artistCount: {}, lastProgress: 0 };

      function setStatus(msg) { statusEl.textContent = msg || ''; }
      function artworkSmall(u) { return u ? u.replace(/-(?:large|t\\d+x\\d+|original|crop|small|badge)\\./, '-t120x120.') : ''; }

      function heardPaths() {
        var set = {};
        data.seen.forEach(function(p) { set[p] = 1; });
        return set;
      }

      // ---------- Candidate gathering ----------
      function moodTags() {
        var tags = [];
        data.moods.forEach(function(id) { MOODS.forEach(function(m) { if (m.id === id) tags = tags.concat(m.tags.slice(0, 2)); }); });
        if (data.tag) tags.push(data.tag);
        return tags;
      }

      function seedIds() {
        var T = window.__scTracks;
        var ids = [];
        var seenArtists = {};
        function addPath(p) {
          var info = T && T.byPath && T.byPath[p];
          var ak = p.split('/')[1] || '';
          if (info && info.id && ids.indexOf(info.id) < 0 && !seenArtists[ak]) { ids.push(info.id); seenArtists[ak] = 1; }
        }
        if (S.current) addPath(S.current.path);
        var recent = data.seen.slice(-6).reverse();
        recent.forEach(addPath);
        return ids.slice(0, 4);
      }

      function historySeeds() {
        // Recently played in the app: resolve a few of them to ids.
        return api.storeGet('history.tracks').then(function(list) {
          var urls = (Array.isArray(list) ? list : []).slice(-6).reverse().map(function(h) { return h && h.trackUrl; }).filter(Boolean);
          var T = window.__scTracks;
          return Promise.all(urls.slice(0, 4).map(function(u) {
            var p = pathOf(u);
            if (T && T.byPath && T.byPath[p] && T.byPath[p].id) return T.byPath[p].id;
            return apiGet('/resolve?url=' + encodeURIComponent(u)).then(function(tr) { return tr && tr.kind === 'track' ? tr.id : null; }).catch(function() { return null; });
          }));
        }).then(function(ids) { return ids.filter(Boolean); }).catch(function() { return []; });
      }

      function hydrate(ids) {
        var chunks = [];
        for (var i = 0; i < ids.length; i += 40) chunks.push(ids.slice(i, i + 40));
        return Promise.all(chunks.map(function(ch) {
          return apiGet('/tracks?ids=' + ch.join(',')).catch(function() { return []; });
        })).then(function(parts) { return [].concat.apply([], parts); });
      }

      function fillPool() {
        if (S.filling) return Promise.resolve();
        S.filling = true;
        var tags = moodTags();
        var localSeeds = seedIds();
        return (localSeeds.length ? Promise.resolve(localSeeds) : historySeeds()).then(function(seeds) {
          var jobs = [];
          seeds.slice(0, 3).forEach(function(id) {
            jobs.push(apiGet('/stations/soundcloud:track-stations:' + id + '/tracks?limit=40').then(function(d) { return d.collection || []; }).catch(function() { return []; }));
            jobs.push(apiGet('/tracks/' + id + '/related?limit=25').then(function(d) { return d.collection || []; }).catch(function() { return []; }));
          });
          // Broaden with what the profile likes most, so one liked artist
          // does not turn the whole Wave into that artist.
          var liked = Object.keys(data.tags).filter(function(k) { return data.tags[k] > 0.4; })
            .sort(function(a, b) { return data.tags[b] - data.tags[a]; }).slice(0, 2);
          liked.forEach(function(tag) {
            jobs.push(apiGet('/search/tracks?q=' + encodeURIComponent(tag) + '&limit=30').then(function(d) { return d.collection || []; }).catch(function() { return []; }));
          });
          tags.slice(0, 4).forEach(function(tag) {
            jobs.push(apiGet('/search/tracks?q=' + encodeURIComponent(tag) + '&limit=40').then(function(d) { return d.collection || []; }).catch(function() { return []; }));
          });
          if (!jobs.length) {
            jobs.push(apiGet('/charts?kind=trending&genre=soundcloud%3Agenres%3Aall-music&limit=40').then(function(d) {
              return (d.collection || []).map(function(x) { return x.track; }).filter(Boolean);
            }).catch(function() { return []; }));
          }
          return Promise.all(jobs);
        }).then(function(lists) {
          var raw = [].concat.apply([], lists);
          var need = [], seen = {};
          raw.forEach(function(tr) {
            if (!tr || !tr.id || seen[tr.id]) return;
            seen[tr.id] = 1;
            // Station items are stubs (no tags/stats); hydrate those in one batch.
            if (tr.tag_list === undefined && tr.likes_count === undefined) need.push(tr.id);
          });
          var full = raw.filter(function(tr) { return tr && !(tr.tag_list === undefined && tr.likes_count === undefined); });
          return hydrate(need).then(function(h) { return full.concat(h); });
        }).then(function(trs) {
          var have = {};
          S.pool.forEach(function(c) { have[c.id] = 1; });
          trs.forEach(function(tr) {
            var c = normalize(tr);
            if (!c || have[c.id]) return;
            have[c.id] = 1;
            S.pool.push(c);
          });
          S.filling = false;
        }).catch(function() { S.filling = false; });
      }

      // ---------- Ranking ----------
      function eligible(c) {
        if (!c.streamable || c.policy === 'SNIP' || c.policy === 'BLOCK') return false;
        if (c.duration && (c.duration < 60000 || c.duration > 12 * 60000)) return false;
        if (S.played[c.path]) return false;
        if (S.current && c.path === S.current.path) return false;
        if (S.starting && c.path === S.starting.path) return false;
        if (S.served.some(function(x) { return x.id === c.id; })) return false;
        if (data.avoidHeard && heardPaths()[c.path]) return false;
        var flagged = window.__scTracks && window.__scTracks.flagged && window.__scTracks.flagged[c.path];
        if (flagged) return false;
        if ((data.artists[c.artistKey] || 0) <= -2) return false;
        if (data.lang === 'ru' && !isRussian(c)) return false;
        if (data.lang === 'foreign' && isRussian(c)) return false;
        return true;
      }
      function score(c) {
        var s = 0;
        s += 0.9 * clamp(data.artists[c.artistKey] || 0, -3, 2);
        s -= 1.4 * (S.artistCount[c.artistKey] || 0);
        var tagScore = 0;
        c.tags.forEach(function(tg) { tagScore += data.tags[tg] || 0; });
        s += 1.1 * clamp(tagScore, -3, 4);
        var mt = moodTags(), hits = 0;
        c.tags.forEach(function(tg) { mt.forEach(function(m) { if (tg.indexOf(m) >= 0 || m.indexOf(tg) >= 0) hits++; }); });
        s += 1.4 * Math.min(hits, 3);
        var ratio = c.plays > 50 ? Math.min(0.12, c.likes / c.plays) * 10 : 0.2;
        s += 1.5 * ratio;
        var explore = data.explore / 100;
        var known = (data.artists[c.artistKey] || 0) > 0;
        s += known ? (0.5 - explore) * 1.2 : (explore - 0.3) * 1.2;
        if (c.plays > 0) s += 0.25 * Math.min(4, Math.log10(c.plays + 1) / 1.5);
        s += Math.random() * 0.9;
        return s;
      }
      function pickNext() {
        var all = S.pool.filter(eligible).filter(function(c) { return !S.queue.some(function(q) { return q.id === c.id; }); });
        if (!all.length) return null;
        // Variety first: avoid artists from the last few plays and the queue.
        var blocked = {};
        S.recent.forEach(function(a) { blocked[a] = 1; });
        S.queue.forEach(function(q) { blocked[q.artistKey] = 1; });
        var cand = all.filter(function(c) { return !blocked[c.artistKey]; });
        if (cand.length < 3) cand = all;
        var scored = cand.map(function(c) { return { c: c, s: score(c) }; }).sort(function(a, b) { return b.s - a.s; }).slice(0, 8);
        var top = scored[0].s, total = 0;
        scored.forEach(function(x) { x.w = Math.exp((x.s - top) / 0.8); total += x.w; });
        var r = Math.random() * total;
        for (var i = 0; i < scored.length; i++) { r -= scored[i].w; if (r <= 0) return scored[i].c; }
        return scored[0].c;
      }
      function topUpQueue() {
        while (S.queue.length < 5) {
          var c = pickNext();
          if (!c) break;
          S.queue.push(c);
        }
        renderQueue();
      }

      function renderQueue() {
        queueEl.innerHTML = '';
        var rows = S.served.concat(S.queue).slice(0, 6);
        rows.forEach(function(c, i) {
          var row = document.createElement('div');
          row.className = 'sc-wave-q';
          if (i >= S.served.length) row.style.opacity = '0.55';
          var img = document.createElement('img');
          img.src = artworkSmall(c.artwork);
          var span = document.createElement('span');
          span.textContent = c.artist + ' \\u2014 ' + c.title;
          row.appendChild(img); row.appendChild(span);
          queueEl.appendChild(row);
        });
      }
      function renderNow() {
        if (!S.current) { nowBox.style.display = 'none'; return; }
        nowBox.style.display = 'block';
        coverEl.src = artworkSmall(S.current.artwork);
        titleEl.textContent = S.current.title;
        artistEl.textContent = S.current.artist;
        renderVote();
        renderQueue();
      }
      function renderOrb() {
        orb3d.classList.toggle('idle', !S.active);
        orb.classList.toggle('idle', !S.active);
        var label = S.active ? _t('wave.stop') : _t('wave.start');
        toggleBtn.innerHTML = S.active ? ICONS.stop : ICONS.play;
        toggleBtn.setAttribute('aria-label', label);
        toggleBtn.title = label;
        orb.setAttribute('aria-label', label);
      }
      function renderVote() {
        var v = S.current && S.current.vote;
        likeBtn.classList.toggle('on', v === 'like');
        dislikeBtn.classList.toggle('on', v === 'dislike');
      }
      var heartTimer = null;
      function showHeart() {
        heartEl.classList.remove('show');
        void heartEl.offsetWidth;
        heartEl.classList.add('show');
        if (heartTimer) clearTimeout(heartTimer);
        heartTimer = setTimeout(function() { heartEl.classList.remove('show'); }, 2700);
      }

      // ---------- Playback ----------
      function navigate(path) {
        var a = document.createElement('a');
        a.href = path;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        setTimeout(function() { a.remove(); }, 0);
      }
      var PLAY_BUTTONS = ['.sc-button-play.sc-button-xxlarge', '.fullHero .sc-button-play', '.l-listen-hero .sc-button-play', '.listenEngagement .sc-button-play'];
      function sameTrack(cur, c) {
        if (!cur) return false;
        if (cur.path === c.path) return true;
        // Canonical slugs can differ from the API permalink (renamed artist, redirects).
        return !!cur.title && cur.title.trim().toLowerCase() === c.title.trim().toLowerCase();
      }
      function heroPlayButton() {
        for (var i = 0; i < PLAY_BUTTONS.length; i++) {
          var el = document.querySelector(PLAY_BUTTONS[i]);
          if (el && el.offsetParent !== null) return el;
        }
        return null;
      }
      // Opens the track page, presses its big play button and waits until the
      // player bar confirms the track is playing; then puts the user back.
      function playTrack(c) {
        return new Promise(function(resolve) {
          var startPath = location.pathname;
          var returnTo = location.pathname + location.search;
          S.expected = c.path;
          navigate(c.path);
          var tries = 0, clicks = 0, buttonSeenAt = 0;
          var iv = setInterval(function() {
            tries++;
            var cur = window.__scPlayer && window.__scPlayer.current();
            if (sameTrack(cur, c) && window.__scPlayer.isPlaying()) {
              clearInterval(iv);
              c.live = cur.path;
              if (returnTo !== location.pathname + location.search) setTimeout(function() { navigate(returnTo); }, 600);
              resolve(true);
              return;
            }
            // Only trust the button once the page really switched to the new track.
            var onNewPage = location.pathname !== startPath || startPath === c.path;
            var btn = onNewPage ? heroPlayButton() : null;
            if (btn) {
              if (!buttonSeenAt) buttonSeenAt = Date.now();
              var playing = btn.classList.contains('sc-button-pause');
              if (!playing && Date.now() - buttonSeenAt > 500 && (clicks === 0 || tries % 10 === 0) && clicks < 4) {
                clicks++;
                btn.click();
              }
            }
            if (tries > 56) { clearInterval(iv); resolve(false); }
          }, 250);
        });
      }

      function learn(c, progress, kind) {
        if (!c) return;
        var tags = c.tags.slice(0, 6);
        if (kind === 'like') { bump(data.artists, c.artistKey, 1.2); tags.forEach(function(t) { bump(data.tags, t, 0.5); }); }
        else if (kind === 'unlike') { bump(data.artists, c.artistKey, -1.2); tags.forEach(function(t) { bump(data.tags, t, -0.5); }); }
        else if (kind === 'dislike') { bump(data.artists, c.artistKey, -1.5); tags.forEach(function(t) { bump(data.tags, t, -0.45); }); }
        else if (kind === 'undislike') { bump(data.artists, c.artistKey, 1.5); tags.forEach(function(t) { bump(data.tags, t, 0.45); }); }
        else if (kind === 'skip' && progress < 0.3) { bump(data.artists, c.artistKey, -0.4); tags.forEach(function(t) { bump(data.tags, t, -0.15); }); }
        else if (kind === 'done') { bump(data.artists, c.artistKey, 0.2); tags.forEach(function(t) { bump(data.tags, t, 0.08); }); }
        save();
      }
      function progress() {
        var au = window.__scAudioElement;
        return au && isFinite(au.duration) && au.duration > 1 ? au.currentTime / au.duration : 0;
      }

      // ---------- How Wave feeds SoundCloud's own queue ----------
      // SoundCloud builds "Next up" from the related-tracks list of the track
      // that is playing, and asks for more pages as the queue drains. While Wave
      // is on, that list is answered from here (page by page, always from the
      // freshest ranking), so SoundCloud itself plays Wave's picks in order and
      // nothing has to open pages or switch tracks behind the user's back.
      var PAGE = 3;
      function relevantTrack(id) {
        if (S.starting && S.starting.id === id) return true;
        if (S.current && S.current.id === id) return true;
        if (S.recentIds.indexOf(id) >= 0) return true;
        if (S.served.some(function(c) { return c.id === id; }) || S.queue.some(function(c) { return c.id === id; })) return true;
        var cur = window.__scPlayer && window.__scPlayer.current();
        var T = window.__scTracks;
        var info = cur && T && T.byPath && T.byPath[cur.path];
        return !!(info && info.id === id);
      }
      window.__scRelatedOverride = function(trackId, data, url) {
        // Only the track that is actually playing gets Wave's list; browsing
        // other track pages must keep SoundCloud's own related tracks.
        if (!S.active || !relevantTrack(trackId)) return null;
        topUpQueue();
        if (!S.queue.length) return null;
        var offset = 0;
        try { offset = Number(new URLSearchParams(String(url || '').split('?')[1] || '').get('offset')) || 0; } catch (e) {}
        if (offset === 0) S.served = []; // a fresh list for a new track replaces the old promise
        var page = S.queue.splice(0, PAGE);
        S.served = S.served.concat(page);
        renderQueue();
        if (S.pool.length < 25 || S.queue.length < 3) fillPool().then(topUpQueue);
        return {
          collection: page.map(function(c) { return c.raw; }),
          next_href: 'https://api-v2.soundcloud.com/tracks/' + trackId + '/related?limit=' + PAGE + '&offset=' + (offset + page.length) + '&linked_partitioning=1',
          query_urn: data && data.query_urn,
          variant: data && data.variant
        };
      };

      function nextTrack() {
        var b = document.querySelector('.playControls__next');
        if (b) b.click();
      }

      function start() {
        if (S.active) return;
        if (!window.__scTracks || !window.__scTracks.clientId) { setStatus(_t('wave.no_api')); return; }
        S.active = true; S.played = {}; S.queue = []; S.served = []; S.current = null; S.recent = []; S.recentIds = []; S.artistCount = {}; S.lastProgress = 0;
        renderOrb();
        setStatus(_t('wave.loading'));
        fillPool().then(function() {
          if (!S.active) return;
          if (!S.pool.length) { setStatus(_t('wave.empty')); stop(true); return; }
          topUpQueue();
          var first = S.queue.shift();
          if (!first) { setStatus(_t('wave.empty')); stop(true); return; }
          S.starting = first;
          S.played[first.path] = 1;
          // Play the first pick right away; its related-list request is answered
          // with the following picks (see __scRelatedOverride).
          playTrack(first).then(function(ok) {
            if (!S.active) return;
            if (!ok) { setStatus(_t('wave.failed')); stop(true); return; }
            setStatus(_t('wave.playing'));
          });
        });
      }
      function stop(keepStatus) {
        S.active = false;
        renderOrb();
        if (!keepStatus) setStatus(_t('wave.hint'));
        nowBox.style.display = S.current ? 'block' : 'none';
      }
      function toggleWave() { if (S.active) stop(); else start(); }
      orb.addEventListener('click', toggleWave);
      toggleBtn.addEventListener('click', toggleWave);

      $('#sc-wave-skip').addEventListener('click', function() { nextTrack(); });
      likeBtn.addEventListener('click', function() {
        if (!S.current) return;
        if (S.current.vote === 'like') { S.current.vote = null; learn(S.current, progress(), 'unlike'); }
        else {
          if (S.current.vote === 'dislike') learn(S.current, progress(), 'undislike');
          S.current.vote = 'like';
          learn(S.current, progress(), 'like');
          showHeart();
        }
        renderVote();
        // The ranking changed: rebuild the not-yet-served part around the new taste.
        S.queue = [];
        fillPool().then(topUpQueue);
        topUpQueue();
      });
      dislikeBtn.addEventListener('click', function() {
        if (!S.current) return;
        if (S.current.vote === 'dislike') { S.current.vote = null; learn(S.current, progress(), 'undislike'); renderVote(); return; }
        if (S.current.vote === 'like') learn(S.current, progress(), 'unlike');
        S.current.vote = 'dislike';
        learn(S.current, progress(), 'dislike');
        renderVote();
        S.queue = [];
        topUpQueue();
        nextTrack();
      });

      // Follow what SoundCloud actually plays: Wave's picks become "current",
      // and how the previous one ended teaches the taste profile.
      setInterval(function() {
        if (S.current) S.lastProgress = Math.max(S.lastProgress, progress());
      }, 1000);
      (function hook() {
        if (!window.__scPlayer) { setTimeout(hook, 1000); return; }
        window.__scPlayer.on('track', function(c) {
          if (!S.active) return;
          if (S.current && sameTrack(c, S.current)) return;
          if (S.current) learn(S.current, S.lastProgress, S.lastProgress >= 0.8 ? 'done' : 'skip');
          S.lastProgress = 0;
          var idx = -1;
          for (var i = 0; i < S.served.length; i++) { if (sameTrack(c, S.served[i])) { idx = i; break; } }
          var picked = null;
          if (S.starting && sameTrack(c, S.starting)) { picked = S.starting; S.starting = null; }
          else if (idx >= 0) { picked = S.served[idx]; S.served = S.served.slice(idx + 1); }
          if (!picked) {
            // Not one of Wave's picks (the user chose it): still show it, learn nothing about it.
            S.current = null;
            nowBox.style.display = 'none';
            renderQueue();
            return;
          }
          S.current = picked;
          S.recent.push(picked.artistKey);
          if (S.recent.length > 6) S.recent.shift();
          S.recentIds.push(picked.id);
          if (S.recentIds.length > 8) S.recentIds.shift();
          S.artistCount[picked.artistKey] = (S.artistCount[picked.artistKey] || 0) + 1;
          S.played[picked.path] = 1;
          data.seen.push(picked.path);
          if (data.seen.length > 500) data.seen = data.seen.slice(-400);
          save();
          renderNow();
          topUpQueue();
        });
      })();
      window.__scWaveDebug = function() {
        return { active: S.active, current: S.current && S.current.path, starting: S.starting && S.starting.path,
          served: S.served.map(function(c) { return c.path; }), queue: S.queue.map(function(c) { return c.path; }), pool: S.pool.length };
      };
      renderOrb();
    })();
  `;
}

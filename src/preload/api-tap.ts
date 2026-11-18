// API tap — runs in the page's main world before SoundCloud's scripts
// (contextBridge.executeInMainWorld), so it must be fully self-contained.
//
// SoundCloud's own fetch/XHR calls to api-v2 are observed (never modified) to
// build a small in-page catalog of the tracks the page has seen:
//   window.__scTracks.byPath[path]  -> { id, title, artist, genre, tags, ... }
//   window.__scTracks.flagged[path] -> 'promoted' | 'preview'
//   window.__scTracks.clientId / .auth -> credentials the page already uses
//   window.__scTracks.reposts[path]  -> true for items the feed shows as reposts
// Promoted-track skipping, the Wave radio and lyrics cleanup read from it.
//
// The one response it rewrites (besides the Wave hook) is the home feed
// (/stream) when the user chose to hide reposts: repost items are dropped
// before SoundCloud renders the page. The choice is read from localStorage
// ('sc16:reposts', mirrored from the player.reposts setting by the page)
// because this runs before any of our page scripts.

export function installApiTap(): void {
  'use strict';
  const w = window as any;
  if (w.__scApiTapInstalled) return;
  w.__scApiTapInstalled = true;

  const store: any = {
    byPath: Object.create(null),
    byId: Object.create(null),
    flagged: Object.create(null),
    clientId: '',
    auth: '',
    count: 0,
    reposts: Object.create(null),
  };
  w.__scTracks = store;

  const PROMO_KEY = /^(is_?)?(promoted|sponsored|promotion|advert(ising)?|ad_?id|promoted_by|promoted_item)$/i;
  const PROMO_TYPE = /promot|sponsor|advert/i;

  function pathOf(url: string): string {
    try { return new URL(url).pathname; } catch (e) { return ''; }
  }

  function record(obj: any, ctxPromo: boolean): void {
    const path = pathOf(obj.permalink_url || '');
    if (!path) return;
    const tags: string[] = [];
    if (typeof obj.tag_list === 'string') {
      const re = /"([^"]+)"|(\S+)/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(obj.tag_list))) tags.push((m[1] || m[2]).toLowerCase());
    }
    const info = {
      id: obj.id,
      path,
      title: String(obj.title || ''),
      artist: String((obj.user && obj.user.username) || ''),
      artistPath: obj.user && obj.user.permalink_url ? pathOf(obj.user.permalink_url) : '',
      genre: String(obj.genre || '').toLowerCase(),
      tags,
      duration: Number(obj.duration) || 0,
      policy: String(obj.policy || ''),
      likes: Number(obj.likes_count) || 0,
      plays: Number(obj.playback_count) || 0,
      artwork: String(obj.artwork_url || (obj.user && obj.user.avatar_url) || ''),
    };
    if (!store.byPath[path]) store.count++;
    store.byPath[path] = info;
    if (obj.id != null) store.byId[obj.id] = info;

    let reason = '';
    if (ctxPromo) reason = 'promoted';
    else if (obj.policy === 'SNIP') reason = 'preview';
    if (reason && store.flagged[path] !== reason && !(reason === 'preview' && store.flagged[path] === 'promoted')) {
      store.flagged[path] = reason;
      try { console.warn('[Promo] flagged ' + reason + ': ' + path); } catch (e) { /* noop */ }
    }
  }

  function walk(node: any, ctxPromo: boolean, depth: number, budget: { n: number }): void {
    if (!node || typeof node !== 'object' || depth > 7 || budget.n-- <= 0) return;
    if (Array.isArray(node)) {
      for (let i = 0; i < node.length; i++) walk(node[i], ctxPromo, depth + 1, budget);
      return;
    }
    let promo = ctxPromo;
    if (!promo) {
      for (const key in node) {
        if (PROMO_KEY.test(key) && node[key]) { promo = true; break; }
      }
      if (!promo && typeof node.type === 'string' && PROMO_TYPE.test(node.type)) promo = true;
    }
    if (node.kind === 'track' && node.permalink_url) record(node, promo);
    for (const key in node) {
      const v = node[key];
      if (v && typeof v === 'object') walk(v, promo, depth + 1, budget);
    }
  }

  function ingest(data: any): void {
    try { walk(data, false, 0, { n: 6000 }); } catch (e) { /* noop */ }
  }

  function noteRequest(url: string, headers: any): void {
    try {
      const u = new URL(url, location.href);
      if (u.hostname !== 'api-v2.soundcloud.com') return;
      const cid = u.searchParams.get('client_id');
      if (cid) store.clientId = cid;
      let auth = '';
      if (headers) {
        if (typeof headers.get === 'function') auth = headers.get('Authorization') || '';
        else auth = headers.Authorization || headers.authorization || '';
      }
      if (auth) store.auth = auth;
    } catch (e) { /* noop */ }
  }

  const RELATED_RE = /\/tracks\/(\d+)\/related(?:\?|$)/;

  // ---- Feed reposts ----
  function repostMode(): string {
    try { return String(w.localStorage.getItem('sc16:reposts') || 'show'); } catch (e) { return 'show'; }
  }
  function isStreamUrl(url: string): boolean {
    try {
      const u = new URL(url, location.href);
      return u.hostname === 'api-v2.soundcloud.com' && /^\/stream\/?$/.test(u.pathname);
    } catch (e) { return false; }
  }
  function isRepost(item: any): boolean {
    return !!item && typeof item.type === 'string' && /-repost$/.test(item.type);
  }
  function noteReposts(data: any): void {
    if (!data || !Array.isArray(data.collection)) return;
    for (const item of data.collection) {
      if (!isRepost(item)) continue;
      const target = item.track || item.playlist;
      const path = target ? pathOf(target.permalink_url || '') : '';
      if (path) store.reposts[path] = true;
    }
  }
  // A feed page without its reposts, or null when there is nothing to drop.
  function filterReposts(data: any): any {
    if (!data || typeof data !== 'object' || !Array.isArray(data.collection)) return null;
    noteReposts(data);
    const kept = data.collection.filter(function (item: any) { return !isRepost(item); });
    if (kept.length === data.collection.length) return null;
    // A page of nothing but reposts would read as the end of the feed to
    // SoundCloud's infinite scroll: keep one, the page folds it (reposts.ts).
    if (!kept.length) kept.push(data.collection[0]);
    return Object.assign({}, data, { collection: kept });
  }
  w.__scFilterReposts = filterReposts;

  const origFetch = w.fetch;
  if (typeof origFetch === 'function') {
    w.fetch = function (this: any, input: any, init?: any): Promise<Response> {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) { /* noop */ }
      const p: Promise<Response> = origFetch.apply(this, arguments as any);
      try {
        if (url.indexOf('api-v2.soundcloud.com') !== -1 && isStreamUrl(url) && repostMode() === 'hide') {
          noteRequest(url, (init && init.headers) || (input && input.headers));
          return p.then(async (res) => {
            try {
              if (!res || !res.ok) return res;
              const data = await res.clone().json();
              ingest(data);
              const out = filterReposts(data);
              if (out) return new Response(JSON.stringify(out), { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } });
            } catch (e) { /* fall through to the original response */ }
            return res;
          });
        }
      } catch (e) { /* noop */ }
      // SoundCloud's autoplay follows the "related" list of the playing track.
      // A feature (Wave) may register window.__scRelatedOverride(trackId, data)
      // to substitute that list; returning null leaves the response untouched.
      try {
        const m = url.indexOf('api-v2.soundcloud.com') !== -1 ? RELATED_RE.exec(url) : null;
        if (m && typeof w.__scRelatedOverride === 'function') {
          noteRequest(url, (init && init.headers) || (input && input.headers));
          return p.then(async (res) => {
            try {
              if (!res || !res.ok) return res;
              const data = await res.clone().json();
              const out = await w.__scRelatedOverride(Number(m[1]), data, url);
              if (out && typeof out === 'object') {
                ingest(out);
                return new Response(JSON.stringify(out), { status: 200, statusText: 'OK', headers: { 'content-type': 'application/json' } });
              }
              ingest(data);
            } catch (e) { /* fall through to the original response */ }
            return res;
          });
        }
      } catch (e) { /* noop */ }
      try {
        if (url.indexOf('api-v2.soundcloud.com') !== -1) {
          noteRequest(url, (init && init.headers) || (input && input.headers));
          p.then((res) => {
            try {
              if (res && res.ok && /json/i.test(res.headers.get('content-type') || '')) {
                res.clone().json().then(function (data: any) {
                  ingest(data);
                  if (isStreamUrl(url)) noteReposts(data);
                }).catch(function () { /* noop */ });
              }
            } catch (e) { /* noop */ }
          }).catch(function () { /* noop */ });
        }
      } catch (e) { /* noop */ }
      return p;
    };
  }

  const XHR = w.XMLHttpRequest;
  if (XHR && XHR.prototype) {
    const origOpen = XHR.prototype.open;
    const nativeText = Object.getOwnPropertyDescriptor(XHR.prototype, 'responseText');
    const nativeResp = Object.getOwnPropertyDescriptor(XHR.prototype, 'response');
    XHR.prototype.open = function (this: any, method: string, url: string) {
      try {
        // SoundCloud loads the related list over XHR: expose the Wave override
        // through the response getters so the page's own handlers see it.
        const rm = typeof url === 'string' && url.indexOf('api-v2.soundcloud.com') !== -1 ? RELATED_RE.exec(url) : null;
        if (rm && nativeText && nativeText.get && nativeResp && nativeResp.get) {
          const self = this;
          let computed = false;
          let replaced: string | null = null;
          const compute = (): string | null => {
            if (computed) return replaced;
            if (self.readyState !== 4 || self.status !== 200 || typeof w.__scRelatedOverride !== 'function') return null;
            computed = true;
            try {
              const data = JSON.parse(nativeText.get!.call(self));
              const out = w.__scRelatedOverride(Number(rm[1]), data, url);
              if (out && typeof out === 'object' && typeof out.then !== 'function') {
                replaced = JSON.stringify(out);
                ingest(out);
              }
            } catch (e) { /* keep the original response */ }
            return replaced;
          };
          Object.defineProperty(this, 'responseText', {
            configurable: true,
            get: function () { const r = compute(); return r !== null ? r : nativeText.get!.call(self); },
          });
          Object.defineProperty(this, 'response', {
            configurable: true,
            get: function () {
              const r = compute();
              if (r === null) return nativeResp.get!.call(self);
              return self.responseType === 'json' ? JSON.parse(r) : r;
            },
          });
        }
        const hideReposts = typeof url === 'string' && isStreamUrl(url) && repostMode() === 'hide';
        if (hideReposts && nativeText && nativeText.get && nativeResp && nativeResp.get) {
          const self = this;
          let computed = false;
          let filtered: any = null;
          let filteredText: string | null = null;
          const compute = (): any => {
            if (computed) return filtered;
            if (self.readyState !== 4 || self.status !== 200) return null;
            computed = true;
            try {
              const raw = self.responseType === 'json' ? nativeResp.get!.call(self) : JSON.parse(nativeText.get!.call(self));
              filtered = filterReposts(raw);
              if (filtered) filteredText = JSON.stringify(filtered);
            } catch (e) { /* keep the original response */ }
            return filtered;
          };
          Object.defineProperty(this, 'responseText', {
            configurable: true,
            get: function () { return compute() ? filteredText : nativeText.get!.call(self); },
          });
          Object.defineProperty(this, 'response', {
            configurable: true,
            get: function () {
              const r = compute();
              if (!r) return nativeResp.get!.call(self);
              return self.responseType === 'json' ? r : filteredText;
            },
          });
        }
        if (typeof url === 'string' && url.indexOf('api-v2.soundcloud.com') !== -1) {
          noteRequest(url, null);
          const stream = isStreamUrl(url);
          this.addEventListener('load', function (this: any) {
            try {
              let data: any = null;
              if (this.responseType === '' || this.responseType === 'text') data = JSON.parse(this.responseText);
              else if (this.responseType === 'json') data = this.response;
              if (data) ingest(data);
              if (data && stream) noteReposts(data);
            } catch (e) { /* noop */ }
          });
        }
      } catch (e) { /* noop */ }
      return origOpen.apply(this, arguments as any);
    };
  }

  // Tracks embedded in the first HTML payload never go through fetch.
  document.addEventListener('DOMContentLoaded', function () {
    try { if (w.__sc_hydration) ingest(w.__sc_hydration); } catch (e) { /* noop */ }
  });
}

// API tap — runs in the page's main world before SoundCloud's scripts
// (contextBridge.executeInMainWorld), so it must be fully self-contained.
//
// SoundCloud's own fetch/XHR calls to api-v2 are observed (never modified) to
// build a small in-page catalog of the tracks the page has seen:
//   window.__scTracks.byPath[path]  -> { id, title, artist, genre, tags, ... }
//   window.__scTracks.flagged[path] -> 'promoted' | 'preview'
//   window.__scTracks.clientId / .auth -> credentials the page already uses
// Promoted-track skipping, the Wave radio and lyrics cleanup read from it.

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

  const origFetch = w.fetch;
  if (typeof origFetch === 'function') {
    w.fetch = function (this: any, input: any, init?: any): Promise<Response> {
      let url = '';
      try { url = typeof input === 'string' ? input : (input && input.url) || String(input); } catch (e) { /* noop */ }
      const p: Promise<Response> = origFetch.apply(this, arguments as any);
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
                res.clone().json().then(ingest).catch(function () { /* noop */ });
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
        if (typeof url === 'string' && url.indexOf('api-v2.soundcloud.com') !== -1) {
          noteRequest(url, null);
          this.addEventListener('load', function (this: any) {
            try {
              if (this.responseType === '' || this.responseType === 'text') ingest(JSON.parse(this.responseText));
              else if (this.responseType === 'json') ingest(this.response);
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

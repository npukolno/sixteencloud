import test from 'node:test';
import assert from 'node:assert/strict';
import { validateStoreValue } from '../dist/main/ipc/validators.js';

// Run the real (self-contained) API tap against a stubbed page.
const FEED = {
  collection: [
    { type: 'track', track: { kind: 'track', id: 1, title: 'Own', permalink_url: 'https://soundcloud.com/me/own', user: { username: 'me' } } },
    { type: 'track-repost', track: { kind: 'track', id: 2, title: 'Theirs', permalink_url: 'https://soundcloud.com/them/theirs', user: { username: 'them' } } },
    { type: 'playlist-repost', playlist: { kind: 'playlist', id: 3, permalink_url: 'https://soundcloud.com/them/sets/mix' } },
    { type: 'playlist', playlist: { kind: 'playlist', id: 4, permalink_url: 'https://soundcloud.com/me/sets/own' } },
  ],
  next_href: 'https://api-v2.soundcloud.com/stream?offset=abc',
};
const ONLY_REPOSTS = { collection: [FEED.collection[1], FEED.collection[2]], next_href: 'x' };

const storage = new Map();
let nextBody = FEED;
globalThis.window = globalThis;
globalThis.location = { href: 'https://soundcloud.com/feed', origin: 'https://soundcloud.com', pathname: '/feed' };
globalThis.document = { addEventListener() {} };
globalThis.localStorage = { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)) };
globalThis.fetch = async () => new Response(JSON.stringify(nextBody), { status: 200, headers: { 'content-type': 'application/json' } });

// Enough of XMLHttpRequest for the tap's getters and load listener.
class FakeXHR {
  constructor() { this.listeners = {}; this.readyState = 0; this.status = 0; this.responseType = ''; this._body = ''; }
  open() {}
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  get responseText() { return this._body; }
  get response() { return this.responseType === 'json' ? JSON.parse(this._body) : this._body; }
  finish(body) {
    this._body = JSON.stringify(body);
    this.readyState = 4;
    this.status = 200;
    for (const fn of this.listeners.load || []) fn.call(this);
  }
}
globalThis.XMLHttpRequest = FakeXHR;

const { installApiTap } = await import('../dist/preload/api-tap.js');
installApiTap();

const types = (data) => data.collection.map((i) => i.type);

test('feed responses are untouched unless reposts are hidden, but reposts are recorded', async () => {
  storage.delete('sc16:reposts');
  const res = await window.fetch('https://api-v2.soundcloud.com/stream?limit=10&client_id=x');
  const data = await res.json();
  assert.deepEqual(types(data), ['track', 'track-repost', 'playlist-repost', 'playlist']);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(window.__scTracks.reposts['/them/theirs'], true);
  assert.equal(window.__scTracks.reposts['/them/sets/mix'], true);
  assert.equal(window.__scTracks.reposts['/me/own'], undefined);
});

test('"hide" drops repost items from /stream over fetch', async () => {
  storage.set('sc16:reposts', 'hide');
  nextBody = FEED;
  const data = await (await window.fetch('https://api-v2.soundcloud.com/stream?limit=10')).json();
  assert.deepEqual(types(data), ['track', 'playlist']);
  assert.equal(data.next_href, FEED.next_href);
});

test('"hide" leaves other endpoints alone, including profile streams', async () => {
  storage.set('sc16:reposts', 'hide');
  nextBody = FEED;
  const profile = await (await window.fetch('https://api-v2.soundcloud.com/stream/users/5/reposts')).json();
  assert.equal(profile.collection.length, 4);
  const other = await (await window.fetch('https://api-v2.soundcloud.com/me/library/all')).json();
  assert.equal(other.collection.length, 4);
});

test('a page of only reposts keeps one so the infinite scroll continues', async () => {
  storage.set('sc16:reposts', 'hide');
  nextBody = ONLY_REPOSTS;
  const data = await (await window.fetch('https://api-v2.soundcloud.com/stream')).json();
  assert.equal(data.collection.length, 1);
  assert.equal(data.next_href, 'x');
});

test('"hide" also rewrites XHR responses (text and json)', () => {
  storage.set('sc16:reposts', 'hide');
  for (const responseType of ['', 'json']) {
    const xhr = new XMLHttpRequest();
    xhr.responseType = responseType;
    xhr.open('GET', 'https://api-v2.soundcloud.com/stream?limit=10');
    xhr.finish(FEED);
    const data = responseType === 'json' ? xhr.response : JSON.parse(xhr.responseText);
    assert.deepEqual(types(data), ['track', 'playlist'], `responseType "${responseType}"`);
  }
});

test('the filter ignores what is not a feed page', () => {
  assert.equal(window.__scFilterReposts(null), null);
  assert.equal(window.__scFilterReposts({ collection: 'x' }), null);
  assert.equal(window.__scFilterReposts({ collection: [FEED.collection[0]] }), null);
});

test('player.reposts is a validated store value', () => {
  for (const mode of ['show', 'collapse', 'hide']) assert.doesNotThrow(() => validateStoreValue('player.reposts', mode));
  assert.throws(() => validateStoreValue('player.reposts', 'all'));
});

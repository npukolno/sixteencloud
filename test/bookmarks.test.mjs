import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanBookmark, isBookmarkList, MAX_BOOKMARKS } from '../dist/shared/bookmarks.js';
import { validateStoreValue } from '../dist/main/ipc/validators.js';

const legacy = { name: 'Some mix', url: 'https://soundcloud.com/dj/mix', type: 'track' };

test('legacy bookmarks stay exactly as they were', () => {
  assert.deepEqual(cleanBookmark(legacy), legacy);
  assert.equal(isBookmarkList([legacy]), true);
  assert.doesNotThrow(() => validateStoreValue('sidebar.bookmarks', [legacy]));
});

test('new fields: artwork, pin, folder and timecode', () => {
  const full = {
    name: 'Set', url: 'https://soundcloud.com/dj/set', type: 'track',
    artwork: 'https://i1.sndcdn.com/artworks-x-t200x200.jpg', pinned: true, folder: 'Mixes', time: 3723,
  };
  assert.deepEqual(cleanBookmark(full), full);
  assert.equal(isBookmarkList([full, legacy]), true);
});

test('unsafe or odd values are dropped or normalised', () => {
  assert.equal(cleanBookmark({ ...legacy, url: 'http://soundcloud.com/dj/mix' }), null);
  assert.equal(cleanBookmark({ ...legacy, url: 'https://soundcloud.com.evil.example/x' }), null);
  assert.equal(cleanBookmark({ ...legacy, url: 'javascript:alert(1)' }), null);
  assert.equal(cleanBookmark({ ...legacy, type: 'script' }), null);
  assert.equal(cleanBookmark(null), null);
  assert.equal(cleanBookmark([legacy]), null);

  const odd = cleanBookmark({
    ...legacy, name: '  ', artwork: 'https://evil.example/a.jpg', pinned: 'yes', folder: '   ', time: 12.9, extra: '<b>',
  });
  assert.deepEqual(odd, { name: '/dj/mix', url: legacy.url, type: 'track', time: 12 });
  assert.equal(cleanBookmark({ ...legacy, time: -5 }).time, undefined);
  assert.equal(cleanBookmark({ ...legacy, folder: 'x'.repeat(100) }).folder.length, 60);
});

test('the store only accepts canonical lists', () => {
  assert.throws(() => validateStoreValue('sidebar.bookmarks', [{ ...legacy, extra: 1 }]));
  assert.throws(() => validateStoreValue('sidebar.bookmarks', [{ ...legacy, url: 'https://example.com/' }]));
  assert.throws(() => validateStoreValue('sidebar.bookmarks', [{ ...legacy, name: ' padded ' }]));
  assert.throws(() => validateStoreValue('sidebar.bookmarks', 'nope'));
  assert.throws(() => validateStoreValue('sidebar.bookmarks', new Array(MAX_BOOKMARKS + 1).fill(legacy)));
  assert.throws(() => validateStoreValue('sidebar', { bookmarks: [{ url: 'x' }] }));
  assert.doesNotThrow(() => validateStoreValue('sidebar', { bookmarks: [legacy] }));
});

test('the page copy of cleanBookmark works on its own', () => {
  const page = new Function(`${String(cleanBookmark)}; return cleanBookmark;`)();
  assert.deepEqual(page(legacy), legacy);
  assert.equal(page({ ...legacy, url: 'http://x' }), null);
  assert.equal(page({ ...legacy, time: 90.5 }).time, 90);
});

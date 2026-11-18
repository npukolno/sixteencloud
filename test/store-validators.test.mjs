import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_KEYS, validateStoreKey, validateStoreValue, validateOfflineQuickRequest } from '../dist/main/ipc/validators.js';

test('settings.ambient is a whitelisted boolean', () => {
  assert.equal(STORE_KEYS.has('settings.ambient'), true);
  assert.doesNotThrow(() => validateStoreKey('settings.ambient'));
  assert.doesNotThrow(() => validateStoreValue('settings.ambient', false));
  assert.throws(() => validateStoreValue('settings.ambient', 'yes'));
});

test('offline quick-save accepts only SoundCloud track pages and sanitises metadata', () => {
  const ok = validateOfflineQuickRequest({
    trackUrl: 'https://soundcloud.com/artist/track?in=artist/sets/x',
    title: '  Title ',
    artist: 'Artist',
    artworkUrl: 'https://i1.sndcdn.com/artworks-1-t500x500.jpg',
    duration: 215.4,
  });
  assert.deepEqual(ok, {
    trackUrl: 'https://soundcloud.com/artist/track?in=artist/sets/x',
    trackId: 'artist/track',
    title: 'Title',
    artist: 'Artist',
    artworkUrl: 'https://i1.sndcdn.com/artworks-1-t500x500.jpg',
    duration: 215.4,
  });
  const odd = validateOfflineQuickRequest({ trackUrl: 'https://soundcloud.com/a/b', artworkUrl: 'https://evil.example/x.jpg', duration: -1, title: 7 });
  assert.equal(odd.artworkUrl, '');
  assert.equal(odd.duration, 0);
  assert.equal(odd.title, '');
  assert.throws(() => validateOfflineQuickRequest({ trackUrl: 'http://soundcloud.com/a/b' }));
  assert.throws(() => validateOfflineQuickRequest({ trackUrl: 'https://soundcloud.com.evil.example/a/b' }));
  assert.throws(() => validateOfflineQuickRequest({ trackUrl: 'https://soundcloud.com/artist' }));
  assert.throws(() => validateOfflineQuickRequest(null));
});

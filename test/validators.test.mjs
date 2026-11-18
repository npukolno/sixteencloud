import test from 'node:test';
import assert from 'node:assert/strict';
import {
  STORE_KEYS, READ_ONLY_STORE_KEYS, validateStoreKey, validateStoreValue, validateDownloadRequest,
  isHlsPlaylistBuffer, safeFileName, coverArtUrl, escapeFfmpegMeta,
} from '../dist/main/ipc/validators.js';

const ok = (key, value) => assert.doesNotThrow(() => validateStoreValue(key, value), `${key}=${JSON.stringify(value)}`);
const bad = (key, value) => assert.throws(() => validateStoreValue(key, value), undefined, `${key}=${JSON.stringify(value)}`);

test('secrets are never reachable through the renderer store API', () => {
  for (const key of ['authToken', 'authToken.token', 'scrobble', 'scrobble.token']) {
    assert.equal(STORE_KEYS.has(key), false, key);
    assert.throws(() => validateStoreKey(key));
  }
  for (const key of READ_ONLY_STORE_KEYS) assert.ok(STORE_KEYS.has(key), `read-only key ${key} must be a known key`);
});

test('store values: enums, flags and ranges', () => {
  ok('language', 'ru'); bad('language', 'de');
  ok('downloader.quality', 'original'); bad('downloader.quality', '320');
  ok('player.resume', false); bad('player.resume', 'yes');
  ok('player.speed', 1.5); bad('player.speed', 4); bad('player.speed', NaN);
  ok('lyrics.fontSize', 24); bad('lyrics.fontSize', 2);
  ok('offlineCache.maxSizeMB', 500); bad('offlineCache.maxSizeMB', 10);
  ok('history.maxTracks', 0); bad('history.maxTracks', 1.5);
  ok('settings.accentColor', '#ff5500'); bad('settings.accentColor', 'red; background:url(x)');
  ok('geoBypass.proxyUrl', ''); ok('geoBypass.proxyUrl', 'socks5://127.0.0.1:1080'); bad('geoBypass.proxyUrl', 'file:///etc/passwd');
  ok('searchHistory', ['a', 'b']); bad('searchHistory', [1]); bad('searchHistory', new Array(31).fill('x'));
});

test('store values: structured state', () => {
  ok('equalizer', { enabled: true, preset: 'flat', bands: new Array(10).fill(0) });
  bad('equalizer', { enabled: true, preset: 'flat', bands: new Array(9).fill(0) });
  bad('equalizer', { enabled: true, preset: 'flat', bands: [13, 0, 0, 0, 0, 0, 0, 0, 0, 0] });
  ok('visualizer', { enabled: true, type: 'wave' });
  bad('visualizer', { enabled: true, type: 'nope' });
  ok('settings.keybinds', {});
  bad('settings.keybinds', { notAnAction: 'Ctrl+K' });
  bad('settings.keybinds', []);
  bad('customCss.code', 'x'.repeat(2_000_001));
});

const request = {
  trackUrl: 'https://soundcloud.com/forss/flickermood', trackId: 'forss/flickermood',
  title: 'Flickermood', artist: 'Forss', artworkUrl: 'https://i1.sndcdn.com/artworks-1-large.jpg', quality: '128',
};

test('download requests: accepted shape is normalised', () => {
  const r = validateDownloadRequest({ ...request, trackNumber: 99999, extra: 'ignored' });
  assert.equal(r.trackNumber, 10000);
  assert.equal('extra' in r, false);
  assert.equal(validateDownloadRequest({ ...request, artworkUrl: undefined }).artworkUrl, '');
});

test('download requests: untrusted URLs and bad fields are rejected', () => {
  assert.throws(() => validateDownloadRequest(null));
  assert.throws(() => validateDownloadRequest({ ...request, trackUrl: 'https://evil.test/x' }));
  assert.throws(() => validateDownloadRequest({ ...request, trackUrl: 'http://soundcloud.com/a/b' }));
  assert.throws(() => validateDownloadRequest({ ...request, artworkUrl: 'https://evil.test/a.jpg' }));
  assert.throws(() => validateDownloadRequest({ ...request, quality: '320' }));
  assert.throws(() => validateDownloadRequest({ ...request, title: '' }));
  assert.throws(() => validateDownloadRequest({ ...request, artist: 'x'.repeat(501) }));
});

test('HLS sniffing', () => {
  assert.equal(isHlsPlaylistBuffer(Buffer.from('#EXTM3U\n#EXT-X-VERSION:3\n')), true);
  assert.equal(isHlsPlaylistBuffer(Buffer.from('ID3\x03\x00')), false);
  assert.equal(isHlsPlaylistBuffer(Buffer.from('#EXT')), false);
  assert.equal(isHlsPlaylistBuffer(new Uint8Array([0xff, 0xfb, 0x90, 0x00, 0, 0, 0, 0])), false);
});

test('file names, cover URLs and ffmpeg metadata', () => {
  assert.equal(safeFileName('AC/DC: Back? <In> "Black"|*'), 'AC_DC_ Back_ _In_ _Black___');
  assert.equal(safeFileName('a\u0000b\nc'), 'a_b_c');
  assert.equal(safeFileName('x'.repeat(300)).length, 200);
  assert.equal(coverArtUrl('https://i1.sndcdn.com/artworks-abc-large.jpg'), 'https://i1.sndcdn.com/artworks-abc-t500x500.jpg');
  assert.equal(coverArtUrl('https://i1.sndcdn.com/artworks-abc-t120x120.png'), 'https://i1.sndcdn.com/artworks-abc-t500x500.png');
  assert.equal(escapeFfmpegMeta('a=b;c\\d\ne'), 'a\\=b\\;c\\\\d e');
});

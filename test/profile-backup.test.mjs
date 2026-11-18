import test from 'node:test';
import assert from 'node:assert/strict';
import { buildProfile, parseProfile, PROFILE_KEYS, PROFILE_KIND } from '../dist/main/ipc/profile-backup.js';
import { STORE_KEYS, READ_ONLY_STORE_KEYS } from '../dist/main/ipc/validators.js';

const STORE = {
  'language': 'ru',
  'settings.accentColor': '#a855f7',
  'settings.keybinds': { loopAB: 'Alt+KeyK' },
  'themes.active': 'custom_1',
  'themes.custom': { custom_1: { name: 'Mine', palette: { bg: '#101010', text: '#eeeeee' } } },
  'customCss.code': '.x { color: red }',
  'equalizer': { enabled: true, preset: 'bass', bands: [6, 5, 4, 2, 1, 0, 0, 0, 0, 0], customPresets: { Mine: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] } },
  'sidebar.bookmarks': [{ name: 'Set', url: 'https://soundcloud.com/a/b', type: 'track' }],
  'adblocker.customRules': ['ads.example'],
  'geoBypass.proxyUrl': 'http://user:secret@proxy.example:8080',
  // Secrets and local data that must never be exported:
  'authToken.token': 'oauth-secret',
  'scrobble.token': 'lb-secret',
  'downloader.outputDir': '/home/me/Music',
  'history.tracks': [{ title: 'x' }],
};

test('export carries settings but no tokens, paths, history or proxy credentials', () => {
  const profile = buildProfile((k) => STORE[k], '9.9.9', new Date('2026-01-02T03:04:05Z'));
  assert.equal(profile.kind, PROFILE_KIND);
  assert.equal(profile.exportedAt, '2026-01-02T03:04:05.000Z');
  assert.equal(profile.values['settings.accentColor'], '#a855f7');
  assert.deepEqual(profile.values['equalizer'].customPresets, { Mine: [1, 1, 1, 1, 1, 1, 1, 1, 1, 1] });
  const text = JSON.stringify(profile);
  for (const secret of ['oauth-secret', 'lb-secret', '/home/me/Music', 'secret@proxy']) {
    assert.equal(text.includes(secret), false, `${secret} leaked into the export`);
  }
  assert.equal('geoBypass.proxyUrl' in profile.values, false);
});

test('profile keys are writable store keys and never secrets', () => {
  for (const key of PROFILE_KEYS) {
    assert.equal(READ_ONLY_STORE_KEYS.has(key), false, key);
    assert.equal(/token|secret|password/i.test(key), false, key);
  }
  // Keys added by this feature set must be whitelisted for store:set.
  for (const key of ['settings.ambient', 'player.seekStep']) assert.ok(STORE_KEYS.has(key), key);
});

test('a round trip restores every exported value', () => {
  const profile = buildProfile((k) => STORE[k], '1.0.0');
  const { values, skipped } = parseProfile(JSON.stringify(profile));
  assert.deepEqual(skipped, []);
  assert.deepEqual(values, profile.values);
});

test('import validates every key and skips the bad ones', () => {
  const file = JSON.stringify({
    kind: PROFILE_KIND,
    version: 1,
    values: {
      'language': 'de',                                // not a supported language
      'settings.accentColor': 'red; background:url(x)',  // not a hex colour
      'player.speed': 2,
      'player.seekStep': 7,                            // not an offered step
      'settings.keybinds': { volumeUp: 'Ctrl+Nope' },  // unparsable combo
      'authToken.token': 'stolen',                     // never importable
      'downloader.history': [],                        // read-only
      'themes.custom': { 'bad id': { name: 'x', palette: {} } },
      'geoBypass.proxyUrl': 'socks5://u:p@host:1080',  // credentials
      'equalizer': { enabled: true, preset: 'x', bands: [99] },
      'customCss.code': 'body{}',
      '__proto__': { polluted: true },
    },
  });
  const { values, skipped } = parseProfile(file);
  assert.deepEqual(Object.keys(values).sort(), ['customCss.code', 'player.speed']);
  const reasons = Object.fromEntries(skipped.map((s) => [s.key, s.reason]));
  assert.equal(reasons['authToken.token'], 'not allowed');
  assert.equal(reasons['downloader.history'], 'not allowed');
  assert.equal(reasons['geoBypass.proxyUrl'], 'credentials');
  for (const key of ['language', 'settings.accentColor', 'player.seekStep', 'settings.keybinds', 'themes.custom', 'equalizer']) {
    assert.ok(key in reasons, `${key} should be skipped`);
  }
  assert.equal({}.polluted, undefined);
});

test('files that are not profiles are refused outright', () => {
  assert.throws(() => parseProfile('not json'), /JSON/);
  assert.throws(() => parseProfile(JSON.stringify({ kind: 'other', version: 1, values: {} })), /settings file/);
  assert.throws(() => parseProfile(JSON.stringify({ kind: PROFILE_KIND, version: 99, values: {} })), /version/);
  assert.throws(() => parseProfile(JSON.stringify({ kind: PROFILE_KIND, version: 1 })), /no values/);
  assert.throws(() => parseProfile('x'.repeat(3 * 1024 * 1024)), /too large/);
});

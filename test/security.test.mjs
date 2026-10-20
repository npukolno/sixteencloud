import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isTrustedSoundCloudUrl,
  isTrustedOAuthUrl,
  isAllowedMediaUrl,
  isSafeExternalUrl,
} from '../dist/shared/security.js';

test('SoundCloud URL validation rejects lookalike hosts and insecure schemes', () => {
  assert.equal(isTrustedSoundCloudUrl('https://soundcloud.com/artist/track'), true);
  assert.equal(isTrustedSoundCloudUrl('https://api.soundcloud.com/tracks/1'), true);
  assert.equal(isTrustedSoundCloudUrl('https://evil-soundcloud.com/artist/track'), false);
  assert.equal(isTrustedSoundCloudUrl('http://soundcloud.com/artist/track'), false);
  assert.equal(isTrustedSoundCloudUrl('javascript:alert(1)'), false);
});

test('OAuth and media URL validation are HTTPS-only', () => {
  assert.equal(isTrustedOAuthUrl('https://accounts.google.com/o/oauth2'), true);
  assert.equal(isTrustedOAuthUrl('https://accounts.google.com.evil.test/'), false);
  assert.equal(isAllowedMediaUrl('https://cf-media.sndcdn.com/track.mp3'), true);
  assert.equal(isAllowedMediaUrl('https://evil.test/track.mp3'), false);
  assert.equal(isSafeExternalUrl('https://example.test/path'), true);
  assert.equal(isSafeExternalUrl('file:///etc/passwd'), false);
});

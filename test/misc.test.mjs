import test from 'node:test';
import assert from 'node:assert/strict';
import { deepLinkToSoundCloudUrl } from '../dist/main/deep-link.js';
import { isSafeCssColor } from '../dist/shared/mini-player.js';
import { SC, clickScript, pauseScript, playScript, scJs } from '../dist/shared/sc-selectors.js';

test('deep links map only to SoundCloud paths', () => {
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://open/forss/flickermood'), 'https://soundcloud.com/forss/flickermood');
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://open/a%2Fb'), 'https://soundcloud.com/a/b');
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://open/..%2F..%2Fetc'), null);
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://open/%2F%2Fevil.test'), null);
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://open/%E0%A4%A'), null);
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://other/x'), null);
  assert.equal(deepLinkToSoundCloudUrl('sixteencloud://open/a b'), null);
});

test('mini-player theme filter only lets colours through', () => {
  for (const v of ['#fff', '#ff5500', '#0b0c0e80', 'rgb(1, 2, 3)', 'rgba(255,255,255,.07)', 'hsl(20deg 100% 50%)', 'transparent']) {
    assert.equal(isSafeCssColor(v), true, v);
  }
  for (const v of ['red', 'url(https://evil.test)', 'expression(alert(1))', '#ff5500; background: red', '', null, 42, 'x'.repeat(65)]) {
    assert.equal(isSafeCssColor(v), false, String(v));
  }
});

test('selector scripts are valid JavaScript', () => {
  for (const name of Object.keys(SC)) {
    assert.doesNotThrow(() => new Function(clickScript(name)), name);
    assert.equal(JSON.parse(scJs(name)), SC[name]);
  }
  assert.doesNotThrow(() => new Function(pauseScript()));
  assert.doesNotThrow(() => new Function(playScript()));
});

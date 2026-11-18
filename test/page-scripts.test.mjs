import test from 'node:test';
import assert from 'node:assert/strict';
import { getExtrasScripts } from '../dist/renderer/overlays/extras.js';
import { getEqualizerOverlayScript } from '../dist/renderer/overlays/equalizer.js';
import { getGeoBypassOverlayScript } from '../dist/renderer/overlays/geo-bypass.js';
import { getPlayerToolsOverlayScript } from '../dist/renderer/overlays/player-tools.js';
import { getLyricsOverlayScript } from '../dist/renderer/overlays/lyrics.js';
import { getSidebarOverlayScript } from '../dist/renderer/overlays/sidebar.js';
import { getDownloaderOverlayScript } from '../dist/renderer/overlays/downloader.js';
import { getTitlebarScript } from '../dist/renderer/overlays/titlebar.js';

// Page scripts are template strings: an unescaped backslash or quote only
// shows up as a SyntaxError inside the page. Parse every one of them here.
function assertParses(name, source) {
  assert.equal(typeof source, 'string', name);
  assert.doesNotThrow(() => new Function(source), `${name} does not parse`);
}

test('every extra page script parses', () => {
  const scripts = getExtrasScripts();
  assert.ok(scripts.length > 0);
  for (const [name, source] of scripts) assertParses(name, source);
});

test('panel scripts touched by the UX work parse', () => {
  assertParses('equalizer', getEqualizerOverlayScript());
  assertParses('geo-bypass', getGeoBypassOverlayScript());
  assertParses('player-tools', getPlayerToolsOverlayScript());
  assertParses('lyrics', getLyricsOverlayScript());
  assertParses('sidebar', getSidebarOverlayScript());
  assertParses('downloader', getDownloaderOverlayScript());
  assertParses('titlebar', getTitlebarScript());
});

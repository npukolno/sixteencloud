import test from 'node:test';
import assert from 'node:assert/strict';
import {
  lrcToPlain, parseLrclibResult, pickLrclib, extractGeniusLyrics, extractAZLyrics, extractChartLyrics,
} from '../dist/main/ipc/lyrics-parse.js';

test('LRC to plain text drops timings and metadata', () => {
  const lrc = '[ar:Artist]\n[ti:Song]\n[00:01.00]First line\n[00:02.50] Second line\n\n\n\n[00:04.000]Third';
  assert.equal(lrcToPlain(lrc), 'First line\n Second line\n\nThird');
});

test('lrclib: synced lyrics win over plain', () => {
  assert.equal(parseLrclibResult({ plainLyrics: 'plain', syncedLyrics: '[00:01.00]sync' }).syncedLyrics, '[00:01.00]sync');
  assert.equal(parseLrclibResult({ plainLyrics: 'plain' }).lyrics, 'plain');
  assert.equal(parseLrclibResult({}), null);
});

test('lrclib pick: only matching names count, synced and closer duration win', () => {
  const wanted = [{ artist: 'Forss', title: 'Flickermood' }];
  const entries = [
    { trackName: 'Other Song', artistName: 'Someone', duration: 213, syncedLyrics: '[00:01.00]wrong song' },
    { trackName: 'Flickermood', artistName: 'Forss', duration: 300, plainLyrics: 'plain far' },
    { trackName: 'Flickermood', artistName: 'Forss', duration: 214, syncedLyrics: '[00:01.00]right song' },
    null,
  ];
  const best = pickLrclib(entries, 213, wanted);
  assert.equal(best.syncedLyrics, '[00:01.00]right song');
  assert.equal(pickLrclib([entries[0]], 213, wanted), null);
});

test('Genius: containers are joined, excluded blocks and junk removed', () => {
  const html = '<div data-lyrics-container="true"><div data-exclude-from-selection="true"><div>12 Contributors</div>Song Lyrics</div>Line one<br>Line two<br/>You might also like</div>'
    + '<p>noise</p><div data-lyrics-container="true">Line three &amp; four<br>Line five is long enough</div>';
  const lyrics = extractGeniusLyrics(html);
  assert.ok(lyrics);
  assert.match(lyrics, /Line one\nLine two/);
  assert.match(lyrics, /Line three & four/);
  assert.doesNotMatch(lyrics, /Contributors|You might also like|noise/);
  assert.equal(extractGeniusLyrics('<div>nothing</div>'), null);
});

test('AZLyrics and ChartLyrics extraction', () => {
  const az = '<div class="x"></div><!-- Usage of azlyrics.com content by any third-party lyrics provider is prohibited. -->\n<div>\nFirst &quot;line&quot;<br>\nSecond line of the song here</div>';
  assert.equal(extractAZLyrics(az), 'First "line"\n\nSecond line of the song here');
  assert.equal(extractAZLyrics('<div>no marker</div>'), null);
  assert.equal(extractChartLyrics('<GetLyricResult><Lyric>Words &amp; more words for the test</Lyric></GetLyricResult>'), 'Words & more words for the test');
  assert.equal(extractChartLyrics('<Lyric>short</Lyric>'), null);
});

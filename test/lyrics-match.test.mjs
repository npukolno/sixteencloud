import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSoundCloudTrack, matchScore, similarity, foldFancy } from '../dist/shared/lyrics-match.js';

const first = (artist, title) => parseSoundCloudTrack(artist, title)[0];

test('a dash that introduces credits does not split artist and title', () => {
  const q = parseSoundCloudTrack('sekairotten', '46°C - feat. pas de vie / prod. @saintexperiment');
  assert.deepEqual(q[0], { artist: 'sekairotten', title: '46°C' });
  assert.ok(q.some((x) => x.title === '46C'), 'degree sign is also tried without the symbol');
  for (const x of q) assert.ok(!/[-(\[]\s*$/.test(x.title), `dangling separator in "${x.title}"`);
});

test('"Artist - Title" uploads by someone else are split', () => {
  assert.deepEqual(first('Some Uploader', 'The Weeknd - Blinding Lights (Official Audio)'), { artist: 'The Weeknd', title: 'Blinding Lights' });
  assert.deepEqual(first('x', 'Artist - Song (feat. Other)'), { artist: 'Artist', title: 'Song' });
});

test('decorated titles are cleaned', () => {
  assert.equal(foldFancy('ᴢᴇᴍꜰɪʀᴀ'), 'zemfira');
  const q = parseSoundCloudTrack('ᴢᴇᴍꜰɪʀᴀ', 'Искала [prod. x] (slowed + reverb) | free');
  assert.deepEqual(q[0], { artist: 'zemfira', title: 'Искала' });
  assert.deepEqual(first('plasticsuzuran', 'может мы встретимся"//'), { artist: 'plasticsuzuran', title: 'может мы встретимся' });
});

test('catalogue entries must really match the track', () => {
  const wanted = parseSoundCloudTrack('sekairotten', '46°C - feat. pas de vie / prod. @saintexperiment');
  assert.ok(matchScore('46C', 'sekairotten', wanted) > 0);
  assert.ok(matchScore('46°C', 'sekairotten', wanted) > 0);
  // Same tokens, different order: another song entirely.
  assert.equal(matchScore('C-46', 'CHAGE and ASKA', wanted), 0);
  assert.equal(matchScore('Mami', 'Vico C', wanted), 0);
  assert.equal(matchScore('Down bad', 'someone', wanted), 0);
});

test('similarity respects word order and containment', () => {
  assert.ok(similarity('Blinding Lights', 'blinding lights (remix)') >= 0.8);
  assert.ok(similarity('46°C', 'C-46') < 0.8);
  assert.equal(similarity('', 'abc'), 0);
});

test('short titles need the right artist or the right length', () => {
  const wanted = parseSoundCloudTrack('9mice, Егор Крид, тёмный принц, madk1d', 'Jealous');
  assert.equal(wanted[0].artist, '9mice');
  assert.equal(matchScore('Jealous', 'soft.', wanted), 0);            // other song, same name
  assert.equal(matchScore('Jealous', 'soft.', wanted, 40), 0);        // and a different length
  assert.ok(matchScore('Jealous', 'soft.', wanted, 1) > 0);           // same length: plausible
  assert.ok(matchScore('Jealous', '9mice', wanted) > 0);              // right artist
});

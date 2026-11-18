import test from 'node:test';
import assert from 'node:assert/strict';
import { planEviction } from '../dist/main/offline-cache-policy.js';

const MB = 1024 * 1024;
const entry = (id, day, mb) => ({ trackId: id, cachedAt: `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`, fileSize: mb * MB });

test('nothing is evicted under the limit', () => {
  const { keep, evict } = planEviction([entry('a', 1, 100), entry('b', 2, 100)], 500 * MB);
  assert.equal(evict.length, 0);
  assert.deepEqual(keep.map(e => e.trackId), ['a', 'b']);
});

test('oldest entries go first until the total fits', () => {
  const tracks = [entry('new', 9, 200), entry('old', 1, 200), entry('mid', 5, 200)];
  const { keep, evict } = planEviction(tracks, 450 * MB);
  assert.deepEqual(evict.map(e => e.trackId), ['old']);
  assert.deepEqual(keep.map(e => e.trackId), ['mid', 'new']);
  assert.deepEqual(planEviction(tracks, 250 * MB).evict.map(e => e.trackId), ['old', 'mid']);
});

test('exactly at the limit is kept; unparsable dates count as oldest', () => {
  assert.equal(planEviction([entry('a', 1, 250), entry('b', 2, 250)], 500 * MB).evict.length, 0);
  const broken = { trackId: 'broken', cachedAt: 'not a date', fileSize: 100 * MB };
  const { evict } = planEviction([entry('a', 1, 450), broken], 500 * MB);
  assert.deepEqual(evict.map(e => e.trackId), ['broken']);
});

test('negative or missing sizes do not break the sum, input is not mutated', () => {
  const tracks = [{ trackId: 'x', cachedAt: '2026-01-01', fileSize: -5 }, entry('y', 2, 10)];
  const copy = JSON.stringify(tracks);
  assert.equal(planEviction(tracks, 20 * MB).evict.length, 0);
  assert.equal(JSON.stringify(tracks), copy);
});

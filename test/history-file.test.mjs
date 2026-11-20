import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { HistoryFile, migrateHistory } from '../dist/main/ipc/history-file.js';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'sc-history-'));
const stats = { dataVersion: 1, tracksTotal: 3, secondsTotal: 90, artists: { a: 3 }, days: {}, tracks: {} };

test('data survives a flush and a fresh load', () => {
  const dir = tmp();
  const a = new HistoryFile(dir);
  a.setTracks([{ title: 'x' }]);
  a.setStats(stats);
  a.flush();
  const b = new HistoryFile(dir);
  assert.deepEqual(b.getTracks(), [{ title: 'x' }]);
  assert.equal(b.getStats().tracksTotal, 3);
  assert.equal(fs.existsSync(path.join(dir, 'history.json.tmp')), false);
});

test('empty directory gives empty history, not an error', () => {
  const h = new HistoryFile(tmp());
  assert.deepEqual(h.getTracks(), []);
  assert.equal(h.getStats().dataVersion, 1);
});

test('a corrupt file is set aside and never overwritten silently', () => {
  const dir = tmp();
  fs.writeFileSync(path.join(dir, 'history.json'), '{not json');
  const warnings = [];
  const h = new HistoryFile(dir, (m) => warnings.push(m));
  assert.deepEqual(h.getTracks(), []);
  assert.equal(warnings.length, 1);
  assert.ok(fs.readdirSync(dir).some((f) => f.startsWith('history.json.corrupt-')));
});

test('migration moves legacy data and clears the config copies only after the file exists', () => {
  const dir = tmp();
  const h = new HistoryFile(dir);
  let cleared = false;
  const moved = migrateHistory(h, { tracks: [{ title: 'old' }], stats }, () => { cleared = true; });
  assert.equal(moved, true);
  assert.equal(cleared, true);
  assert.deepEqual(new HistoryFile(dir).getTracks(), [{ title: 'old' }]);
});

test('migration does nothing when the file already exists or there is nothing to move', () => {
  const dir = tmp();
  let cleared = 0;
  assert.equal(migrateHistory(new HistoryFile(dir), { tracks: [], stats: {} }, () => { cleared++; }), false);
  const h = new HistoryFile(dir); h.setTracks([{ title: 'n' }]); h.flush();
  assert.equal(migrateHistory(new HistoryFile(dir), { tracks: [{ title: 'legacy' }], stats }, () => { cleared++; }), false);
  assert.equal(cleared, 0);
  assert.deepEqual(new HistoryFile(dir).getTracks(), [{ title: 'n' }]);
});

test('failed write keeps legacy data in the config', () => {
  const dir = path.join(tmp(), 'blocked');
  fs.writeFileSync(dir, 'a file where the directory should be');
  const h = new HistoryFile(dir, () => {});
  let cleared = false;
  assert.equal(migrateHistory(h, { tracks: [{ title: 'old' }], stats }, () => { cleared = true; }), false);
  assert.equal(cleared, false);
});

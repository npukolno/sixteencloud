import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { parseLyrics, detectLang, toTokens, isAdlib, isVocalise, latToCyr, suspiciousLines } from '../dist/shared/lyricsync/text.js';
import { seqRatio } from '../dist/shared/lyricsync/difflib.js';
import { fft, frameDb, percentile, melFilters } from '../dist/shared/lyricsync/dsp.js';
import { alignWords } from '../dist/shared/lyricsync/ctc.js';
import { findBlocks, pyRound } from '../dist/shared/lyricsync/repeats.js';
import { alignLyrics, toLrc, recognition } from '../dist/shared/lyricsync/pipeline.js';
import { Library, lyricsKey } from '../dist/main/lyricsync/library.js';
import { LANGUAGES, SEPARATOR, wasmPack, packSize } from '../dist/main/lyricsync/manifest.js';
import { extractTgz, installPack, isInstalled } from '../dist/main/lyricsync/models.js';

test('lyrics text: labels, @nicks, separators dropped; (x2) expanded', () => {
  const raw = '[Текст песни «x»]\n@nick\n\nа\nб (x2)\nв\n\nг\nд х2\n[Припев]\nе\n_____\n';
  // (x2) mid-stanza repeats the line, on the last line of a stanza the whole stanza
  assert.deepEqual(parseLyrics(raw), ['а', 'б', 'б', 'в', 'г', 'д', 'г', 'д', 'е']);
  assert.deepEqual(parseLyrics('one\ntwo (2 раза)'), ['one', 'two', 'one', 'two']);
  assert.deepEqual(suspiciousLines('Текст: Иванов\nhttps://x.y\nобычная строка'), ['Текст: Иванов', 'https://x.y']);
});

test('lyrics text: language, ad-libs, vocalises, tokens', () => {
  assert.equal(detectLang(['я иду домой', 'ok']), 'ru');
  assert.equal(detectLang(['I walk home', 'да']), 'en');
  assert.equal(detectLang(['їжак і ґанок', 'є']), 'uk');
  assert.ok(isAdlib('Я-я-я, я-я-я, я-я-я, эй, эй'));
  assert.ok(!isAdlib('Я и ты'));
  assert.ok(isVocalise('А-аа-а!'));
  assert.ok(!isVocalise('Ага'));
  assert.equal(latToCyr('shine'), 'шине');
  const ru = { lang: 'ru', variant: 'xlsr', vocab: { а: 1, б: 2, '|': 3, '<pad>': 0, к: 4, и: 5, н: 6, г: 7 }, blank: 0, delim: 3 };
  assert.deepEqual(toTokens('Аб-ба!', ru), [1, 2, 2, 1]);
  assert.deepEqual(toTokens('king', ru), [4, 5, 6, 7]);          // Latin in a Russian song is transliterated
  const en = { lang: 'en', variant: 'xlsr', vocab: { D: 1, A: 2, '|': 3, '<pad>': 0 }, blank: 0, delim: 3 };
  assert.deepEqual(toTokens('да', en), [1, 2]);                   // Cyrillic in an English song too
});

test('difflib ratio equals Python, including the autojunk rule', () => {
  const cases = [
    ['серый ситроен', 'серыйситроен везёт', 0.7741935483870968],
    ['abcde'.repeat(50), 'abdce'.repeat(49) + 'xyz', 0.008032128514056224],
    ['', 'a', 0],
    ['я механик бро', 'я механик, бро', 0.9629629629629629],
    ['kitten', 'sitting', 0.6153846153846154],
  ];
  for (const [a, b, want] of cases) assert.ok(Math.abs(seqRatio(a, b) - want) < 1e-12, `${a.slice(0, 10)}: ${seqRatio(a, b)} vs ${want}`);
});

test('mixed-radix FFT matches a direct DFT (sizes 320, 7680)', () => {
  for (const N of [320, 7680, 1024, 12]) {
    const re = new Float64Array(N), im = new Float64Array(N);
    for (let i = 0; i < N; i++) { re[i] = Math.sin(i * 0.37) + (i % 7) * 0.1; im[i] = Math.cos(i * 0.11) * 0.5; }
    const r0 = Float64Array.from(re), i0 = Float64Array.from(im);
    fft(re, im);
    for (const k of [0, 1, 5, N >> 1, N - 1]) {
      let sr = 0, si = 0;
      for (let n = 0; n < N; n++) { const a = (-2 * Math.PI * k * n) / N; sr += r0[n] * Math.cos(a) - i0[n] * Math.sin(a); si += r0[n] * Math.sin(a) + i0[n] * Math.cos(a); }
      assert.ok(Math.abs(sr - re[k]) < 1e-6 * N && Math.abs(si - im[k]) < 1e-6 * N, `N=${N} k=${k}`);
    }
    fft(re, im, true);
    for (let i = 0; i < N; i++) assert.ok(Math.abs(re[i] / N - r0[i]) < 1e-9, 'inverse');
  }
});

test('dsp helpers: percentile, loudness, mel filters', () => {
  assert.equal(percentile([1, 2, 3, 4], 50), 2.5);
  const db = frameDb(new Float32Array(1600).fill(0.1), 10);
  assert.ok(Math.abs(db[0] - 20 * Math.log10(0.1)) < 1e-4);
  const W = melFilters(16000, 320, 64, true, false, 0, 8000);
  assert.equal(W.length, 64 * 161);
  assert.ok(W.every((x) => x >= 0));
  assert.equal(pyRound(2.5), 2);
  assert.equal(pyRound(3.5), 4);
});

// A tiny synthetic CTC problem: two words, the model "says" each letter in a known place.
function synth(T, V, spots) {
  const d = new Float32Array(T * V).fill(Math.log(0.01));
  for (let t = 0; t < T; t++) d[t * V] = Math.log(0.9);                 // blank elsewhere
  for (const [t, v] of spots) { d[t * V] = Math.log(0.01); d[t * V + v] = Math.log(0.95); }
  return { data: d, T, V };
}

test('CTC alignment puts words where the model hears them, and honours windows', () => {
  const lp = synth(200, 4, [[50, 1], [52, 2], [120, 2], [122, 1], [121, 3]]);
  const words = [[1, 2], [2, 1]];
  const res = alignWords(lp, words, 0, 3, Int32Array.from([0, 1]));
  assert.equal(Math.round(res[0].start / 0.02), 50);
  assert.equal(Math.round(res[1].start / 0.02), 120);
  // a hard window for line 1 moves the second word away from what the model heard
  const res2 = alignWords(lp, words, 0, 3, Int32Array.from([0, 1]), { windows: new Map([[1, [3, 3.5]]]) });
  assert.ok(res2[1].start >= 3 - 1e-6 && res2[1].start <= 3.5);
  assert.throws(() => alignWords(synth(3, 4, []), words, 0, 3, Int32Array.from([0, 1])), /does not fit/);
});

test('pipeline on synthetic emissions: lines, lead, gaps, LRC', () => {
  const V = 5;   // blank, а, б, |, в
  const lp = synth(1000, V, [[100, 1], [102, 2], [500, 4], [502, 1]]);
  const spec = { lang: 'ru', variant: 'xlsr', vocab: { '<pad>': 0, а: 1, б: 2, '|': 3, в: 4 }, blank: 0, delim: 3 };
  const res = alignLyrics({ logp: lp, spec, lines: ['аб', 'ва'], vocal: null, feats: { F: new Float32Array(0), T: 0, D: 19 }, voiced: null, dur: 20, repeat: false });
  assert.equal(res.lines.length, 2);
  assert.ok(Math.abs(res.lines[0].start - (2.0 - 0.15)) < 0.03, String(res.lines[0].start));
  assert.ok(Math.abs(res.lines[1].start - (10.0 - 0.15)) < 0.03, String(res.lines[1].start));
  assert.equal(res.meta.recognition.level, 'good');
  const lrc = toLrc(res, { title: 't' });
  assert.match(lrc, /\[00:01\.8\d\]аб/);
  assert.match(lrc, /\[00:09\.8\d\]ва/);
  assert.equal(recognition([{ text: 'x', match: 0.1 }]).level, 'poor');
  assert.deepEqual(findBlocks(['a b', 'c d', 'x', 'a b', 'c d']), [[0, 3, 2]]);
});

test('library: save, replace, list, delete', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsx-lib-'));
  const lib = new Library(dir);
  const base = { key: lyricsKey('Art', 'Song'), title: 'Song', artist: 'Art', lang: 'ru', duration: 100, lrc: '[00:01.00]x\n', text: 'x', lines: [], recognition: { score: 1, heard_pct: 100, level: 'good' } };
  const a = lib.save(base);
  const b = lib.save({ ...base, lrc: '[00:02.00]x\n' });
  assert.equal(a.id, b.id, 'same track and language replaces the old sync');
  assert.equal(lib.list().length, 1);
  assert.equal(lib.byKey('art|song')[0].lrc, '[00:02.00]x\n');
  fs.writeFileSync(path.join(dir, '0123456789abcdef.json'), '{broken');
  assert.equal(lib.list().length, 1, 'a broken file is skipped');
  lib.remove(a.id);
  assert.equal(lib.list().length, 0);
  assert.equal(lib.get('../x'), null);
  assert.throws(() => lib.remove('../x'), /bad sync id/);
});

test('manifest: every file is pinned and verified', () => {
  for (const p of [SEPARATOR, LANGUAGES.ru, LANGUAGES.en, wasmPack()]) {
    for (const f of p.files) {
      assert.ok(f.sha256 || f.integrity, `${p.id}/${f.path} has a hash`);
      assert.ok(f.size > 0, `${p.id}/${f.path} has a size`);
      assert.match(f.url, /^https:\/\//);
      if (/huggingface/.test(f.url)) assert.match(f.url, /\/resolve\/[0-9a-f]{40}\//, 'pinned revision');
    }
  }
  assert.ok(packSize(LANGUAGES.ru) < 600e6);
});

function tarEntry(name, body) {
  const h = Buffer.alloc(512);
  h.write(name, 0, 'utf8');
  h.write('0000644\0', 100); h.write('0000000\0', 108); h.write('0000000\0', 116);
  h.write(body.length.toString(8).padStart(11, '0') + '\0', 124);
  h.write('00000000000\0', 136); h.write('        ', 148); h.write('0', 156); h.write('ustar\0', 257);
  let sum = 0; for (const x of h) sum += x;
  h.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  return Buffer.concat([h, body, Buffer.alloc((512 - (body.length % 512)) % 512)]);
}

test('tarball extraction keeps only wanted entries and refuses path escapes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsx-tar-'));
  const tgz = path.join(dir, 'p.tgz');
  fs.writeFileSync(tgz, zlib.gzipSync(Buffer.concat([
    tarEntry('package/package.json', Buffer.from('{}')), tarEntry('package/dist/a.js', Buffer.from('x')),
    tarEntry('package/bin/other/b.node', Buffer.from('y')), Buffer.alloc(1024),
  ])));
  const n = await extractTgz(tgz, { strip: 'package/', include: (p) => p === 'package.json' || p.startsWith('dist/'), into: 'm' }, dir);
  assert.equal(n, 2);
  assert.ok(fs.existsSync(path.join(dir, 'm/dist/a.js')));
  assert.ok(!fs.existsSync(path.join(dir, 'm/bin')));
  fs.writeFileSync(tgz, zlib.gzipSync(Buffer.concat([tarEntry('package/../../evil.js', Buffer.from('z')), Buffer.alloc(1024)])));
  await assert.rejects(extractTgz(tgz, { strip: 'package/', include: () => true, into: 'm' }, dir), /unsafe path/);
});

test('pack install: resumes a partial file, verifies the hash, writes the marker', async () => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'lsx-pack-'));
  const body = Buffer.from('hello lyricsync '.repeat(1000));
  const sha256 = (await import('node:crypto')).createHash('sha256').update(body).digest('hex');
  const pack = { id: 'tst', kind: 'separator', files: [{ path: 'm.bin', url: 'https://x/m.bin', size: body.length, sha256 }] };
  fs.mkdirSync(path.join(base, 'packs/tst'), { recursive: true });
  fs.writeFileSync(path.join(base, 'packs/tst/m.bin.part'), body.subarray(0, 5000));
  const seen = [];
  const fakeFetch = async (_url, init) => {
    const from = Number(/bytes=(\d+)-/.exec(init?.headers?.Range || '')?.[1] || 0);
    seen.push(from);
    return new Response(body.subarray(from), { status: from ? 206 : 200 });
  };
  await installPack(base, pack, fakeFetch, new AbortController().signal, () => {});
  assert.deepEqual(seen, [5000], 'continued from the partial file');
  assert.ok(isInstalled(base, pack));
  const bad = { ...pack, id: 'bad', files: [{ ...pack.files[0], sha256: '0'.repeat(64) }] };
  await assert.rejects(installPack(base, bad, fakeFetch, new AbortController().signal, () => {}), /checksum/);
});

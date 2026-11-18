import test from 'node:test';
import assert from 'node:assert/strict';
import { getTranslationKeys, getRawTranslation } from '../dist/shared/i18n.js';
import { MINI_STRING_KEYS } from '../dist/shared/mini-player.js';

const placeholders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort();

test('en and ru define exactly the same keys', () => {
  const en = new Set(getTranslationKeys('en'));
  const ru = new Set(getTranslationKeys('ru'));
  const missingInRu = [...en].filter(k => !ru.has(k));
  const missingInEn = [...ru].filter(k => !en.has(k));
  assert.deepEqual(missingInRu, [], `missing in ru: ${missingInRu.join(', ')}`);
  assert.deepEqual(missingInEn, [], `missing in en: ${missingInEn.join(', ')}`);
});

test('translations keep the same {placeholders}', () => {
  const bad = getTranslationKeys('en').filter(k => {
    const ru = getRawTranslation('ru', k);
    return ru !== undefined && placeholders(getRawTranslation('en', k)).join() !== placeholders(ru).join();
  });
  assert.deepEqual(bad, []);
});

test('no empty translations', () => {
  for (const lang of ['en', 'ru']) {
    const empty = getTranslationKeys(lang).filter(k => !String(getRawTranslation(lang, k)).trim());
    assert.deepEqual(empty, [], `${lang}: ${empty.join(', ')}`);
  }
});

test('mini-player strings exist in both languages', () => {
  for (const key of MINI_STRING_KEYS) {
    assert.ok(getRawTranslation('en', key), `en ${key}`);
    assert.ok(getRawTranslation('ru', key), `ru ${key}`);
  }
});

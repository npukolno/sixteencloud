import test from 'node:test';
import assert from 'node:assert/strict';
import { STORE_KEYS, validateStoreKey, validateStoreValue } from '../dist/main/ipc/validators.js';

test('settings.ambient is a whitelisted boolean', () => {
  assert.equal(STORE_KEYS.has('settings.ambient'), true);
  assert.doesNotThrow(() => validateStoreKey('settings.ambient'));
  assert.doesNotThrow(() => validateStoreValue('settings.ambient', false));
  assert.throws(() => validateStoreValue('settings.ambient', 'yes'));
});

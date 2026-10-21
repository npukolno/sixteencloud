import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseCombo,
  matchesCombo,
  formatCombo,
  defaultKeybinds,
  resolveKeybinds,
  comboLabel,
  isModifierKey,
} from '../dist/shared/keybinds.js';

const key = (overrides = {}) => ({
  code: 'KeyB',
  key: 'b',
  control: false,
  alt: false,
  shift: false,
  meta: false,
  ...overrides,
});

test('parseCombo accepts modifier aliases and rejects incomplete combos', () => {
  assert.deepEqual(parseCombo('Ctrl+KeyB'), { code: 'KeyB', control: true, alt: false, shift: false, meta: false });
  assert.deepEqual(parseCombo('cmd+shift+KeyP'), { code: 'KeyP', control: false, alt: false, shift: true, meta: true });
  assert.deepEqual(parseCombo('Space'), { code: 'Space', control: false, alt: false, shift: false, meta: false });
  assert.equal(parseCombo(''), null);
  assert.equal(parseCombo('Ctrl+Shift'), null);
  assert.equal(parseCombo(null), null);
});

test('matchesCombo requires exact modifier state', () => {
  assert.equal(matchesCombo('Ctrl+KeyB', key({ control: true })), true);
  assert.equal(matchesCombo('Ctrl+KeyB', key({ control: true, shift: true })), false);
  assert.equal(matchesCombo('Ctrl+KeyB', key({ control: true, alt: true })), false);
  assert.equal(matchesCombo('Space', key({ code: 'Space', key: ' ' })), true);
  assert.equal(matchesCombo('Ctrl+ArrowUp', key({ code: 'ArrowUp', key: 'ArrowUp', control: true })), true);
  assert.equal(matchesCombo('broken', key({ control: true })), false);
});

test('formatCombo normalizes pressed keys and skips modifier-only input', () => {
  assert.equal(formatCombo(key({ control: true })), 'Ctrl+B');
  assert.equal(formatCombo(key({ code: 'Space', key: ' ' })), 'Space');
  assert.equal(formatCombo(key({ code: 'ArrowDown', key: 'ArrowDown', control: true, shift: true })), 'Ctrl+Shift+↓');
  assert.equal(formatCombo(key({ code: 'MetaLeft', key: 'Meta', meta: true })), null);
  assert.equal(isModifierKey('ShiftRight'), true);
  assert.equal(isModifierKey('KeyA'), false);
});

test('defaults follow the platform and stored values fall back when invalid', () => {
  assert.equal(defaultKeybinds('linux').miniPlayer, 'Ctrl+KeyP');
  assert.equal(defaultKeybinds('darwin').miniPlayer, 'Meta+KeyP');

  const resolved = resolveKeybinds({ sidebar: 'Alt+KeyS', playPause: 'nonsense', volumeUp: 42 }, 'linux');
  assert.equal(resolved.sidebar, 'Alt+KeyS');
  assert.equal(resolved.playPause, 'Space');
  assert.equal(resolved.volumeUp, 'Ctrl+ArrowUp');
  assert.equal(resolved.miniPlayer, 'Ctrl+KeyP');

  assert.equal(resolveKeybinds(null).sidebar, 'Ctrl+KeyB');
  assert.equal(resolveKeybinds(['nope']).playPause, 'Space');
});

test('comboLabel renders stored combos for the settings panel', () => {
  assert.equal(comboLabel('Ctrl+KeyB'), 'Ctrl+B');
  assert.equal(comboLabel('Space'), 'Space');
  assert.equal(comboLabel('Meta+KeyP'), 'Meta+P');
});

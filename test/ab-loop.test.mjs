import test from 'node:test';
import assert from 'node:assert/strict';
import { abLoopMark, abLoopTarget, seekTarget, normalizeSeekStep, SEEK_STEPS } from '../dist/shared/ab-loop.js';
import { KEYBIND_ACTIONS, PAGE_KEYBIND_ACTIONS, defaultKeybinds } from '../dist/shared/keybinds.js';
import { validateStoreValue } from '../dist/main/ipc/validators.js';

test('A-B button cycles off -> A -> A-B -> off', () => {
  let loop = abLoopMark(null, 12.4, 300);
  assert.deepEqual(loop, { a: 12.4, b: null });
  loop = abLoopMark(loop, 40, 300);
  assert.deepEqual(loop, { a: 12.4, b: 40 });
  loop = abLoopMark(loop, 41, 300);
  assert.deepEqual(loop, { a: null, b: null });
});

test('a B at or before A moves A instead of making an empty loop', () => {
  assert.deepEqual(abLoopMark({ a: 30, b: null }, 10, 300), { a: 10, b: null });
  assert.deepEqual(abLoopMark({ a: 30, b: null }, 30.3, 300), { a: 30.3, b: null });
});

test('marks are clamped to the track', () => {
  assert.deepEqual(abLoopMark(null, -5, 300), { a: 0, b: null });
  assert.deepEqual(abLoopMark(null, 900, 300), { a: 300, b: null });
  assert.deepEqual(abLoopMark(null, NaN, 300), { a: 0, b: null });
  // Unknown duration (live stream, not loaded yet) leaves the mark as is.
  assert.deepEqual(abLoopMark(null, 900, NaN), { a: 900, b: null });
});

test('the loop jumps back to A once the playhead reaches B', () => {
  const loop = { a: 10, b: 20 };
  assert.equal(abLoopTarget(loop, 15), null);
  assert.equal(abLoopTarget(loop, 19.9), 10); // inside the 0.15 s lead
  assert.equal(abLoopTarget(loop, 25), 10);
  assert.equal(abLoopTarget(loop, 19.9, 0), null);
  assert.equal(abLoopTarget({ a: 10, b: null }, 25), null);
  assert.equal(abLoopTarget(null, 25), null);
  assert.equal(abLoopTarget({ a: 10, b: 10.2 }, 11), null);
});

test('seek steps stay inside the track', () => {
  assert.equal(seekTarget(5, -10, 300), 0);
  assert.equal(seekTarget(100, 30, 300), 130);
  assert.equal(seekTarget(295, 30, 300), 299.5);
  assert.equal(seekTarget(100, 30, 0), 130);
  assert.equal(seekTarget(NaN, 10, 300), 10);
});

test('only the offered seek steps are accepted', () => {
  for (const step of SEEK_STEPS) assert.equal(normalizeSeekStep(step), step);
  assert.equal(normalizeSeekStep(7), 10);
  assert.equal(normalizeSeekStep('30'), 10);
  assert.doesNotThrow(() => validateStoreValue('player.seekStep', 30));
  assert.throws(() => validateStoreValue('player.seekStep', 7));
  assert.throws(() => validateStoreValue('player.seekStep', '10'));
});

test('the page copies (Function.toString) work on their own', () => {
  // player-tools.ts embeds these functions into the page by source text.
  const src = [abLoopMark, abLoopTarget, seekTarget, normalizeSeekStep].map(String).join('\n');
  const page = new Function(`${src}; return { abLoopMark, abLoopTarget, seekTarget, normalizeSeekStep };`)();
  assert.deepEqual(page.abLoopMark(page.abLoopMark(null, 3, 60), 9, 60), { a: 3, b: 9 });
  assert.equal(page.abLoopTarget({ a: 3, b: 9 }, 9), 3);
  assert.equal(page.seekTarget(50, 30, 60), 59.5);
  assert.equal(page.normalizeSeekStep(5), 5);
});

test('seek and loop hotkeys are bindable page actions with free defaults', () => {
  for (const action of PAGE_KEYBIND_ACTIONS) assert.ok(KEYBIND_ACTIONS.includes(action));
  const defaults = defaultKeybinds('linux');
  assert.equal(defaults.seekBack, 'Alt+KeyJ');
  assert.equal(defaults.seekForward, 'Alt+KeyL');
  assert.equal(defaults.loopAB, 'Alt+KeyK');
  assert.doesNotThrow(() => validateStoreValue('settings.keybinds', { loopAB: 'Ctrl+Shift+KeyL' }));
});

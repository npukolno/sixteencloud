import test from 'node:test';
import assert from 'node:assert/strict';
import { TaskbarController, toSnapshot } from '../dist/main/taskbar-controller.js';

const icons = { prev: 'PREV', play: 'PLAY', pause: 'PAUSE', next: 'NEXT' };
const label = key => key.split('.')[1];

function fakeWindow({ refuse = false } = {}) {
  return {
    destroyed: false,
    thumbar: [],
    progress: [],
    refuse,
    isDestroyed() { return this.destroyed; },
    setThumbarButtons(buttons) { this.thumbar.push(buttons); return !this.refuse; },
    setProgressBar(value, options) { this.progress.push([value, options && options.mode]); },
  };
}

function setup(opts) {
  let clock = 1000;
  const win = fakeWindow(opts);
  const calls = [];
  const actions = {
    previous: () => calls.push('previous'),
    playPause: () => calls.push('playPause'),
    next: () => calls.push('next'),
  };
  const ctl = new TaskbarController(win, icons, actions, label, () => clock);
  return { win, ctl, calls, advance: ms => { clock += ms; } };
}

const playing = { hasTrack: true, isPlaying: true, currentTime: 30, duration: 120 };

test('toSnapshot sanitises page payloads', () => {
  assert.deepEqual(toSnapshot(null), { hasTrack: false, isPlaying: false, currentTime: 0, duration: 0 });
  assert.deepEqual(
    toSnapshot({ title: ' Song ', isPlaying: true, currentTime: 500, duration: 200 }),
    { hasTrack: true, isPlaying: true, currentTime: 200, duration: 200 },
  );
  assert.deepEqual(
    toSnapshot({ title: 'x', isPlaying: 'yes', currentTime: NaN, duration: -5 }),
    { hasTrack: true, isPlaying: false, currentTime: 0, duration: 0 },
  );
});

test('buttons start disabled and always come as three in a fixed order', () => {
  const { win, ctl } = setup();
  ctl.refreshButtons();
  const buttons = win.thumbar.at(-1);
  assert.equal(buttons.length, 3);
  assert.deepEqual(buttons.map(b => b.icon), ['PREV', 'PLAY', 'NEXT']);
  assert.ok(buttons.every(b => b.flags.includes('disabled')));
  assert.deepEqual(win.progress.at(-1) ?? [-1, 'none'], [-1, 'none']);
});

test('playing track: pause icon, enabled buttons, normal progress', () => {
  const { win, ctl } = setup();
  ctl.update(playing);
  const buttons = win.thumbar.at(-1);
  assert.deepEqual(buttons.map(b => b.icon), ['PREV', 'PAUSE', 'NEXT']);
  assert.equal(buttons[1].tooltip, 'pause');
  assert.ok(buttons.every(b => b.flags.length === 0));
  assert.deepEqual(win.progress.at(-1), [0.25, 'normal']);
});

test('progress moves on between page updates and stops at the end', () => {
  const { win, ctl, advance } = setup();
  ctl.update(playing);
  advance(12000);
  ctl.tick();
  assert.deepEqual(win.progress.at(-1), [0.35, 'normal']);
  advance(10 * 60 * 1000);
  ctl.tick();
  assert.deepEqual(win.progress.at(-1), [1, 'normal']);
});

test('paused track: play icon, frozen paused progress', () => {
  const { win, ctl, advance } = setup();
  ctl.update({ ...playing, isPlaying: false });
  assert.equal(win.thumbar.at(-1)[1].icon, 'PLAY');
  assert.deepEqual(win.progress.at(-1), [0.25, 'paused']);
  const count = win.progress.length;
  advance(5000);
  ctl.tick();
  assert.equal(win.progress.length, count, 'no redundant progress calls while paused');
});

test('unchanged state does not re-send the toolbar; refresh forces it', () => {
  const { win, ctl } = setup();
  ctl.update(playing);
  const sent = win.thumbar.length;
  ctl.update({ ...playing, currentTime: 31 });
  assert.equal(win.thumbar.length, sent);
  ctl.refreshButtons();
  assert.equal(win.thumbar.length, sent + 1);
});

test('clicks call the page actions; play-pause flips the icon at once', () => {
  const { win, ctl, calls } = setup();
  ctl.update(playing);
  const [prev, toggle, next] = win.thumbar.at(-1);
  prev.click();
  next.click();
  toggle.click();
  assert.deepEqual(calls, ['previous', 'next', 'playPause']);
  assert.equal(win.thumbar.at(-1)[1].icon, 'PLAY');
  assert.equal(win.progress.at(-1)[1], 'paused');
});

test('track without duration or no track clears the progress', () => {
  const { win, ctl } = setup();
  ctl.update(playing);
  ctl.update({ ...playing, duration: 0 });
  assert.deepEqual(win.progress.at(-1), [-1, 'none']);
  ctl.update({ hasTrack: false, isPlaying: false, currentTime: 0, duration: 0 });
  assert.deepEqual(win.progress.at(-1), [-1, 'none']);
});

test('a refused toolbar is retried on the next update', () => {
  const { win, ctl } = setup({ refuse: true });
  ctl.update(playing);
  const tries = win.thumbar.length;
  ctl.update({ ...playing, currentTime: 31 });
  assert.equal(win.thumbar.length, tries + 1);
});

test('missing icons: no toolbar calls, progress still works', () => {
  const win = fakeWindow();
  const ctl = new TaskbarController(win, null, { previous() {}, playPause() {}, next() {} }, label, () => 0);
  ctl.update(playing);
  ctl.refreshButtons();
  assert.equal(win.thumbar.length, 0);
  assert.deepEqual(win.progress.at(-1), [0.25, 'normal']);
});

test('destroyed window is left alone', () => {
  const { win, ctl } = setup();
  win.destroyed = true;
  ctl.update(playing);
  ctl.tick();
  assert.equal(win.thumbar.length, 0);
  assert.equal(win.progress.length, 0);
});

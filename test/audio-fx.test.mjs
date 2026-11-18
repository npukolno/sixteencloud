import test from 'node:test';
import assert from 'node:assert/strict';
import { audioFxParams, isAudioFxState, AUDIO_FX_DEFAULT } from '../dist/shared/audio-fx.js';
import { validateStoreValue, STORE_KEYS } from '../dist/main/ipc/validators.js';

// ---- A minimal Web Audio stand-in: nodes record their outgoing edges. ----
class FakeParam {
  constructor(value) { this.value = value; }
  setTargetAtTime(value) { this.value = value; }
  cancelScheduledValues() {}
}
class AudioNode {
  constructor(ctx) { this.context = ctx; this.edges = new Set(); }
  connect(dest) { this.edges.add(dest); return dest; }
  disconnect(dest) {
    if (dest === undefined) { this.edges.clear(); return; }
    if (!this.edges.has(dest)) throw new Error('InvalidAccessError: not connected');
    this.edges.delete(dest);
  }
}
class AudioDestinationNode extends AudioNode {}
class GainNode extends AudioNode { constructor(ctx) { super(ctx); this.gain = new FakeParam(1); } }
class CompressorNode extends AudioNode {
  constructor(ctx) {
    super(ctx);
    for (const k of ['threshold', 'knee', 'ratio', 'attack', 'release']) this[k] = new FakeParam(0);
    this.reduction = -2.5;
  }
}
class AudioContext {
  constructor() { this.destination = new AudioDestinationNode(this); this.state = 'running'; this.currentTime = 0; }
  createGain() { return new GainNode(this); }
  createDynamicsCompressor() { return new CompressorNode(this); }
  createAnalyser() { return new AudioNode(this); }
  createMediaElementSource() { return new AudioNode(this); }
  createMediaStreamSource() { return new AudioNode(this); }
}
class HTMLMediaElement { play() { return Promise.resolve(); } }

globalThis.window = globalThis;
globalThis.AudioContext = AudioContext;
globalThis.AudioNode = AudioNode;
globalThis.AudioDestinationNode = AudioDestinationNode;
globalThis.HTMLMediaElement = HTMLMediaElement;
globalThis.document = { addEventListener() {}, createElement() { return {}; } };
globalThis.location = { origin: 'https://soundcloud.com', href: 'https://soundcloud.com/' };

const { installAudioHook } = await import('../dist/preload/audio-hook.js');
installAudioHook();

test('connections to the destination go through one bus per context', () => {
  const ctx = new window.AudioContext();
  const trackA = ctx.createGain();
  trackA.connect(ctx.destination);
  const bus = ctx.__scBus;
  assert.ok(bus, 'bus created on first use');
  assert.ok(trackA.edges.has(bus.input));
  assert.equal(trackA.edges.has(ctx.destination), false);
  assert.ok(bus.dry.edges.has(ctx.destination));
  assert.ok(bus.wet.edges.has(ctx.destination));
  assert.ok(bus.input.edges.has(bus.comp));

  // SoundCloud's next track builds a fresh chain: it lands in the same bus.
  const trackB = ctx.createGain();
  trackB.connect(ctx.destination);
  assert.ok(trackB.edges.has(bus.input));
  assert.equal(ctx.__scBus, bus);

  // Disconnecting from the destination works as before.
  trackA.disconnect(ctx.destination);
  assert.equal(trackA.edges.size, 0);
  // Other connections are untouched.
  const analyser = ctx.createAnalyser();
  trackB.connect(analyser);
  assert.ok(trackB.edges.has(analyser));
});

test('the bus is transparent until settings arrive, then follows them', () => {
  const ctx = new window.AudioContext();
  ctx.createGain().connect(ctx.destination);
  const bus = ctx.__scBus;
  // Earlier tests may have pushed settings; reset to the default.
  window.__scAudioFx.set(audioFxParams(AUDIO_FX_DEFAULT));
  assert.equal(bus.input.gain.value, 1);
  assert.equal(bus.dry.gain.value, 1);
  assert.equal(bus.wet.gain.value, 0);

  window.__scAudioFx.set(audioFxParams({ preamp: 6, mode: 'limiter' }));
  assert.ok(Math.abs(bus.input.gain.value - 1.995) < 0.01);
  assert.equal(bus.dry.gain.value, 0);
  assert.equal(bus.wet.gain.value, 1);
  assert.equal(bus.comp.threshold.value, -1.5);
  assert.equal(bus.comp.ratio.value, 20);

  // Garbage is ignored rather than half-applied.
  window.__scAudioFx.set({ gain: 'loud' });
  assert.equal(bus.comp.ratio.value, 20);
  const st = window.__scAudioFx.status();
  assert.ok(st.buses >= 1);
  assert.equal(st.reduction, -2.5);
});

test('a context marked __scNoBus (visualizer tap) is left alone', () => {
  const ctx = new window.AudioContext();
  ctx.__scNoBus = true;
  const node = ctx.createGain();
  node.connect(ctx.destination);
  assert.ok(node.edges.has(ctx.destination));
  assert.equal(ctx.__scBus, undefined);
});

test('stored state maps to bus parameters', () => {
  assert.deepEqual(
    { gain: audioFxParams(AUDIO_FX_DEFAULT).gain, dry: audioFxParams(AUDIO_FX_DEFAULT).dry, wet: audioFxParams(AUDIO_FX_DEFAULT).wet },
    { gain: 1, dry: 1, wet: 0 },
  );
  assert.ok(Math.abs(audioFxParams({ preamp: -6, mode: 'off' }).gain - 0.501) < 0.001);
  assert.equal(audioFxParams({ preamp: 40, mode: 'off' }).gain, audioFxParams({ preamp: 12, mode: 'off' }).gain);
  assert.equal(audioFxParams({ preamp: 0, mode: 'normalize' }).wet, 1);
  assert.equal(audioFxParams(null).dry, 1);
  assert.equal(audioFxParams({ preamp: NaN, mode: 'weird' }).gain, 1);
});

test('audioFx is a validated store key', () => {
  assert.ok(STORE_KEYS.has('audioFx'));
  assert.equal(isAudioFxState({ preamp: 3, mode: 'limiter' }), true);
  assert.doesNotThrow(() => validateStoreValue('audioFx', { preamp: -12, mode: 'normalize' }));
  assert.throws(() => validateStoreValue('audioFx', { preamp: 13, mode: 'off' }));
  assert.throws(() => validateStoreValue('audioFx', { preamp: 0, mode: 'boost' }));
  assert.throws(() => validateStoreValue('audioFx', { preamp: 0, mode: 'off', extra: 1 }));
  assert.throws(() => validateStoreValue('audioFx', [0, 'off']));
});

test('the page copy of audioFxParams works on its own', () => {
  const page = new Function(`${String(audioFxParams)}; return audioFxParams;`)();
  assert.deepEqual(page({ preamp: 3, mode: 'normalize' }), audioFxParams({ preamp: 3, mode: 'normalize' }));
});

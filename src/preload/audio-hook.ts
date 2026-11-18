// Audio hook — устанавливается из preload в main world ДО скриптов страницы
// через contextBridge.executeInMainWorld. Функция должна быть полностью
// самодостаточной: она сериализуется и выполняется уже в мире страницы.
//
// Задача: отдать окну __scAudioContext / __scAudioSource / __scAudioAnalyser,
// на которых висят эквалайзер (source → filters → analyser → destination)
// и визуализатор (analyser.getByteFrequencyData).
//
// Стратегия:
// 1. Перехватываем конструктор AudioContext — ловим контекст, созданный SoundCloud.
// 2. Перехватываем createMediaElementSource на прототипе — ловим их source.
// 3. Если SoundCloud вообще не использует Web Audio, при первом play создаём
//    свой контекст и привязываем <audio> сами — но только когда это не убьёт
//    звук (crossOrigin=anonymous или same-origin; иначе CORS-tainted source = тишина).
//
// Analyser подключается как tap: source → analyser → gain(0) → destination.
// Немой gain держит analyser обрабатываемым и не дублирует звук.
//
// Master bus (window.__scAudioFx): every connection to a destination goes
// through preamp -> limiter, so it survives SoundCloud's per-track rebuild.

export function installAudioHook(): void {
  'use strict';
  const w = window as any;
  if (w.__scAudioHookInstalled) return;
  w.__scAudioHookInstalled = true;

  const OrigAudioContext: any = w.AudioContext || w.webkitAudioContext;
  if (!OrigAudioContext || !OrigAudioContext.prototype) return;

  const proto = OrigAudioContext.prototype;
  const origCreateMediaElementSource = proto.createMediaElementSource;
  if (typeof origCreateMediaElementSource !== 'function') return;

  // ---- Master bus: preamp -> (dry | limiter) -> destination -----------------
  // SoundCloud rebuilds its graph for every track, so a node inserted once
  // is gone with the next source. Instead, every connection to a context's
  // destination is redirected into one bus per context, created on first
  // use; whatever SoundCloud builds next lands in the same bus. Until the EQ
  // panel pushes settings the bus is transparent (unity gain, dry path only).
  const NodeProto: any = w.AudioNode && w.AudioNode.prototype;
  const DestinationNode: any = w.AudioDestinationNode;
  const origConnect = NodeProto && NodeProto.connect;
  const origDisconnect = NodeProto && NodeProto.disconnect;
  const buses: any[] = [];
  let fxParams: any = { gain: 1, dry: 1, wet: 0, threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 };

  function applyBus(bus: any, smooth: boolean): void {
    try {
      const t = bus.ctx.currentTime;
      const set = (param: any, value: number) => {
        if (!param || !Number.isFinite(value)) return;
        if (smooth && typeof param.setTargetAtTime === 'function') {
          param.cancelScheduledValues(t);
          param.setTargetAtTime(value, t, 0.03);
        } else {
          param.value = value;
        }
      };
      set(bus.input.gain, fxParams.gain);
      set(bus.dry.gain, fxParams.dry);
      set(bus.wet.gain, fxParams.wet);
      bus.comp.threshold.value = fxParams.threshold;
      bus.comp.knee.value = fxParams.knee;
      bus.comp.ratio.value = fxParams.ratio;
      bus.comp.attack.value = fxParams.attack;
      bus.comp.release.value = fxParams.release;
    } catch (e) { /* noop */ }
  }

  function busFor(ctx: any): any {
    if (!ctx || ctx.__scNoBus || !origConnect) return null;
    if (ctx.__scBus) return ctx.__scBus;
    try {
      const input = ctx.createGain();
      const dry = ctx.createGain();
      const wet = ctx.createGain();
      const comp = ctx.createDynamicsCompressor();
      origConnect.call(input, dry);
      origConnect.call(input, comp);
      origConnect.call(comp, wet);
      origConnect.call(dry, ctx.destination);
      origConnect.call(wet, ctx.destination);
      const bus = { ctx, input, dry, wet, comp };
      [input, dry, wet, comp].forEach((n: any) => { n.__scBusNode = true; });
      ctx.__scBus = bus;
      // Forget buses of closed contexts so they can be collected.
      for (let i = buses.length - 1; i >= 0; i--) if (buses[i].ctx.state === 'closed') buses.splice(i, 1);
      buses.push(bus);
      applyBus(bus, false);
      return bus;
    } catch (e) {
      ctx.__scNoBus = true; // never retry a context that refused
      return null;
    }
  }

  function isDestination(node: any): boolean {
    return !!node && (DestinationNode ? node instanceof DestinationNode : node === (node.context && node.context.destination));
  }

  if (origConnect && origDisconnect) {
    NodeProto.connect = function (this: any, dest: any) {
      if (!this.__scBusNode && isDestination(dest)) {
        const bus = busFor(dest.context);
        if (bus) {
          const args = Array.prototype.slice.call(arguments);
          args[0] = bus.input;
          origConnect.apply(this, args);
          // Native connect() returns the node passed in; chained calls rely on it.
          return dest;
        }
      }
      return origConnect.apply(this, arguments as any);
    };
    NodeProto.disconnect = function (this: any, dest: any) {
      if (!this.__scBusNode && isDestination(dest) && dest.context && dest.context.__scBus) {
        const args = Array.prototype.slice.call(arguments);
        args[0] = dest.context.__scBus.input;
        try { return origDisconnect.apply(this, args); } catch (e) { /* fall through */ }
      }
      return origDisconnect.apply(this, arguments as any);
    };
  }

  w.__scAudioFx = {
    /** Push new bus settings (numbers from shared/audio-fx.ts audioFxParams). */
    set(params: any): void {
      if (!params || typeof params !== 'object') return;
      const next: any = {};
      for (const k of ['gain', 'dry', 'wet', 'threshold', 'knee', 'ratio', 'attack', 'release']) {
        const v = Number(params[k]);
        if (!Number.isFinite(v)) return;
        next[k] = v;
      }
      next.gain = Math.max(0, Math.min(4, next.gain));
      fxParams = next;
      buses.forEach((bus) => applyBus(bus, true));
    },
    status(): { buses: number; reduction: number } {
      const live = buses.filter((b) => b.ctx.state !== 'closed');
      const last = live[live.length - 1];
      return { buses: live.length, reduction: last ? Number(last.comp.reduction) || 0 : 0 };
    },
  };

  // SoundCloud owns the Web Audio graph, and its media element is created
  // before any tap we can reach: the first track therefore reads digital
  // silence out of __scAudioAnalyser (only the next source recreation taps
  // it). captureStream() on the element is graph-independent — it mirrors
  // whatever the element is playing, CORS or not — so the visualizer gets a
  // dedicated analyser that is live from the very first play.
  function attachVisualizerTap(el: any): void {
    if (!el || w.__scVizAnalyser || typeof el.captureStream !== 'function') return;
    try {
      const stream = el.captureStream();
      if (!stream || !stream.getAudioTracks || !stream.getAudioTracks().length) return;
      const ctx = new OrigAudioContext();
      ctx.__scNoBus = true; // silent analysis context, never audible
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function () { /* noop */ });
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.72;
      source.connect(analyser);
      const silent = ctx.createGain();
      silent.gain.value = 0;
      analyser.connect(silent);
      silent.connect(ctx.destination);
      w.__scVizContext = ctx;
      w.__scVizAnalyser = analyser;
    } catch (e) { /* noop */ }
  }

  function getAnalyser(ctx: any): any {
    if (w.__scAudioAnalyser) return w.__scAudioAnalyser;
    try {
      const a = ctx.createAnalyser();
      a.fftSize = 256;
      a.smoothingTimeConstant = 0.72;
      w.__scAudioAnalyser = a;
    } catch (e) { /* noop */ }
    return w.__scAudioAnalyser;
  }

  function keepAnalyserProcessed(ctx: any, analyser: any): void {
    if (!analyser || w.__scAnalyserSink) return;
    try {
      const silent = ctx.createGain();
      silent.gain.value = 0;
      analyser.connect(silent);
      silent.connect(ctx.destination);
      w.__scAnalyserSink = silent;
    } catch (e) { /* noop */ }
  }

  function registerSource(ctx: any, source: any): void {
    w.__scAudioContext = ctx;
    const analyser = getAnalyser(ctx);
    if (analyser && source) {
      try { source.connect(analyser); } catch (e) { /* noop */ }
      keepAnalyserProcessed(ctx, analyser);
    }
    w.__scAudioSource = source;
  }

  // Все контексты, созданные после хука, проходят через обёртку.
  proto.createMediaElementSource = function (el: any): any {
    const source = origCreateMediaElementSource.call(this, el);
    w.__scAudioElement = el;
    attachVisualizerTap(el);
    registerSource(this, source);
    return source;
  };

  // The element itself is never in the DOM (SoundCloud keeps a detached
  // <audio>), so play() is the only reliable handle on it.
  const origPlay = HTMLMediaElement.prototype.play;
  if (typeof origPlay === 'function') {
    HTMLMediaElement.prototype.play = function (this: any) {
      try {
        w.__scAudioElement = this;
        attachVisualizerTap(this);
      } catch (e) { /* noop */ }
      return origPlay.apply(this, arguments as any);
    };
  }

  function WrappedAudioContext(this: any): any {
    const ctx = arguments.length > 0
      ? new OrigAudioContext(arguments[0])
      : new OrigAudioContext();
    w.__scAudioContext = ctx;
    return ctx;
  }
  WrappedAudioContext.prototype = proto;

  if (w.AudioContext) w.AudioContext = WrappedAudioContext;
  if (w.webkitAudioContext) w.webkitAudioContext = WrappedAudioContext;

  // Fallback: SoundCloud играет через <audio> без Web Audio.
  function isSafeToBind(el: any): boolean {
    try {
      if (el.crossOrigin === 'anonymous') return true;
      const src = el.currentSrc || el.src || '';
      if (!src) return false;
      const a = document.createElement('a');
      a.href = src;
      return a.origin === window.location.origin;
    } catch (e) { return false; }
  }

  function maybeBindAudio(el: any): void {
    if (!el || el.__scAudioBound) return;
    if (w.__scAudioSource) return; // SoundCloud уже владеет графом
    if (!isSafeToBind(el)) return; // CORS: привязка сделала бы тишину
    let ctx = w.__scAudioContext;
    if (!ctx) {
      try { ctx = new OrigAudioContext(); w.__scAudioContext = ctx; } catch (e) { return; }
    }
    try {
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') {
        ctx.resume().catch(function () { /* noop */ });
      }
      const source = origCreateMediaElementSource.call(ctx, el);
      // Никто не маршрутизирует этот элемент — значит звук пойдёт через нас.
      try { source.connect(ctx.destination); } catch (e) { /* noop */ }
      registerSource(ctx, source);
      el.__scAudioBound = true;
    } catch (e) { /* noop */ }
  }

  document.addEventListener('play', function (e: Event) {
    const el = e.target as any;
    if (el && el.tagName === 'AUDIO') maybeBindAudio(el);
  }, true);
}

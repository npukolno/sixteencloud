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
      if (ctx.state === 'suspended' && typeof ctx.resume === 'function') ctx.resume().catch(function () { /* noop */ });
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.78;
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
      a.smoothingTimeConstant = 0.8;
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

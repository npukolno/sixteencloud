// Mini-player page script. Bundled by scripts/build-renderer.mjs into
// dist/renderer/mini-player/mini-player.js (IIFE, no imports at runtime).
import type { SixteenCloudMiniAPI } from '../../preload/mini-preload';
import { MINI_ICON_BODY } from '../../shared/icons';
import { isSafeCssColor, MINI_THEME_TOKENS, type MiniAction, type MiniPlayerState } from '../../shared/mini-player';

declare global {
  interface Window { sixteenCloudMini: SixteenCloudMiniAPI }
}

const api = window.sixteenCloudMini;

const svg = (body: string): string => `<svg viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const SPK_ON = MINI_ICON_BODY.speaker + MINI_ICON_BODY.waves;
const SPK_OFF = MINI_ICON_BODY.speaker + MINI_ICON_BODY.muted;
const ICON_PLAY = svg(MINI_ICON_BODY.play);
const ICON_PAUSE = svg(MINI_ICON_BODY.pause);

// Static buttons carry <svg data-icon="name">; the shapes live in shared/icons.
document.querySelectorAll<SVGElement>('svg[data-icon]').forEach((el) => {
  const body = MINI_ICON_BODY[el.getAttribute('data-icon') as keyof typeof MINI_ICON_BODY];
  if (body) el.innerHTML = body;
});

const DEFAULT_STRINGS: Record<string, string> = {
  'mini.title': 'Mini player', 'mini.nothing_playing': 'Nothing playing', 'mini.start_hint': 'Start a track in SixteenCloud',
  'mini.close': 'Close', 'mini.hide': 'Hide', 'mini.open_app': 'Open SixteenCloud', 'mini.open_track': 'Open track page',
  'mini.prev': 'Previous track', 'mini.next': 'Next track', 'mini.play': 'Play', 'mini.pause': 'Pause',
  'mini.play_pause': 'Play or pause', 'mini.mute': 'Mute', 'mini.unmute': 'Unmute', 'mini.sound': 'Sound',
  'mini.volume': 'Volume', 'mini.like': 'Like', 'mini.unlike': 'Unlike', 'mini.lyrics': 'Lyrics',
};
let strings = DEFAULT_STRINGS;
const tr = (key: string): string => strings[key] || DEFAULT_STRINGS[key] || key;

function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`mini-player: #${id} missing`);
  return el as T;
}

const els = {
  card: $('card'), bgArt: $('bgArt'), headerTitle: $('headerTitle'),
  btnClose: $('btnClose'), btnHide: $('btnHide'), btnOpen: $('btnOpen'),
  art: $('art'), ph: $('ph'), artImg: $<HTMLImageElement>('artImg'),
  title: $('title'), artist: $('artist'),
  prev: $('prev'), play: $('play'), next: $('next'), like: $('like'), lyrics: $('lyrics'),
  tcur: $('tcur'), tdur: $('tdur'), prog: $('prog'), fill: $('fill'),
  mute: $('mute'), muteIcon: $('muteIcon'), vol: $<HTMLInputElement>('vol'),
};

let state: MiniPlayerState | null = null;
let duration = 0;
let displayPos = 0;
let lastTick = 0;
let dragging = false;
let dragFrac = 0;
let volDragging = false;
let pendingSeekUntil = 0;
let pendingVolumeUntil = 0;
let pendingPlayUntil = 0;
let pendingLikeUntil = 0;
let lastVolume = 1;
let appliedTheme = '';
let appliedStrings = '';
const lastSent: Partial<Record<MiniAction, number>> = {};

function send(action: MiniAction, value?: number | string, force = false): void {
  const now = Date.now();
  const gap = action === 'volume' ? 70 : action === 'seek' ? 90 : 160;
  const last = lastSent[action];
  if (!force && last && now - last < gap) return;
  lastSent[action] = now;
  api.sendAction(action, value);
}

function fmt(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) seconds = 0;
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return m + ':' + (s < 10 ? '0' : '') + s;
}

function artUrl(url: string | undefined, size: 't200x200' | 't500x500' = 't200x200'): string {
  if (!url) return '';
  return String(url)
    .replace(/-t\d+x\d+\./, `-${size}.`)
    .replace(/-(?:mini|small|tiny|badge|original|large)\./, `-${size}.`);
}

function label(el: HTMLElement, text: string): void {
  el.title = text;
  el.setAttribute('aria-label', text);
}

function applyStrings(next: Record<string, string> | undefined): void {
  if (!next) return;
  const key = JSON.stringify(next);
  if (key === appliedStrings) return;
  appliedStrings = key;
  strings = { ...DEFAULT_STRINGS, ...next };
  document.title = tr('mini.title');
  els.headerTitle.textContent = tr('mini.title');
  label(els.btnClose, tr('mini.close'));
  label(els.btnHide, tr('mini.hide'));
  label(els.btnOpen, tr('mini.open_app'));
  els.art.setAttribute('aria-label', tr('mini.open_track'));
  label(els.prev, tr('mini.prev'));
  label(els.next, tr('mini.next'));
  label(els.lyrics, tr('mini.lyrics'));
  label(els.mute, tr('mini.sound'));
  els.vol.setAttribute('aria-label', tr('mini.volume'));
  paintPlay(!!state?.isPlaying);
  paintLike(!!state?.isLiked);
  paintMute(state?.volume ?? 1);
  paintText();
}

function applyTheme(theme: MiniPlayerState['theme']): void {
  if (!theme) return;
  const key = JSON.stringify(theme);
  if (key === appliedTheme) return;
  appliedTheme = key;
  const root = document.documentElement.style;
  for (const token of MINI_THEME_TOKENS) {
    const value = theme[token];
    if (isSafeCssColor(value)) root.setProperty(token, value.trim());
    else root.removeProperty(token);
  }
}

function paintText(): void {
  els.title.textContent = state?.title || tr('mini.nothing_playing');
  els.title.title = state?.title || '';
  els.artist.textContent = state?.artist || (state?.title ? '' : tr('mini.start_hint'));
}

function paintMute(volume: number): void {
  const muted = volume <= 0.001;
  els.muteIcon.innerHTML = muted ? SPK_OFF : SPK_ON;
  els.mute.title = muted ? tr('mini.unmute') : tr('mini.mute');
}

function paintProgress(position: number, total: number): void {
  const pct = total > 0 ? Math.max(0, Math.min(100, (position / total) * 100)) : 0;
  els.fill.style.width = pct + '%';
  els.tcur.textContent = fmt(position);
  els.tdur.textContent = fmt(total);
}

function paintBars(): void {
  paintProgress(dragging ? dragFrac * duration : displayPos, duration);
}

function paintPlay(isPlaying: boolean): void {
  els.play.innerHTML = isPlaying ? ICON_PAUSE : ICON_PLAY;
  els.play.title = isPlaying ? tr('mini.pause') : tr('mini.play');
  els.play.setAttribute('aria-label', tr('mini.play_pause'));
}

function paintLike(isLiked: boolean): void {
  els.like.classList.toggle('on', isLiked);
  els.like.setAttribute('aria-pressed', String(isLiked));
  label(els.like, isLiked ? tr('mini.unlike') : tr('mini.like'));
}

function paintArtwork(url: string | undefined): void {
  const small = artUrl(url);
  if (small) {
    if (els.artImg.getAttribute('data-src') !== small) {
      els.artImg.setAttribute('data-src', small);
      els.artImg.src = small;
      // The blurred tint uses the same cached 200px image: no extra download.
      els.bgArt.style.backgroundImage = `url("${small.replace(/["\\]/g, '')}")`;
    }
    els.artImg.style.display = 'block';
    els.ph.style.display = 'none';
    els.card.classList.add('has-art');
  } else {
    els.artImg.style.display = 'none';
    els.ph.style.display = 'flex';
    els.card.classList.remove('has-art');
  }
}

api.onUpdate((info) => {
  if (!info) return;
  applyStrings(info.strings);
  applyTheme(info.theme);
  const previousTitle = state ? state.title : '';
  const previousDuration = duration;
  const now = performance.now();
  const trackChanged = info.title !== previousTitle || Math.abs((info.duration || 0) - previousDuration) > 0.5;

  state = info;
  duration = info.duration || 0;
  paintText();
  if (now >= pendingPlayUntil) paintPlay(!!info.isPlaying);
  if (now >= pendingLikeUntil) paintLike(!!info.isLiked);
  paintArtwork(info.artworkUrl);

  const volume = info.volume == null ? 1 : info.volume;
  if (volume > 0.01) lastVolume = volume;
  if (now >= pendingVolumeUntil) {
    if (!volDragging) els.vol.value = String(Math.round(volume * 100));
    paintMute(volume);
  }

  if (!dragging && now >= pendingSeekUntil) {
    const server = info.position || 0;
    if (trackChanged || !info.isPlaying || Math.abs(server - displayPos) > 1.5) displayPos = server;
  }
  if (trackChanged) {
    displayPos = info.position || 0;
    pendingSeekUntil = 0;
  }
  lastTick = now;
  paintBars();
});

function frame(timestamp: number): void {
  if (!dragging && state && state.isPlaying) {
    if (!lastTick) lastTick = timestamp;
    const dt = (timestamp - lastTick) / 1000;
    if (dt > 0 && dt < 2) displayPos += dt;
    if (duration > 0) displayPos = Math.min(displayPos, duration);
    paintBars();
  }
  lastTick = timestamp;
  requestAnimationFrame(frame);
}

function togglePlayOptimistic(): void {
  if (state) {
    state.isPlaying = !state.isPlaying;
    paintPlay(!!state.isPlaying);
    pendingPlayUntil = performance.now() + 1400;
  }
  send('play-pause', undefined, true);
}

function toggleLikeOptimistic(): void {
  if (!state?.title) return;
  state.isLiked = !state.isLiked;
  paintLike(!!state.isLiked);
  pendingLikeUntil = performance.now() + 1600;
  send('like', undefined, true);
}

function openTrack(): void {
  if (state && state.trackUrl) send('open-track', state.trackUrl, true);
  else send('focus', undefined, true);
}

function setVolumeUi(percent: number, holdMs: number): void {
  els.vol.value = String(percent);
  paintMute(percent / 100);
  pendingVolumeUntil = performance.now() + holdMs;
}

els.prev.addEventListener('click', () => send('prev', undefined, true));
els.play.addEventListener('click', togglePlayOptimistic);
els.next.addEventListener('click', () => send('next', undefined, true));
els.like.addEventListener('click', toggleLikeOptimistic);
els.lyrics.addEventListener('click', () => send('lyrics', undefined, true));
els.mute.addEventListener('click', () => {
  const current = parseInt(els.vol.value, 10) || 0;
  setVolumeUi(current > 0 ? 0 : Math.max(1, Math.round(lastVolume * 100)), 1800);
  send('mute', undefined, true);
});
for (const el of [els.art, els.title, els.artist]) el.addEventListener('click', openTrack);
els.btnClose.addEventListener('click', () => send('close', undefined, true));
els.btnHide.addEventListener('click', () => send('hide', undefined, true));
els.btnOpen.addEventListener('click', () => send('focus', undefined, true));

els.vol.addEventListener('pointerdown', () => { volDragging = true; });
els.vol.addEventListener('input', () => {
  volDragging = true;
  const v = parseInt(els.vol.value, 10);
  pendingVolumeUntil = performance.now() + 600;
  paintMute(v / 100);
  send('volume', v);
});
els.vol.addEventListener('change', () => {
  volDragging = false;
  const v = parseInt(els.vol.value, 10);
  pendingVolumeUntil = performance.now() + 700;
  paintMute(v / 100);
  send('volume', v, true);
});
window.addEventListener('pointerup', () => { volDragging = false; });

function fractionFromEvent(event: PointerEvent): number {
  const rect = els.prog.getBoundingClientRect();
  if (!rect.width) return 0;
  return Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
}
els.prog.addEventListener('pointerdown', (event) => {
  dragging = true;
  els.prog.classList.add('dragging');
  try { els.prog.setPointerCapture(event.pointerId); } catch { /* pointer gone */ }
  dragFrac = fractionFromEvent(event);
  paintBars();
});
els.prog.addEventListener('pointermove', (event) => {
  if (!dragging) return;
  dragFrac = fractionFromEvent(event);
  paintBars();
});
els.prog.addEventListener('pointerup', (event) => {
  if (!dragging) return;
  dragging = false;
  els.prog.classList.remove('dragging');
  const frac = fractionFromEvent(event);
  if (duration > 0) displayPos = frac * duration;
  pendingSeekUntil = performance.now() + 2000;
  paintBars();
  send('seek', frac, true);
});
els.prog.addEventListener('pointercancel', () => {
  dragging = false;
  els.prog.classList.remove('dragging');
  if (state && !state.isPlaying) displayPos = state.position || displayPos;
  paintBars();
});

document.addEventListener('keydown', (event) => {
  const seekBy = (seconds: number) => {
    event.preventDefault();
    displayPos = Math.max(0, duration > 0 ? Math.min(duration, displayPos + seconds) : displayPos + seconds);
    pendingSeekUntil = performance.now() + 2000;
    paintBars();
    send('seek-by', seconds, true);
  };
  switch (event.key) {
    case ' ': event.preventDefault(); togglePlayOptimistic(); break;
    case 'ArrowLeft': seekBy(-5); break;
    case 'ArrowRight': seekBy(5); break;
    case 'ArrowUp':
    case 'ArrowDown': {
      event.preventDefault();
      const step = event.key === 'ArrowUp' ? 5 : -5;
      setVolumeUi(Math.max(0, Math.min(100, parseInt(els.vol.value, 10) + step)), 700);
      send('volume-step', step, true);
      break;
    }
    case 'l': case 'L': toggleLikeOptimistic(); break;
    case 'Escape': send('close', undefined, true); break;
  }
});

paintPlay(false);
paintLike(false);
paintMute(1);
paintText();
requestAnimationFrame(frame);

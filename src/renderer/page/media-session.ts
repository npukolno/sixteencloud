// navigator.mediaSession handlers and metadata for the SoundCloud page, so OS
// media overlays (and Chromium's MPRIS on Linux) show the playing track.
// Bundled to dist/renderer/page/media-session.js and injected by
// src/main/media-session.ts.
import { SC } from '../../shared/sc-selectors';

declare global {
  interface Window { __scMediaSession?: boolean }
}

function click(selector: string): void {
  document.querySelector<HTMLElement>(selector)?.click();
}

function isPlaying(): boolean {
  return !!document.querySelector(SC.PLAY)?.classList.contains('playing');
}

function textOf(el: Element | null): string {
  return el ? (el.getAttribute('title') || el.textContent || '').trim() : '';
}

/** Artwork URL from the badge's inline background-image, upsized to 500px. */
export function artworkFromStyle(style: string): string {
  const m = style.match(/url\("?([^")]+)"?\)/);
  return m ? m[1].replace(/-(?:t\d+x\d+|large|small|badge|crop)\./, '-t500x500.') : '';
}

function install(): void {
  if (window.__scMediaSession || !('mediaSession' in navigator)) return;
  window.__scMediaSession = true;
  const ms = navigator.mediaSession;
  ms.setActionHandler('play', () => { if (!isPlaying()) click(SC.PLAY); });
  ms.setActionHandler('pause', () => { if (isPlaying()) click(SC.PLAY); });
  ms.setActionHandler('stop', () => { if (isPlaying()) click(SC.PLAY); });
  ms.setActionHandler('nexttrack', () => click(SC.NEXT));
  ms.setActionHandler('previoustrack', () => click(SC.PREV));

  let lastTitle = '';
  const update = () => {
    if (document.hidden && lastTitle) return;
    const title = textOf(document.querySelector(SC.TITLE_LINK));
    if (!title || title === lastTitle) return;
    lastTitle = title;
    const artwork = artworkFromStyle(document.querySelector(SC.AVATAR_ART)?.getAttribute('style') || '');
    ms.metadata = new MediaMetadata({
      title,
      artist: textOf(document.querySelector(SC.ARTIST_LINK)),
      album: 'SoundCloud',
      artwork: artwork ? [{ src: artwork, sizes: '500x500', type: 'image/jpeg' }] : [],
    });
  };
  setInterval(update, 2000);
}

install();

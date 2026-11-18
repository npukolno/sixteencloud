// SoundCloud DOM selectors in one place. When SoundCloud changes its markup,
// fix it here. Comma lists are fallbacks: querySelector returns whichever
// matches first in document order, so add the new class next to the old one.

export const SC = {
  /** Play/pause button in the bottom player bar (has `.playing` while playing). */
  PLAY: '.playControl, .playControls__play',
  NEXT: '.skipControl__next, .playControls__next',
  PREV: '.skipControl__previous, .playControls__prev',
  PLAYER_BAR: '.playControls',
  TITLE_LINK: '.playbackSoundBadge__titleLink',
  ARTIST_LINK: '.playbackSoundBadge__lightLink',
  AVATAR: '.playbackSoundBadge__avatar',
  /** Element whose inline style carries the artwork as a background-image. */
  AVATAR_ART: '.playbackSoundBadge__avatar .image__full, .playbackSoundBadge__avatar span[style*="background-image"]',
  TIMELINE_WRAPPER: '.playbackTimeline__progressWrapper',
  TIMELINE_DURATION: '.playbackTimeline__duration span[aria-hidden]',
  MAIN_CONTENT: '.l-main',
  HYDRATION: '#__sc_hydration',
} as const;

export type ScSelector = keyof typeof SC;

/** A selector as a quoted JS string literal, for scripts built as template strings. */
export function scJs(name: ScSelector): string {
  return JSON.stringify(SC[name]);
}

/** Page script: click a player control if it is there. */
export function clickScript(name: ScSelector): string {
  return `document.querySelector(${scJs(name)})?.click();`;
}

/** Page script: pause only if currently playing (MPRIS/media "stop" and "pause"). */
export function pauseScript(): string {
  return `(function(){var pc=document.querySelector(${scJs('PLAY')}); if (pc && pc.classList.contains('playing')) pc.click();})();`;
}

/** Page script: play only if currently paused. */
export function playScript(): string {
  return `(function(){var pc=document.querySelector(${scJs('PLAY')}); if (pc && !pc.classList.contains('playing')) pc.click();})();`;
}

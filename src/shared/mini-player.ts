// Contract between the main process, mini-preload and the mini-player page.

export const MINI_ACTIONS = [
  'prev', 'play-pause', 'next', 'close', 'volume', 'volume-step', 'seek', 'seek-by',
  'mute', 'hide', 'open-track', 'focus', 'like', 'lyrics',
] as const;
export type MiniAction = typeof MINI_ACTIONS[number];

/** Theme tokens mirrored from the main window (CSS custom property → value). */
export const MINI_THEME_TOKENS = [
  '--sc-bg', '--sc-surface', '--sc-surface-raised', '--sc-text', '--sc-text-muted', '--sc-text-subtle',
  '--sc-border', '--sc-accent', '--sc-accent-hover', '--sc-accent-foreground',
] as const;

export const MINI_STRING_KEYS = [
  'mini.title', 'mini.nothing_playing', 'mini.start_hint', 'mini.close', 'mini.hide', 'mini.open_app',
  'mini.open_track', 'mini.prev', 'mini.next', 'mini.play', 'mini.pause', 'mini.play_pause',
  'mini.mute', 'mini.unmute', 'mini.sound', 'mini.volume', 'mini.like', 'mini.unlike', 'mini.lyrics',
] as const;

export interface MiniPlayerState {
  title?: string;
  artist?: string;
  artworkUrl?: string;
  trackUrl?: string;
  isPlaying?: boolean;
  isLiked?: boolean;
  position?: number;
  duration?: number;
  volume?: number;
  theme?: Partial<Record<typeof MINI_THEME_TOKENS[number], string>>;
  strings?: Record<string, string>;
}

/** Only plain colour values reach setProperty in the mini player. */
export function isSafeCssColor(value: unknown): value is string {
  return typeof value === 'string' && value.length <= 64 &&
    /^(#[0-9a-f]{3,8}|rgba?\([\d\s.,%/]+\)|hsla?\([\d\s.,%/deg]+\)|transparent)$/i.test(value.trim());
}

// One drawing language for the rail and the player-bar buttons, so the icons
// read as a single family and sit next to SoundCloud's own rounded glyphs.
//
// Rail icons ("line"): 24x24 grid, content kept inside a 3..21 safe area,
// outlined, round caps and joins, corners never sharper than r=2. Stroke width
// is NOT set here: the CSS sets it once for the whole rail (.sc-nav-icon svg),
// which is what keeps the weights equal. Closed shapes use a plain stroke; dots
// are zero-length round-capped lines.
//
// Bar icons ("solid"): SoundCloud's bar glyphs are heavy and filled, so these
// are bold strokes plus filled parts instead of hairlines.

export type NavIconName =
  | 'player' | 'lyrics' | 'lyricsync' | 'equalizer' | 'downloader' | 'offline' | 'history'
  | 'geo' | 'discord' | 'adblock' | 'key' | 'themes' | 'css' | 'settings';

// Discord's mark, outlined (the filled brand glyph was the one icon that
// looked heavier than every other). Source shape: 32x25 Figma export; the
// first subpath is the outline, the other two are the eyes.
const DISCORD_OUTLINE =
  'M26.8121 2.052C24.7632 1.09338 22.5725 0.396698 20.2821 0C20.0008 0.508553 19.6722 1.19257 19.4456 1.7367C17.0109 1.37055 14.5985 1.37055 12.2086 1.7367C11.982 1.19257 11.646 0.508553 11.3622 0C9.06931 0.396698 6.87603 1.09594 4.82715 2.05708C0.69455 8.30199 -0.425731 14.3918 0.13441 20.3951C2.87537 22.442 5.53169 23.6854 8.14318 24.4991C8.78798 23.6116 9.36304 22.6683 9.85845 21.6741C8.91493 21.3156 8.01124 20.8732 7.15736 20.3595C7.38389 20.1917 7.60547 20.0162 7.81955 19.8357C13.0276 22.2716 18.6863 22.2716 23.8321 19.8357C24.0487 20.0162 24.2703 20.1917 24.4943 20.3595C23.6379 20.8757 22.7318 21.3181 21.7883 21.6767C22.2837 22.6683 22.8563 23.6142 23.5035 24.5016C26.1175 23.6879 28.7763 22.4445 31.5173 20.3951C32.1745 13.4357 30.3945 7.40185 26.8121 2.052Z';
const DISCORD_EYES =
  'M10.568 16.7031C9.00457 16.7031 7.72245 15.2436 7.72245 13.4662C7.72245 11.6889 8.97719 10.2268 10.568 10.2268C12.1588 10.2268 13.4409 11.6863 13.4135 13.4662C13.416 15.2436 12.1588 16.7031 10.568 16.7031ZM21.0837 16.7031C19.5203 16.7031 18.2382 15.2436 18.2382 13.4662C18.2382 11.6889 19.4929 10.2268 21.0837 10.2268C22.6745 10.2268 23.9566 11.6863 23.9292 13.4662C23.9292 15.2436 22.6745 16.7031 21.0837 16.7031Z';

export const NAV_ICON_BODY: Record<NavIconName, string> = {
  // Rounded play button.
  player: '<circle cx="12" cy="12" r="9"/><path d="M10.2 8.6v6.8l5.4-3.4z"/>',
  // Beamed eighth notes.
  lyrics: '<path d="M9 17.5V6.6a1 1 0 0 1 .78-.98l8-1.8A1 1 0 0 1 19 4.8v10.7"/><path d="M9 10.3l10-2.2"/><circle cx="6.5" cy="17.5" r="2.5"/><circle cx="16.5" cy="15.5" r="2.5"/>',
  // Text lines with a small clock: lyrics aligned in time.
  lyricsync: '<path d="M4 6.5h12M4 11h7M4 15.5h4"/><circle cx="16.5" cy="16" r="4.5"/><path d="M16.5 13.7V16l1.6 1.1"/>',
  // Two sliders.
  equalizer: '<path d="M4 8h9M17 8h3M4 16h3M11 16h9"/><circle cx="15" cy="8" r="2"/><circle cx="9" cy="16" r="2"/>',
  // Tray with an arrow.
  downloader: '<path d="M12 4v10m0 0-4-4m4 4 4-4"/><path d="M4.5 15.5v1.8A2.7 2.7 0 0 0 7.2 20h9.6a2.7 2.7 0 0 0 2.7-2.7v-1.8"/>',
  // Cloud with a down arrow.
  offline: '<path d="M7.3 18.5a4.3 4.3 0 0 1-.7-8.55A5.6 5.6 0 0 1 17.4 9a4.8 4.8 0 0 1-.2 9.5z"/><path d="M12 10.8v5.2m0 0-2.2-2.2m2.2 2.2 2.2-2.2"/>',
  // Counter-clockwise clock.
  history: '<path d="M3.8 12a8.2 8.2 0 1 0 2.4-5.8L3.8 8.6"/><path d="M3.8 4.4v4.2h4.2"/><path d="M12 7.8V12l2.9 1.8"/>',
  // Globe.
  geo: '<circle cx="12" cy="12" r="9"/><path d="M3.2 12h17.6"/><path d="M12 3c2.6 2.6 3.9 5.6 3.9 9s-1.3 6.4-3.9 9c-2.6-2.6-3.9-5.6-3.9-9S9.4 5.6 12 3z"/>',
  discord: `<g transform="translate(1.6 3.9) scale(.65)"><path d="${DISCORD_OUTLINE}" stroke-width="2.7"/><path d="${DISCORD_EYES}" fill="currentColor" stroke="none"/></g>`,
  // Shield with a check.
  adblock: '<path d="M12 3.4 5.2 6v5.4c0 4.3 2.8 7.4 6.8 9.2 4-1.8 6.8-4.9 6.8-9.2V6z"/><path d="m9 12.2 2.1 2.1 4-4.2"/>',
  // Key.
  key: '<circle cx="8" cy="16" r="4.6"/><path d="m11.4 12.6 8.6-8.6"/><path d="m16.8 7.2 2.6 2.6"/><path d="m14 10 2 2"/>',
  // Palette.
  themes: '<path d="M12 3.4a8.6 8.6 0 1 0 0 17.2c1.2 0 1.9-.9 1.9-1.8 0-.6-.3-1-.6-1.4-.3-.4-.5-.8-.5-1.3 0-1 .8-1.8 1.8-1.8H17a3.6 3.6 0 0 0 3.6-3.6C20.6 6.7 16.8 3.4 12 3.4z"/><path d="M7.6 11.6h.01M9.6 7.6h.01M14.4 7.4h.01"/>',
  // Code brackets with a slash.
  css: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M13.4 5.6l-2.8 12.8"/>',
  // Gear.
  settings: '<path d="M10.16 5.35L10.47 3.33L13.53 3.33L13.84 5.35A6.9 6.9 0 0 1 15.40 5.99L17.05 4.79L19.21 6.95L18.01 8.60A6.9 6.9 0 0 1 18.65 10.16L20.67 10.47L20.67 13.53L18.65 13.84A6.9 6.9 0 0 1 18.01 15.40L19.21 17.05L17.05 19.21L15.40 18.01A6.9 6.9 0 0 1 13.84 18.65L13.53 20.67L10.47 20.67L10.16 18.65A6.9 6.9 0 0 1 8.60 18.01L6.95 19.21L4.79 17.05L5.99 15.40A6.9 6.9 0 0 1 5.35 13.84L3.33 13.53L3.33 10.47L5.35 10.16A6.9 6.9 0 0 1 5.99 8.60L4.79 6.95L6.95 4.79L8.60 5.99A6.9 6.9 0 0 1 10.16 5.35Z"/><circle cx="12" cy="12" r="2.8"/>',
};

export function navIconSvg(name: NavIconName, extraAttrs = ''): string {
  return `<svg class="sc-akar-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"${extraAttrs}>${NAV_ICON_BODY[name]}</svg>`;
}

// Player-bar buttons: bold and filled, like SoundCloud's own bar icons.
export const BAR_ICON_BODY = {
  // Queue-style list with a solid note.
  lyrics: '<path d="M4.5 6.5h10M4.5 11.5h10M4.5 16.5h5"/><path d="M19 6.2v10.6"/><circle cx="16.6" cy="17" r="2.6" fill="currentColor" stroke="none"/>',
  download: '<path d="M12 4.5v10.2m0 0-4.3-4.3m4.3 4.3 4.3-4.3M5 19.5h14"/>',
  // Solid cloud, the arrow is cut out of it.
  offline: '<path fill="currentColor" fill-rule="evenodd" stroke="none" d="M7.3 19a4.7 4.7 0 0 1-.8-9.33A6.1 6.1 0 0 1 17.6 8.6 5.2 5.2 0 0 1 17.2 19zM10.9 10h2.2v3.2l1.5-1.4 1.5 1.5-4.1 4-4.1-4 1.5-1.5 1.5 1.4z"/>',
} as const;

export function barIconSvg(body: string): string {
  return `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
}

// Mini-player: same family as the bar icons, drawn for 13-22 px. The CSS gives
// every svg stroke currentColor, round caps/joins and fill none; shapes that
// are solid (play, skip, speaker body) say so on the element itself.
export const MINI_ICON_BODY = {
  open: '<path d="M14 5h5v5"/><path d="M19 5l-8 8"/><path d="M18.5 14v3a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h3"/>',
  hide: '<path d="M5.5 12h13"/>',
  close: '<path d="m6.5 6.5 11 11M17.5 6.5l-11 11"/>',
  note: NAV_ICON_BODY.lyrics,
  heart: '<path d="M12 19.8c-.3 0-.6-.1-.8-.3C7.3 16.4 4 13.6 4 10.1 4 7.8 5.8 6 8.1 6c1.5 0 2.9.8 3.9 2 1-1.2 2.4-2 3.9-2C18.2 6 20 7.8 20 10.1c0 3.5-3.3 6.3-7.2 9.4-.2.2-.5.3-.8.3z"/>',
  prev: '<path d="M6 6v12"/><path d="M18 6.4v11.2L9.4 12z" fill="currentColor"/>',
  next: '<path d="M18 6v12"/><path d="M6 6.4v11.2L14.6 12z" fill="currentColor"/>',
  play: '<path d="M8.4 5.8v12.4L18.4 12z" fill="currentColor"/>',
  pause: '<path d="M8.6 6v12M15.4 6v12" stroke-width="3.2"/>',
  lyrics: BAR_ICON_BODY.lyrics,
  speaker: '<path d="M4.8 10.2v3.6h2.7l3.7 3V7.2l-3.7 3z" fill="currentColor"/>',
  waves: '<path d="M14.8 9.4a3.8 3.8 0 0 1 0 5.2"/><path d="M17.6 7a7.2 7.2 0 0 1 0 10"/>',
  muted: '<path d="m15.2 9.6 4.6 4.8m0-4.8-4.6 4.8"/>',
} as const;

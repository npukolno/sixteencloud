// Sidebar bookmarks: one canonical shape, checked in the main process
// (store:set "sidebar.bookmarks", profile import) and embedded into the page
// through Function.toString() (sidebar.ts). Keep cleanBookmark
// self-contained: no imports, no module constants, no calls to other exports.

import type { SidebarBookmark } from './types';

export const MAX_BOOKMARKS = 1000;

/**
 * The bookmark in canonical form, or null when it cannot be kept.
 * Only HTTPS SoundCloud pages and sndcdn.com artwork are accepted; optional
 * fields are dropped when empty, so legacy {name, url, type} entries come
 * back unchanged.
 */
export function cleanBookmark(input: unknown): SidebarBookmark | null {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const b = input as Record<string, unknown>;
  const url = typeof b.url === 'string' ? b.url : '';
  if (!url || url.length > 2048) return null;
  let page: URL;
  try { page = new URL(url); } catch { return null; }
  const host = page.hostname.toLowerCase().replace(/\.$/, '');
  if (page.protocol !== 'https:' || !(host === 'soundcloud.com' || host.endsWith('.soundcloud.com'))) return null;
  if (b.type !== 'track' && b.type !== 'playlist' && b.type !== 'artist') return null;
  const rawName = typeof b.name === 'string' ? b.name.trim().slice(0, 300) : '';
  const out: SidebarBookmark = { name: rawName || page.pathname, url, type: b.type };
  if (typeof b.artwork === 'string' && b.artwork && b.artwork.length <= 1024) {
    try {
      const art = new URL(b.artwork);
      const ah = art.hostname.toLowerCase();
      if (art.protocol === 'https:' && (ah === 'sndcdn.com' || ah.endsWith('.sndcdn.com'))) out.artwork = b.artwork;
    } catch { /* no artwork */ }
  }
  if (b.pinned === true) out.pinned = true;
  if (typeof b.folder === 'string' && b.folder.trim()) out.folder = b.folder.trim().slice(0, 60);
  if (typeof b.time === 'number' && Number.isFinite(b.time) && b.time >= 1 && b.time < 172800) out.time = Math.floor(b.time);
  return out;
}

/** True when the list may be stored as is: every entry already canonical. */
export function isBookmarkList(value: unknown): value is SidebarBookmark[] {
  if (!Array.isArray(value) || value.length > MAX_BOOKMARKS) return false;
  return value.every((entry) => {
    const clean = cleanBookmark(entry);
    if (!clean) return false;
    const a = entry as Record<string, unknown>;
    const keys = Object.keys(a);
    const cleanRecord = clean as unknown as Record<string, unknown>;
    return keys.length === Object.keys(clean).length && keys.every((k) => a[k] === cleanRecord[k]);
  });
}

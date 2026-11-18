// Pure size-limit policy for the offline cache (no electron: unit-tested).

export interface CacheEntry {
  trackId: string;
  cachedAt: string;
  fileSize: number;
}

/**
 * Split entries into the ones to keep and the ones to delete so the total
 * fits in maxBytes. Oldest cachedAt goes first; unparsable dates count as
 * oldest. Kept entries stay in oldest-first order.
 */
export function planEviction<T extends CacheEntry>(entries: readonly T[], maxBytes: number): { keep: T[]; evict: T[] } {
  const time = (e: T) => { const t = Date.parse(e.cachedAt); return Number.isFinite(t) ? t : 0; };
  const keep = [...entries].sort((a, b) => time(a) - time(b));
  const evict: T[] = [];
  let total = keep.reduce((sum, e) => sum + (e.fileSize > 0 ? e.fileSize : 0), 0);
  while (total > maxBytes && keep.length > 0) {
    const oldest = keep.shift()!;
    evict.push(oldest);
    total -= oldest.fileSize > 0 ? oldest.fileSize : 0;
  }
  return { keep, evict };
}

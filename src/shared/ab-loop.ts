// A-B loop and seek-step math, shared by the player page script and the
// tests. The page gets these exact functions through Function.toString()
// (see player-tools.ts), so each one must stay self-contained: no imports,
// no module constants, no calls to the other exports.

export interface AbLoop {
  /** Loop start in seconds, or null. */
  a: number | null;
  /** Loop end in seconds, or null (A set, waiting for B). */
  b: number | null;
}

/** Seek steps offered in the Player panel, in seconds. */
export const SEEK_STEPS = [5, 10, 15, 30] as const;

/**
 * One press of the A-B button: off -> A set -> A-B looping -> off.
 * A B point at or before A (or within half a second of it) moves A instead,
 * so a loop is never empty or inverted.
 */
export function abLoopMark(loop: AbLoop | null, position: number, duration: number): AbLoop {
  const pos = Number.isFinite(position) ? Math.max(0, position) : 0;
  const end = Number.isFinite(duration) && duration > 0 ? duration : Infinity;
  const at = Math.min(pos, end);
  if (!loop || loop.a === null) return { a: at, b: null };
  if (loop.b === null) {
    if (at <= loop.a + 0.5) return { a: at, b: null };
    return { a: loop.a, b: at };
  }
  return { a: null, b: null };
}

/**
 * Where playback should jump to, or null to leave it alone: once the
 * playhead reaches B it goes back to A. A small lead (the poll interval)
 * keeps the jump from overshooting B audibly.
 */
export function abLoopTarget(loop: AbLoop | null, position: number, lead = 0.15): number | null {
  if (!loop || loop.a === null || loop.b === null || !Number.isFinite(position)) return null;
  if (loop.b - loop.a < 0.5) return null;
  return position >= loop.b - Math.max(0, lead) ? loop.a : null;
}

/** Position after seeking by delta seconds, kept inside the track. */
export function seekTarget(position: number, delta: number, duration: number): number {
  const pos = Number.isFinite(position) ? position : 0;
  const d = Number.isFinite(delta) ? delta : 0;
  const max = Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 0.5) : Infinity;
  return Math.max(0, Math.min(max, pos + d));
}

/** A stored seek step, or the 10 s default when it is not one of the offered steps. */
export function normalizeSeekStep(value: unknown): number {
  return value === 5 || value === 10 || value === 15 || value === 30 ? value : 10;
}

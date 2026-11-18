// Preamp + limiter / loudness leveller settings (store key "audioFx") and the
// numbers the master bus in preload/audio-hook.ts is driven with. The EQ
// panel embeds audioFxParams() into the page via Function.toString(), so it
// must stay self-contained (no imports, no module constants, no calls to the
// other exports).

export type AudioFxMode = 'off' | 'limiter' | 'normalize';

export interface AudioFxState {
  /** Gain before the dynamics stage, in dB (-12..+12). */
  preamp: number;
  mode: AudioFxMode;
}

export interface AudioFxParams {
  /** Linear preamp gain. */
  gain: number;
  /** Level of the unprocessed path (1 when the dynamics stage is off). */
  dry: number;
  /** Level of the compressor path. */
  wet: number;
  threshold: number;
  knee: number;
  ratio: number;
  attack: number;
  release: number;
}

export const AUDIO_FX_DEFAULT: AudioFxState = { preamp: 0, mode: 'off' };

/** Bus settings for a stored state; anything malformed falls back to "transparent". */
export function audioFxParams(state: unknown): AudioFxParams {
  const s = (state && typeof state === 'object' ? state : {}) as { preamp?: unknown; mode?: unknown };
  const rawDb = typeof s.preamp === 'number' && Number.isFinite(s.preamp) ? s.preamp : 0;
  const db = Math.max(-12, Math.min(12, rawDb));
  const gain = Math.pow(10, db / 20);
  if (s.mode === 'limiter') {
    // Brick-wall-ish: only peaks above -1.5 dBFS are touched, so a positive
    // preamp never clips.
    return { gain, dry: 0, wet: 1, threshold: -1.5, knee: 0, ratio: 20, attack: 0.002, release: 0.12 };
  }
  if (s.mode === 'normalize') {
    // Gentle wide-knee levelling: loud masters come down, quiet ones come up
    // through the compressor's automatic make-up gain.
    return { gain, dry: 0, wet: 1, threshold: -24, knee: 24, ratio: 3, attack: 0.012, release: 0.3 };
  }
  return { gain, dry: 1, wet: 0, threshold: -24, knee: 30, ratio: 12, attack: 0.003, release: 0.25 };
}

/** True for a value that may be stored under "audioFx". */
export function isAudioFxState(value: unknown): value is AudioFxState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return typeof v.preamp === 'number' && Number.isFinite(v.preamp) && v.preamp >= -12 && v.preamp <= 12 &&
    (v.mode === 'off' || v.mode === 'limiter' || v.mode === 'normalize') &&
    Object.keys(v).every((k) => k === 'preamp' || k === 'mode');
}

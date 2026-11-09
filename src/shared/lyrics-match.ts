// Pure helpers for matching SoundCloud uploads against lyrics catalogues.
// Kept free of Electron so they can be unit-tested (test/lyrics-match.test.mjs).

// --- Lyrics query hygiene -------------------------------------------------
// SoundCloud titles are noisy ("ᴍᴏɴꜱᴛᴇʀ ʜɪɢʜ [prod. x] (slowed + reverb) | free"),
// and lyrics catalogues match on clean "artist title" pairs.
const SMALL_CAPS: Record<string, string> = {
  'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j',
  'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u',
  'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z',
};
export function foldFancy(t: string): string {
  return t
    .normalize('NFKC')
    .replace(/[ᴀʙᴄᴅᴇꜰɢʜɪᴊᴋʟᴍɴᴏᴘʀꜱᴛᴜᴠᴡʏᴢ]/g, (c) => SMALL_CAPS[c] || c)
    .replace(/[​-‍⁠﻿]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
const NOISE_WORDS = 'official|audio|video|lyric|lyrics|visuali[sz]er|music video|hd|hq|4k|remix|edit|original mix|extended|prod\\.?|produced|slowed|sped up|speed up|reverb|nightcore|bass boosted|free|download|cover|demo|snippet|unreleased|leak|full|preview|out now|clip|клип|премьера|текст|lyrics video|аудио';
const NOISE_BRACKETS = new RegExp('\\s*[\\(\\[\\{][^)\\]}]*(?:' + NOISE_WORDS + ')[^)\\]}]*[\\)\\]\\}]', 'gi');
export function cleanLyricsTitle(raw: string): string {
  return stripCredits(raw);
}
export function cleanLyricsArtist(raw: string): string {
  return foldFancy(raw)
    .replace(/\s*[-–—]\s*topic\s*$/i, '')
    .replace(/\s*(?:ft\.?|feat\.?|featuring|&|,|\bx\b)\s+.+$/i, '')
    .replace(/\s+/g, ' ')
    .trim();
}


// --- Understanding SoundCloud titles -----------------------------------------
// "46°C - feat. pas de vie / prod. @x" by uploader "sekairotten" is the song
// "46°C" (the dash only separates credits), while "Artist - Title" uploaded by
// someone else is a genuine split. Getting this wrong sends every source a
// garbage query, so the parse yields several ranked (artist, title) guesses.
export interface LyricsQuery { artist: string; title: string }
const CREDIT_START = /^(?:feat|ft|featuring|prod|produced|with|w\/|remix|mixed|slowed|sped|official|lyrics?|audio|video|visuali[sz]er|\(|\[)/i;

export function tokenize(s: string): string[] {
  return foldFancy(s).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
}
function lcsLength(a: string[], b: string[]): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1] ? dp[i - 1][j - 1] + 1 : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp[a.length][b.length];
}
/** 0..1 name similarity: token overlap, penalised when shared words come in another order ("46°C" is not "C-46"). */
export function similarity(a: string, b: string): number {
  const ta = tokenize(a), tb = tokenize(b);
  const A = new Set(ta), B = new Set(tb);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  A.forEach((t) => { if (B.has(t)) inter++; });
  if (!inter) return 0;
  const jaccard = inter / (A.size + B.size - inter);
  const contain = inter / Math.min(A.size, B.size);
  const order = Math.min(1, lcsLength(ta, tb) / inter);
  return Math.max(jaccard, contain * 0.9) * order;
}
function stripCredits(raw: string): string {
  return foldFancy(raw)
    .replace(NOISE_BRACKETS, '')
    .replace(/\s*[\(\[\{]\s*(?:feat|ft|featuring|prod|produced|with|w\/)\b[^)\]}]*[\)\]\}]/gi, '')
    .replace(/\s*[\/|]\s*(?:prod|produced|feat|ft|featuring|with)\b.*$/i, '')
    .replace(/\s+(?:prod\.?|produced by|feat\.?|ft\.?|featuring)\s+.*$/i, '')
    .replace(/\s*@\S+/g, '')
    .replace(/\s*\|\s*.*$/, '')
    .replace(/\s*#\S+/g, '')
    .replace(/[\s"“”/\\]+$/, '')
    .replace(/\s*[\(\[\{]\s*$/, '')
    .replace(/\s*[-–—]\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim();
}
export function parseSoundCloudTrack(artistRaw: string, titleRaw: string): LyricsQuery[] {
  const uploader = cleanLyricsArtist(artistRaw);
  const out: LyricsQuery[] = [];
  const seen = new Set<string>();
  const addTitleVariants = (artist: string, title: string) => {
    const base = title.trim();
    if (!base) return;
    const noMarks = base.replace(/[°º]/g, '').replace(/\s+/g, ' ').trim();
    const plain = base.replace(/[^\p{L}\p{N}\s'’]/gu, ' ').replace(/\s+/g, ' ').trim();
    for (const t of [base, noMarks, plain]) {
      if (!t) continue;
      const k = (artist + '|' + t).toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      out.push({ artist, title: t });
    }
  };
  const folded = foldFancy(titleRaw);
  const parts = folded.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) {
    const left = parts[0];
    const rest = parts.slice(1).join(' - ');
    if (CREDIT_START.test(rest.trim())) {
      // The dash introduces credits: the uploader is the artist.
      addTitleVariants(uploader, stripCredits(left));
    } else {
      addTitleVariants(cleanLyricsArtist(left), stripCredits(rest));
      addTitleVariants(uploader, stripCredits(rest));
      addTitleVariants(uploader, stripCredits(folded));
    }
  } else {
    addTitleVariants(uploader, stripCredits(folded));
  }
  // Last resort: the raw title, so odd formats still get a query.
  addTitleVariants(uploader, cleanLyricsTitle(titleRaw));
  return out.slice(0, 10);
}
/** Does a catalogue entry plausibly describe the track we were asked about? 0 = no. */
export function matchScore(name: string | undefined, artistName: string | undefined, wanted: LyricsQuery[], durationDiff?: number): number {
  if (!name) return 0;
  let best = 0;
  for (const w of wanted) {
    const ts = similarity(name, w.title);
    const as = artistName ? similarity(artistName, w.artist) : 0;
    // A one- or two-word title ("Jealous") exists in hundreds of songs: it only
    // counts with a matching artist or a matching length. Long titles are specific enough.
    const specific = tokenize(w.title).length >= 3;
    const sameLength = durationDiff !== undefined && durationDiff <= 3;
    if ((ts >= 0.8 && (as >= 0.3 || sameLength || specific)) || (ts >= 0.5 && as >= 0.5)) {
      best = Math.max(best, ts + 0.3 * as);
    }
  }
  return best;
}


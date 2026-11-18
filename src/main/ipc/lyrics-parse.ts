// Pure lyrics parsing and ranking helpers. No electron imports: unit-tested.
import { matchScore, type LyricsQuery } from '../../shared/lyrics-match';

export interface LyricsResult { lyrics: string; syncedLyrics?: string; source: string }

/** Strip LRC timing tags and metadata lines, leaving readable plain text. */
export function lrcToPlain(lrc: string): string {
  return lrc
    .replace(/\[\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?\]/g, '')
    .replace(/^\s*\[(?:ar|ti|al|by|re|ve|offset):[^\]]*\]\s*$/gim, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseLrclibResult(data: { plainLyrics?: string; syncedLyrics?: string }): { lyrics: string; syncedLyrics?: string; source: string } | null {
  if (data.syncedLyrics) {
    return { lyrics: lrcToPlain(data.syncedLyrics) || data.syncedLyrics.trim(), syncedLyrics: data.syncedLyrics, source: 'lrclib' };
  }
  if (data.plainLyrics) return { lyrics: data.plainLyrics, source: 'lrclib' };
  return null;
}

export interface LrclibEntry { plainLyrics?: string; syncedLyrics?: string; duration?: number; trackName?: string; artistName?: string }

/** Pick the best lrclib entry: synced beats plain, closest duration breaks ties. */
export function pickLrclib(entries: Array<LrclibEntry | null>, duration: number | undefined, wanted: LyricsQuery[]): { lyrics: string; syncedLyrics?: string; source: string } | null {
  // Only entries whose name matches the track count; "closest duration" alone
  // happily returned an unrelated song of the same length.
  const scored = entries
    .filter((e): e is LrclibEntry => !!e && !!(e.syncedLyrics || e.plainLyrics))
    .map((e) => ({ e, m: matchScore(e.trackName, e.artistName, wanted, (typeof duration === 'number' && duration > 0 && typeof e.duration === 'number') ? Math.abs(e.duration - duration) : undefined) }))
    .filter((x) => x.m > 0);
  if (!scored.length) return null;
  const dist = (e: LrclibEntry): number =>
    (typeof duration === 'number' && duration > 0 && typeof e.duration === 'number') ? Math.abs(e.duration - duration) : 0;
  scored.sort((a, b) => (Number(!!b.e.syncedLyrics) - Number(!!a.e.syncedLyrics)) || ((b.m - dist(b.e) * 0.02) - (a.m - dist(a.e) * 0.02)));
  return parseLrclibResult(scored[0].e);
}

export function cleanGeniusLyrics(raw: string): string {
  let lyrics = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\d+\s*Contributor[s]?/g, '')
    .replace(/Embed$/gm, '')
    .replace(/\d+Embed$/gm, '')
    .replace(/You might also like/g, '')
    .replace(/See .+ LiveGet tickets as low as \$\d+/g, '')
    .replace(/Produced by .+$/gm, '')
    .replace(/Written by .+$/gm, '');
  // Remove Genius page title: "Song Title Lyrics[...]" or "Song Title LyricsText"
  lyrics = lyrics.replace(/^[^\n]*Lyrics\s*\[[^\]]*\]\s*/i, '');
  lyrics = lyrics.replace(/^[^\n]*Lyrics(?=\s*[\r\n])/i, '');
  lyrics = lyrics.replace(/^[^\n]*Lyrics(?=[A-ZА-ЯЁ\[])/i, '');
  // Remove Genius localized header markers like "[Текст песни «Title»]" / "[Paroles de «Title»]"
  lyrics = lyrics.replace(/^\s*\[(?:Текст песни|Paroles de|Letra de|Songtext zu|Testo di|Lirik dari)[^\]]*\]\s*/i, '');
  // Remove trailing "Embed" or number lines
  lyrics = lyrics.replace(/\n\d+$/g, '');
  lyrics = lyrics.replace(/\n{3,}/g, '\n\n').trim();
  return lyrics;
}

/** Strip <div data-exclude-from-selection="true">...</div> blocks (Genius headers, song bio, contributors). */
export function stripExcludedBlocks(html: string): string {
  const marker = 'data-exclude-from-selection="true"';
  let result = html;
  while (true) {
    const attrIdx = result.indexOf(marker);
    if (attrIdx === -1) break;
    const tagStart = result.lastIndexOf('<div', attrIdx);
    if (tagStart === -1) break;
    const tagEnd = result.indexOf('>', attrIdx);
    if (tagEnd === -1) break;
    let depth = 1;
    let pos = tagEnd + 1;
    while (depth > 0 && pos < result.length) {
      const nextOpen = result.indexOf('<div', pos);
      const nextClose = result.indexOf('</div>', pos);
      if (nextClose === -1) return result.substring(0, tagStart);
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          result = result.substring(0, tagStart) + result.substring(nextClose + 6);
          break;
        }
        pos = nextClose + 6;
      }
    }
    if (depth > 0) break;
  }
  return result;
}

/** Scrape Genius page for lyrics containers */
export function extractGeniusLyrics(html: string): string | null {
  const lyricsMatches: string[] = [];
  let searchPos = 0;
  while (true) {
    const marker = 'data-lyrics-container="true"';
    const idx = html.indexOf(marker, searchPos);
    if (idx === -1) break;
    const tagEnd = html.indexOf('>', idx);
    if (tagEnd === -1) break;
    let depth = 1;
    let pos = tagEnd + 1;
    while (depth > 0 && pos < html.length) {
      const nextOpen = html.indexOf('<div', pos);
      const nextClose = html.indexOf('</div>', pos);
      if (nextClose === -1) break;
      if (nextOpen !== -1 && nextOpen < nextClose) {
        depth++;
        pos = nextOpen + 4;
      } else {
        depth--;
        if (depth === 0) {
          const inner = stripExcludedBlocks(html.substring(tagEnd + 1, nextClose));
          lyricsMatches.push(inner);
        }
        pos = nextClose + 6;
      }
    }
    searchPos = pos;
  }
  if (lyricsMatches.length > 0) {
    const lyrics = cleanGeniusLyrics(lyricsMatches.join('\n\n'));
    if (lyrics.length > 20) return lyrics;
  }
  return null;
}

/** Parse AZLyrics HTML — lyrics are inside a div with no class/id after the comment "Usage of azlyrics..." */
export function extractAZLyrics(html: string): string | null {
  // AZLyrics puts lyrics in a div that follows <!-- Usage of azlyrics.com content... -->
  const marker = '<!-- Usage of azlyrics.com content';
  const idx = html.indexOf(marker);
  if (idx === -1) return null;
  const divStart = html.indexOf('<div>', idx);
  if (divStart === -1) return null;
  const divEnd = html.indexOf('</div>', divStart);
  if (divEnd === -1) return null;
  let lyrics = html.substring(divStart + 5, divEnd);
  lyrics = lyrics
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return lyrics.length > 20 ? lyrics : null;
}

/** Parse ChartLyrics XML response */
export function extractChartLyrics(xml: string): string | null {
  const match = xml.match(/<Lyric>([\s\S]*?)<\/Lyric>/);
  if (!match || !match[1]) return null;
  const lyrics = match[1].replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').trim();
  return lyrics.length > 20 ? lyrics : null;
}

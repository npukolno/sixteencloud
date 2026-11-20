// Lyrics text for alignment: parsing, language detection, mapping words to a
// model's alphabet. Pure (no Electron), ported from the lyricsync prototype.

export interface Vocab {
  lang: string;                       // ru | uk | en
  variant: string;                    // xlsr | giga
  vocab: Record<string, number>;      // char -> id
  blank: number;
  delim: number | null;               // word separator '|'
}

const SECTION_RE = /^\s*[[(][^\])]*[\])]\s*$/;            // [Куплет 1], (Припев)
const TAG_RE = /^\s*@[\p{L}\p{N}_.-]+\s*$/u;                 // @nick instead of [Verse: nick]
const REPEAT_RE = /\s*[([]?\s*(?:[xх×*]\s*([2-9])|([2-9])\s*[xх×]|([2-9])\s*раза?)\s*[)\]]?\s*$/i;
export const CYR = /[а-яёіїєґ]/i;
export const LAT = /[a-z]/i;

function isBreak(s: string): boolean {
  // empty, [section], @nick or a separator line without letters/digits ("_____")
  return !s || SECTION_RE.test(s) || TAG_RE.test(s) || !/[\p{L}\p{N}]/u.test(s);
}

/** Lines to align: no blanks, section labels, @nicks or separators. "(x2)" at the end of a line is
 *  expanded: on the last line of a stanza the whole stanza repeats, mid-stanza only that line. */
export function parseLyrics(raw: string): string[] {
  const rawLines = raw.split(/\r?\n/).map((x) => x.trim());
  const lines: string[] = [];
  let stanza: string[] = [];
  for (let i = 0; i < rawLines.length; i++) {
    let s = rawLines[i];
    if (isBreak(s)) { stanza = []; continue; }
    const m = REPEAT_RE.exec(s);
    if (m && m.index > 0) {
      const k = Number(m[1] || m[2] || m[3]);
      s = s.slice(0, m.index).trimEnd();
      stanza.push(s);
      lines.push(s);
      const last = i + 1 >= rawLines.length || isBreak(rawLines[i + 1]);
      const unit = last ? stanza.slice() : [s];
      for (let r = 0; r < k - 1; r++) lines.push(...unit);
      stanza = [];
      continue;
    }
    stanza.push(s);
    lines.push(s);
  }
  return lines;
}

/** Lines that are probably not sung: section labels, credits. Used to warn the user about their own text. */
export function suspiciousLines(raw: string): string[] {
  const out: string[] = [];
  for (const ln of raw.split(/\r?\n/)) {
    const s = ln.trim();
    if (!s) continue;
    if (SECTION_RE.test(s) || TAG_RE.test(s)) continue;           // dropped anyway
    if (/^(текст|lyrics|слова|музыка|music|prod|produced|beat|бит)(?![\p{L}]).*[:—-]/iu.test(s) || /https?:\/\//i.test(s)) out.push(s);
  }
  return out;
}

const EN_WORDS = new Set('the and you your i to me my it is in of that this we be on for with not but are was they what all'.split(' '));

export function detectLang(lines: string[]): 'ru' | 'uk' | 'en' {
  const text = lines.join(' ').toLowerCase();
  const cyr = (text.match(/[а-яёіїєґ]/g) || []).length;
  const lat = (text.match(/[a-z]/g) || []).length;
  if (cyr < lat) return 'en';
  let uk = 0, ru = 0;
  for (const c of text) { if ('іїєґ'.includes(c)) uk++; else if ('ыэъё'.includes(c)) ru++; }
  return uk > ru ? 'uk' : 'ru';
}

export function englishShare(lines: string[]): number {
  const words = lines.join(' ').toLowerCase().match(/[a-z']+/g) || [];
  return words.length ? words.filter((w) => EN_WORDS.has(w)).length / words.length : 0;
}

// English -> Cyrillic, rough but enough for a word to take about its time.
const LAT_DI: Array<[string, string]> = [['sch', 'щ'], ['tch', 'ч'], ['igh', 'ай'], ['tion', 'шн'], ['sh', 'ш'], ['ch', 'ч'], ['th', 'з'],
  ['ph', 'ф'], ['ck', 'к'], ['kh', 'х'], ['zh', 'ж'], ['qu', 'кв'], ['oo', 'у'], ['ee', 'и'],
  ['ea', 'и'], ['ou', 'ау'], ['ow', 'ау'], ['ai', 'эй'], ['ay', 'эй'], ['ng', 'нг']];
const LAT_1: Record<string, string> = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((c, i) => {
  LAT_1[c] = ['а', 'б', 'к', 'д', 'е', 'ф', 'г', 'х', 'и', 'дж', 'к', 'л', 'м', 'н', 'о', 'п', 'к', 'р',
    'с', 'т', 'у', 'в', 'в', 'кс', 'и', 'з'][i];
});

export function latToCyr(word: string): string {
  let w = word.toLowerCase();
  for (const [a, b] of LAT_DI) w = w.split(a).join(b);
  let out = '';
  for (const ch of w) out += LAT_1[ch] ?? ch;
  return out;
}

// Cyrillic -> Latin (unidecode-style) for Cyrillic words in English songs.
const CYR_LAT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'io', ж: 'zh', з: 'z', и: 'i', й: 'i', к: 'k', л: 'l', м: 'm',
  н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'shch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'iu', я: 'ia', і: 'i', ї: 'i', є: 'ie', ґ: 'g',
};
export function cyrToLat(word: string): string {
  let out = '';
  for (const ch of word.toLowerCase()) out += CYR_LAT[ch] ?? ch;
  return out;
}

const SPECIAL = new Set(['|', '-', '<pad>', '<s>', '</s>', '<unk>', '[PAD]', '[UNK]', '<blk>']);

/** Word -> ids of the model alphabet (empty if nothing is left). */
export function toTokens(word: string, spec: Vocab): number[] {
  let w = word.toLowerCase();
  let keep: string[];
  if (spec.lang === 'ru' || spec.lang === 'uk') {
    if (LAT.test(w)) w = latToCyr(w);
    if (spec.lang === 'uk') {
      w = w.replace(/э/g, 'е').replace(/ъ/g, '');
      keep = [...w].filter((c) => (c in spec.vocab && !SPECIAL.has(c) && !'aceijklmnopuxy'.includes(c)) || c === "'");
    } else {
      keep = [...w].filter((c) => c in spec.vocab && !SPECIAL.has(c));
    }
  } else {
    if (CYR.test(w)) w = cyrToLat(w);
    keep = [...w.toUpperCase()].filter((c) => c in spec.vocab && !SPECIAL.has(c));
  }
  return keep.map((c) => spec.vocab[c]);
}

/** "А-аа-а!", "Ммм": one letter repeated. CTC cannot place such a line (no distinctive sound). */
export function isVocalise(line: string): boolean {
  const letters = line.toLowerCase().match(/[\p{L}]/gu) || [];
  return letters.length > 0 && letters.length <= 24 && new Set(letters).size <= 1;
}

/** "Я-я-я, я-я-я, эй, эй": repeated short syllables; its duration does not follow from its length. */
export function isAdlib(line: string): boolean {
  const toks = line.toLowerCase().match(/[\p{L}]+/gu) || [];
  const set = new Set(toks);
  return toks.length >= 2 && toks.every((t) => [...t].length <= 3) && (set.size <= 2 || toks.length >= 2 * set.size);
}

/** Text normalised for comparing repeated lines (python: re.sub(r"[^\w]+", " ", s.lower()).strip()). */
export function normLine(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}_]+/gu, ' ').trim();
}

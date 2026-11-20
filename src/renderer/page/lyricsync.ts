// The "Sync" tab (beta): make time-synced lyrics for a track with local neural models.
// Bundled to dist/renderer/page/lyricsync.js and injected into the SoundCloud page;
// fills the overlay panel [data-overlay="lyricsync"]. All heavy work runs in the main
// process (src/main/lyricsync/service.ts); this file is UI only.

declare global {
  interface Window {
    sixteenCloud?: any;
    __scLsync?: boolean;
    __scAudioElement?: HTMLAudioElement;
    __scLyricsRefresh?: () => void;
    __scToast?: (msg: string) => void;
    __scEscapeHtml?: (s: string) => string;
  }
}

type Lang = 'ru' | 'en';
type PackId = 'engine' | Lang;
interface PackInfo { id: PackId; installed: boolean; size: number; onDisk: number; installing: boolean }
interface Status {
  packs: PackInfo[];
  install: { packs: PackId[]; done: number; total: number; speed: number } | null;
  job: { id: string; stage: string; overall: number; elapsed: number; title: string; artist: string } | null;
  disk: { used: number; free: number | null; dir: string };
  hw: { cores: number; threads: number; ramGb: number; freeRamGb: number; backend: string; platform: string };
}
interface ResultLine { i: number; text: string; start: number; end: number; match: number; guessed: boolean }
interface JobResult {
  lines: ResultLine[]; gaps: Array<[number, number]>; recognition: { score: number; heard_pct: number; level: 'good' | 'partial' | 'poor' };
  missing: Array<{ i: number; text: string }>; repeats: number[]; duration: number;
}
interface Track { kind: 'sc'; url: string; title: string; artist: string; key: string }
interface FileTrack { kind: 'file'; path: string; name: string; title: string; artist: string; key: string }

const STR: Record<'ru' | 'en', Record<string, string>> = {
  ru: {
    title: 'Синхро', beta: 'BETA',
    intro: 'Синхронизированный текст для любого трека. Нейросеть работает на этом компьютере и расставляет строки по времени.',
    models: 'Модели', models_missing: 'Один раз скачайте модели. Они хранятся только на этом компьютере, удалить их можно здесь же.',
    get_ru: 'Скачать русский', get_en: 'Скачать английский', engine: 'Движок', lang_ru: 'Русский', lang_en: 'English',
    ready: 'Модели готовы', manage: 'Управлять', hide: 'Скрыть', remove: 'Удалить', download: 'Скачать', cancel: 'Отменить', retry: 'Повторить',
    downloading: 'Скачано {done} из {total}', speed: '{speed}/с', left: 'осталось ~{t}',
    disk: 'Занято {used} · свободно {free}', folder: 'Папка', hw: 'Процессор: {cores} потоков (используется {threads}) · память {ram} ГБ · {backend}',
    low_ram: 'На компьютере {ram} ГБ памяти. Анализ занимает около 2 ГБ: закройте тяжёлые программы, иначе он может не пройти.',
    err_disk: 'Не хватает места на диске: нужно {need}, свободно {free}.', err_network: 'Нет соединения или сервер не ответил. Проверьте интернет и нажмите «Повторить».',
    err_hash: 'Файл скачался повреждённым. Нажмите «Повторить».', err_http: 'Сервер с моделями вернул ошибку: {msg}', err_cancelled: 'Загрузка отменена.',
    err_extract: 'Не удалось распаковать движок: {msg}',
    track: 'Трек', now: 'Сейчас играет', none_playing: 'Ничего не играет. Включите трек или выберите файл.',
    use_current: 'Текущий трек', pick_file: 'Файл с компьютера…', file: 'Файл',
    text: 'Текст', find_text: 'Найти текст', searching: 'Ищу тексты…', no_texts: 'Ничего не нашлось. Вставьте текст вручную или поищите по другому запросу.',
    query: 'Исполнитель и название', search: 'Искать', take: 'Взять', synced_src: 'с таймингом', plain_src: 'без тайминга',
    paste: 'Вставьте текст песни: только то, что поётся, строка за строкой.',
    check_lines: '{n} {lines} · {lang}', lang_name_ru: 'русский', lang_name_en: 'английский', lang_name_uk: 'украинский (пока как русский)',
    suspicious: 'Похоже на служебную строку, лучше убрать: «{s}»',
    tips: 'Как подготовить текст — прочитайте перед вставкой',
    perf: 'Анализ сильно нагружает процессор и занимает около 2 ГБ памяти. На слабых компьютерах, пока он идёт, приложение и музыка могут тормозить и заикаться.',
    tip1: 'Только то, что реально поётся, и в том же порядке. Чем точнее текст, тем точнее тайминг.',
    tip2: 'Служебное убирайте: авторов, ссылки, «Текст песни…». Метки вроде [Припев] и @ник можно оставить, они пропускаются.',
    tip3: 'Повтор пишите целиком или пометкой (x2) в конце строки. На последней строке строфы (x2) повторит всю строфу.',
    tip4: 'Одна строка текста = одна строка на экране. Очень длинные строки лучше разбить.',
    tip5: 'Выкрики и подпевки в скобках, например (Ву), можно оставить. Английские слова в русском треке пишите латиницей.',
    run: 'Синхронизировать', running: 'Идёт анализ', why_models: 'Сначала скачайте модели', why_track: 'Выберите трек', why_text: 'Добавьте текст (хотя бы две строки)',
    st_fetch: 'Загрузка трека', st_decode: 'Подготовка звука', st_runtime: 'Запуск движка', st_separate: 'Выделение вокала', st_emissions: 'Распознавание', st_align: 'Выравнивание',
    elapsed: 'прошло {t}', bg_hint: 'Можно закрыть вкладку и слушать музыку: анализ идёт в фоне.', wasm_note: 'Нативный движок не запустился, переключаюсь на запасной (медленнее).',
    job_err: 'Не получилось', err_job_fetch: 'Не удалось загрузить трек: {msg}', err_job_decode: 'Не удалось прочитать звук: {msg}',
    err_job_memory: 'Не хватило памяти. Закройте тяжёлые программы и попробуйте снова.', err_job_stalled: 'Анализ перестал отвечать и был остановлен. Попробуйте ещё раз.',
    err_job_crashed: 'Процесс анализа завершился с ошибкой: {msg}', err_job_align: 'Текст не удалось уложить в трек. Проверьте, что это текст этой песни: {msg}',
    err_job_text: 'Текст пустой или слишком длинный.', err_job_packs: 'Сначала скачайте модели.', err_job_busy: 'Уже идёт другой анализ.',
    err_job_cancelled: 'Анализ отменён.', err_job_runtime: 'Движок не запустился: {msg}', err_job_model: 'Ошибка модели: {msg}', err_job_internal: 'Внутренняя ошибка: {msg}',
    result: 'Результат', rec_good: 'Модель хорошо слышит вокал. Тайминги надёжные.',
    rec_partial: 'Вокал слышно частично. Строки, которые модель не разобрала, расставлены по соседям (отмечены ⚠).',
    rec_poor: 'Вокал почти не слышен (эффекты, перегруз). Тайминги примерные, проверьте на слух.',
    unheard: 'Неразборчивых строк: {n}', missing: 'В записи нет последних строк, они убраны: {s}',
    took: 'Готово за {t}', save: 'Сохранить', saved: 'Сохранено. Текст уже во вкладке «Тексты песен» и в полноэкранном режиме.',
    open_lyrics: 'Открыть тексты', copy_lrc: 'Копировать LRC', copied: 'LRC скопирован',
    seek_hint: 'Нажмите на строку, чтобы перемотать к ней (если трек сейчас играет).',
    library: 'Мои синхронизации', lib_empty: 'Пока пусто. Сохранённые синхронизации появятся здесь.', show: 'Показать', applied: 'Выбрано для текстов этого трека',
    confirm_del: 'Удалить синхронизацию «{t}»?', confirm_remove: 'Удалить модели «{p}»? Их можно будет скачать снова.',
    lvl_good: 'хорошо', lvl_partial: 'частично', lvl_poor: 'плохо слышно',
  },
  en: {
    title: 'Sync', beta: 'BETA',
    intro: 'Time-synced lyrics for any track. A neural network on this computer places every line in time.',
    models: 'Models', models_missing: 'Download the models once. They stay on this computer only, and you can delete them here.',
    get_ru: 'Download Russian', get_en: 'Download English', engine: 'Engine', lang_ru: 'Russian', lang_en: 'English',
    ready: 'Models ready', manage: 'Manage', hide: 'Hide', remove: 'Delete', download: 'Download', cancel: 'Cancel', retry: 'Retry',
    downloading: '{done} of {total}', speed: '{speed}/s', left: '~{t} left',
    disk: 'Used {used} · free {free}', folder: 'Folder', hw: 'CPU: {cores} threads ({threads} used) · RAM {ram} GB · {backend}',
    low_ram: 'This computer has {ram} GB of RAM. Analysis takes about 2 GB: close heavy apps or it may fail.',
    err_disk: 'Not enough disk space: {need} needed, {free} free.', err_network: 'No connection or the server did not answer. Check the internet and press Retry.',
    err_hash: 'The file arrived damaged. Press Retry.', err_http: 'The model server returned an error: {msg}', err_cancelled: 'Download cancelled.',
    err_extract: 'Could not unpack the engine: {msg}',
    track: 'Track', now: 'Now playing', none_playing: 'Nothing is playing. Play a track or pick a file.',
    use_current: 'Current track', pick_file: 'File from computer…', file: 'File',
    text: 'Lyrics', find_text: 'Find lyrics', searching: 'Searching…', no_texts: 'Nothing found. Paste the lyrics or try another query.',
    query: 'Artist and title', search: 'Search', take: 'Use', synced_src: 'synced', plain_src: 'plain',
    paste: 'Paste the lyrics: only what is sung, line by line.',
    check_lines: '{n} {lines} · {lang}', lang_name_ru: 'Russian', lang_name_en: 'English', lang_name_uk: 'Ukrainian (treated as Russian for now)',
    suspicious: 'Looks like a service line, better remove it: “{s}”',
    tips: 'How to prepare the lyrics — read before pasting',
    perf: 'Analysis loads the CPU heavily and takes about 2 GB of RAM. On slower computers the app and the music may lag and stutter while it runs.',
    tip1: 'Only what is actually sung, in the same order. The closer the text, the better the timing.',
    tip2: 'Remove credits, links and headers. Labels like [Chorus] and @nick may stay, they are skipped.',
    tip3: 'Write repeats in full or mark them with (x2) at the end of a line. On the last line of a stanza (x2) repeats the whole stanza.',
    tip4: 'One line of text = one line on screen. Split very long lines.',
    tip5: 'Ad-libs in brackets like (Woo) may stay.',
    run: 'Sync', running: 'Analysing', why_models: 'Download the models first', why_track: 'Choose a track', why_text: 'Add the lyrics (two lines at least)',
    st_fetch: 'Fetching the track', st_decode: 'Preparing audio', st_runtime: 'Starting the engine', st_separate: 'Isolating vocals', st_emissions: 'Recognition', st_align: 'Alignment',
    elapsed: '{t} elapsed', bg_hint: 'You can leave this tab and keep listening: it runs in the background.', wasm_note: 'The native engine did not start, using the fallback one (slower).',
    job_err: 'Failed', err_job_fetch: 'Could not fetch the track: {msg}', err_job_decode: 'Could not read the audio: {msg}',
    err_job_memory: 'Out of memory. Close heavy apps and try again.', err_job_stalled: 'The analysis stopped responding and was stopped. Try again.',
    err_job_crashed: 'The analysis process failed: {msg}', err_job_align: 'The lyrics do not fit the track. Make sure they belong to this song: {msg}',
    err_job_text: 'The lyrics are empty or too long.', err_job_packs: 'Download the models first.', err_job_busy: 'Another analysis is running.',
    err_job_cancelled: 'Analysis cancelled.', err_job_runtime: 'The engine did not start: {msg}', err_job_model: 'Model error: {msg}', err_job_internal: 'Internal error: {msg}',
    result: 'Result', rec_good: 'The model hears the vocals well. Timings are reliable.',
    rec_partial: 'The vocals are partly audible. Lines the model could not make out were placed between their neighbours (marked ⚠).',
    rec_poor: 'The vocals are barely audible (effects, distortion). Timings are approximate, check by ear.',
    unheard: 'Unclear lines: {n}', missing: 'The last lines are not in the recording and were removed: {s}',
    took: 'Done in {t}', save: 'Save', saved: 'Saved. It is already in the Lyrics tab and the full-screen view.',
    open_lyrics: 'Open lyrics', copy_lrc: 'Copy LRC', copied: 'LRC copied',
    seek_hint: 'Click a line to jump to it (when the track is playing).',
    library: 'My syncs', lib_empty: 'Nothing yet. Saved syncs appear here.', show: 'Show', applied: 'Chosen for this track’s lyrics',
    confirm_del: 'Delete the sync “{t}”?', confirm_remove: 'Delete the “{p}” models? You can download them again.',
    lvl_good: 'good', lvl_partial: 'partial', lvl_poor: 'barely audible',
  },
};

let L: Record<string, string> = STR.en;
function tr(k: string, p?: Record<string, string | number>): string {
  let s = L[k] ?? STR.en[k] ?? k;
  if (p) for (const x of Object.keys(p)) s = s.split(`{${x}}`).join(String(p[x]));
  return s;
}
function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
function mb(n: number | null | undefined): string {
  if (n === null || n === undefined) return '?';
  return n >= 1e9 ? `${(n / 1e9).toFixed(1)} ГБ`.replace('ГБ', L === STR.ru ? 'ГБ' : 'GB') : `${Math.round(n / 1e6)} ${L === STR.ru ? 'МБ' : 'MB'}`;
}
function linesWord(n: number): string {
  if (L !== STR.ru) return n === 1 ? 'line' : 'lines';
  const d = n % 10, h = n % 100;
  return d === 1 && h !== 11 ? 'строка' : d >= 2 && d <= 4 && (h < 12 || h > 14) ? 'строки' : 'строк';
}
function clock(s: number): string {
  s = Math.max(0, Math.round(s));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
function ts(s: number): string {
  const m = Math.floor(s / 60);
  return `${m}:${(s - m * 60).toFixed(1).padStart(4, '0')}`;
}


// Akar-style stroke icons (same set and weight as the rest of the app)
const ICON: Record<string, string> = {
  info: '<circle cx="12" cy="12" r="9.5"/><path d="M12 11v5.5M12 7.6v.01"/>',
  down: '<path d="m6 9 6 6 6-6"/>',
  check: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
  warn: '<path d="M12 4 2.8 19.5h18.4L12 4Z"/><path d="M12 10v4.2M12 16.9v.01"/>',
  x: '<path d="m6 6 12 12M18 6 6 18"/>',
};
function icon(name: string, cls = ''): string {
  return `<svg class="sc-akar-icon ${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICON[name]}</svg>`;
}

const CSS = `
.lsx{display:flex;flex-direction:column;gap:14px}
.lsx-beta{display:inline-block;margin-left:8px;padding:1px 6px;border-radius:5px;font-size:10px;font-weight:700;letter-spacing:.8px;vertical-align:middle;color:var(--sc-accent);border:1px solid rgba(var(--sc-accent-rgb),.55)}
.lsx-card{background:var(--sc-surface);border:1px solid var(--sc-border);border-radius:10px;padding:12px 14px;display:flex;flex-direction:column;gap:8px}
.lsx-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.lsx-row>.grow,.lsx-libitem>.grow{flex:1;min-width:0}
.lsx-muted{color:var(--sc-text-muted);font-size:12px}
.lsx-subtle{color:var(--sc-text-subtle);font-size:11px}
.lsx-ok{color:var(--sc-success)}.lsx-warn{color:var(--sc-warning)}.lsx-err{color:var(--sc-danger)}
.lsx-dot{width:8px;height:8px;border-radius:50%;display:inline-block;flex:0 0 8px}
.lsx-dot.good{background:var(--sc-success)}.lsx-dot.partial{background:var(--sc-warning)}.lsx-dot.poor{background:var(--sc-danger)}.lsx-dot.idle{background:var(--sc-text-subtle)}
.lsx-ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lsx textarea{width:100%;height:220px;resize:none;box-sizing:border-box;font:inherit;font-size:13px;line-height:1.45;padding:10px;border-radius:8px;background:var(--sc-bg);color:var(--sc-text);border:1px solid var(--sc-border)}
.lsx textarea:focus{outline:none;border-color:var(--sc-accent)}
.lsx textarea::-webkit-scrollbar{width:8px}
.lsx textarea::-webkit-scrollbar-thumb{background:rgba(255,255,255,.14);border-radius:4px}
.lsx textarea::-webkit-scrollbar-track,.lsx textarea::-webkit-scrollbar-corner{background:transparent}
.lsx-cands{display:flex;flex-direction:column;max-height:220px;overflow:auto}
.lsx-cand{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--sc-border)}
.lsx-cand:last-child{border-bottom:none}
.lsx-tips{font-size:12px;color:var(--sc-text-muted);border:1px solid rgba(var(--sc-accent-rgb),.35);border-radius:8px;background:rgba(var(--sc-accent-rgb),.06)}
.lsx-tips summary{list-style:none;display:flex;align-items:center;gap:8px;padding:9px 12px;cursor:pointer;color:var(--sc-text);font-size:13px;font-weight:600}
.lsx-tips summary::-webkit-details-marker{display:none}
.lsx-tips-i{flex:0 0 auto;width:17px;height:17px;color:var(--sc-accent)}
.lsx-tips-chev{flex:0 0 auto;width:15px;height:15px;margin-left:auto;color:var(--sc-text-muted);transition:transform .2s}
.lsx-tips[open] .lsx-tips-chev{transform:rotate(180deg)}
.lsx-ico{width:14px;height:14px;flex:0 0 auto}
.lsx-alert{display:flex;gap:8px;align-items:flex-start}
.lsx-alert .lsx-ico{margin-top:1px}
.lsx-stage{display:inline-flex;align-items:center;gap:4px}
.lsx-stage .lsx-ico{width:12px;height:12px}
.lsx-line .m{display:inline-flex;align-items:center}
.lsx-tips ul{margin:0;padding:0 14px 12px 32px;display:flex;flex-direction:column;gap:5px}
.lsx-alert{font-size:12px;line-height:1.45;padding:8px 10px;border-radius:8px;color:var(--sc-danger);background:var(--sc-danger-soft);border:1px solid rgba(231,76,60,.35)}
.lsx-stages{display:flex;gap:6px;flex-wrap:wrap}
.lsx-stage{font-size:11px;padding:3px 8px;border-radius:999px;border:1px solid var(--sc-border);color:var(--sc-text-subtle)}
.lsx-stage.done{color:var(--sc-text-muted)}
.lsx-stage.cur{color:var(--sc-text);border-color:var(--sc-accent)}
.lsx-lines{max-height:320px;overflow:auto;font-size:13px;border-top:1px solid var(--sc-border)}
.lsx-line{display:flex;gap:10px;padding:5px 2px;cursor:pointer;border-radius:6px}
.lsx-line:hover{background:var(--sc-surface-raised)}
.lsx-line .t{flex:0 0 46px;color:var(--sc-text-subtle);font-variant-numeric:tabular-nums}
.lsx-line .m{flex:0 0 14px;color:var(--sc-warning);padding-top:2px}
.lsx-line.active{background:rgba(var(--sc-accent-rgb),.14)}
.lsx-lib{display:flex;flex-direction:column}
.lsx-libitem{display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid var(--sc-border)}
.lsx-libitem:last-child{border-bottom:none}
.lsx .sc-overlay-progress{margin:2px 0}
`;

function install(): void {
  if (window.__scLsync) return;
  const root = document.querySelector('[data-overlay="lyricsync"]') as HTMLElement | null;
  const api = window.sixteenCloud;
  if (!root || !api || typeof api.lsyncStatus !== 'function') { setTimeout(install, 700); return; }
  window.__scLsync = true;

  const st = document.createElement('style');
  st.id = 'sc-lsync-style';
  st.textContent = CSS;
  document.head.appendChild(st);

  // ---- state ----
  let status: Status | null = null;
  let track: Track | FileTrack | null = null;
  let followPlayer = true;
  let installErr: { code: string; message: string; need?: number; free?: number } | null = null;
  let showManage = false;
  let job: { id: string; stage: string; overall: number; elapsed: number; note?: string } | null = null;
  let jobErr: { code: string; message: string } | null = null;
  let result: { id: string; res: JobResult; lrc: string; lang: string; title: string; artist: string; key: string; url?: string; took: number; saved: boolean } | null = null;
  let library: any[] = [];
  let checkInfo: { lines: number; lang: string | null; suspicious: string[] } | null = null;
  let installSpeed = 0;

  root.innerHTML = `
    <div class="sc-overlay-header"><h2><span id="lsx-title"></span><span class="lsx-beta" id="lsx-beta"></span></h2></div>
    <div class="sc-overlay-body lsx">
      <div class="sc-overlay-hint" id="lsx-intro"></div>
      <div class="lsx-card" id="lsx-models"></div>
      <div class="lsx-card" id="lsx-track"></div>
      <div class="lsx-card" id="lsx-text">
        <div class="lsx-row"><span class="sc-overlay-section-title grow" id="lsx-text-h"></span>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" id="lsx-find"></button></div>
        <div class="lsx-row" id="lsx-q-row" style="display:none">
          <input class="sc-overlay-input grow" id="lsx-q"><button class="sc-overlay-btn sc-overlay-btn-secondary" id="lsx-q-go"></button></div>
        <div class="lsx-cands" id="lsx-cands"></div>
        <details class="lsx-tips"><summary>${icon('info', 'lsx-tips-i')}<span id="lsx-tips-h"></span>${icon('down', 'lsx-tips-chev')}</summary><ul id="lsx-tips"></ul></details>
        <textarea id="lsx-ta" spellcheck="false"></textarea>
        <div class="lsx-muted" id="lsx-check"></div>
      </div>
      <div class="lsx-card" id="lsx-run"></div>
      <div class="lsx-card" id="lsx-result" style="display:none"></div>
      <div class="lsx-card" id="lsx-libcard"></div>
    </div>`;
  const $ = <T extends HTMLElement = HTMLElement>(id: string) => root.querySelector('#' + id) as T;
  const ta = $<HTMLTextAreaElement>('lsx-ta');

  function staticTexts(): void {
    $('lsx-title').textContent = tr('title');
    $('lsx-beta').textContent = tr('beta');
    $('lsx-intro').textContent = tr('intro');
    $('lsx-text-h').textContent = tr('text');
    $('lsx-find').textContent = tr('find_text');
    $<HTMLInputElement>('lsx-q').placeholder = tr('query');
    $('lsx-q-go').textContent = tr('search');
    ta.placeholder = tr('paste');
    $('lsx-tips-h').textContent = tr('tips');
    $('lsx-tips').innerHTML = ['tip1', 'tip2', 'tip3', 'tip4', 'tip5'].map((k) => `<li>${esc(tr(k))}</li>`).join('');
  }

  // ---- now playing (same source as the Lyrics panel, so keys match) ----
  function badgeText(el: Element | null): string {
    if (!el) return '';
    const a = el.getAttribute('title');
    if (a) return a.trim();
    const v = el.querySelector('span[aria-hidden="true"]');
    if (v && v.textContent && v.textContent.trim()) return v.textContent.trim();
    return (el.textContent || '').replace(/^Current track:\s*/, '').trim();
  }
  function nowPlaying(): Track | null {
    const t = document.querySelector('.playbackSoundBadge__titleLink') as HTMLAnchorElement | null;
    if (!t) return null;
    const title = badgeText(t);
    const artist = badgeText(document.querySelector('.playbackSoundBadge__lightLink')).replace(/\s*\(@[^)]*\)\s*$/, '').trim();
    let url = '';
    try { const u = new URL(t.href, location.origin); u.search = ''; u.hash = ''; url = u.href; } catch { /* no link */ }
    if (!title || !url) return null;
    return { kind: 'sc', url, title, artist, key: `${artist}|${title}`.toLowerCase() };
  }

  // ---- models card ----
  const packName = (id: PackId) => id === 'engine' ? tr('engine') : id === 'ru' ? tr('lang_ru') : tr('lang_en');
  function renderModels(): void {
    const el = $('lsx-models');
    if (!status) { el.innerHTML = `<div class="lsx-muted">…</div>`; return; }
    const by = Object.fromEntries(status.packs.map((p) => [p.id, p])) as Record<PackId, PackInfo>;
    const ready = by.engine.installed && (by.ru.installed || by.en.installed);
    let h = `<div class="lsx-row"><span class="sc-overlay-section-title grow">${esc(tr('models'))}</span>`;
    if (ready && !status.install) h += `<button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="manage">${esc(showManage ? tr('hide') : tr('manage'))}</button>`;
    h += `</div>`;
    if (status.install) {
      const i = status.install;
      const pct = i.total ? (100 * i.done) / i.total : 0;
      const left = installSpeed > 0 ? tr('left', { t: clock((i.total - i.done) / installSpeed) }) : '';
      h += `<div class="lsx-muted">${esc(i.packs.map(packName).join(' + '))}</div>
        <div class="sc-overlay-progress"><div class="sc-overlay-progress-bar" style="width:${pct.toFixed(1)}%"></div></div>
        <div class="lsx-row"><span class="lsx-muted grow">${esc(tr('downloading', { done: mb(i.done), total: mb(i.total) }))}${installSpeed ? ' · ' + esc(tr('speed', { speed: mb(installSpeed) })) : ''}${left ? ' · ' + esc(left) : ''}</span>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="cancel-install">${esc(tr('cancel'))}</button></div>`;
    } else if (!ready) {
      const eng = by.engine.installed ? 0 : by.engine.size;
      h += `<div class="lsx-muted">${esc(tr('models_missing'))}</div>
        <div class="lsx-row">
          <button class="sc-overlay-btn sc-overlay-btn-primary" data-a="get" data-p="ru">${esc(tr('get_ru'))} · ${esc(mb(eng + by.ru.size))}</button>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="get" data-p="en">${esc(tr('get_en'))} · ${esc(mb(eng + by.en.size))}</button>
        </div>`;
    } else {
      const langs = (['ru', 'en'] as Lang[]).filter((l) => by[l].installed).map(packName).join(', ');
      h += `<div class="lsx-row"><span class="lsx-dot good"></span><span class="grow">${esc(tr('ready'))}: ${esc(langs)}</span></div>`;
    }
    if (installErr) {
      const k = 'err_' + installErr.code;
      const msg = STR.en[k] ? tr(k, { need: mb(installErr.need), free: mb(installErr.free), msg: installErr.message }) : installErr.message;
      h += `<div class="lsx-row"><span class="lsx-err grow">${esc(msg)}</span>${installErr.code !== 'cancelled' ? `<button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="retry">${esc(tr('retry'))}</button>` : ''}</div>`;
    }
    if (status.hw.ramGb && status.hw.ramGb < 6) h += `<div class="lsx-warn" style="font-size:12px">${esc(tr('low_ram', { ram: status.hw.ramGb }))}</div>`;
    if ((ready && showManage) || (!ready && !status.install && (by.engine.installed || by.ru.installed || by.en.installed))) {
      h += `<div class="lsx-lib">` + (['engine', 'ru', 'en'] as PackId[]).map((id) => {
        const p = by[id];
        return `<div class="lsx-libitem"><span class="lsx-dot ${p.installed ? 'good' : 'idle'}"></span>
          <span class="grow">${esc(packName(id))} <span class="lsx-subtle">${esc(mb(p.installed ? p.onDisk : p.size))}</span></span>
          ${p.installed
            ? `<button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="remove" data-p="${id}">${esc(tr('remove'))}</button>`
            : (id !== 'engine' ? `<button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="get" data-p="${id}">${esc(tr('download'))}</button>` : '')}
        </div>`;
      }).join('') + `</div>
        <div class="lsx-subtle">${esc(tr('disk', { used: mb(status.disk.used), free: mb(status.disk.free) }))}</div>
        <div class="lsx-subtle lsx-ellipsis" title="${esc(status.disk.dir)}">${esc(tr('folder'))}: ${esc(status.disk.dir)}</div>
        <div class="lsx-subtle">${esc(tr('hw', { cores: status.hw.cores, threads: status.hw.threads, ram: status.hw.ramGb, backend: status.hw.backend === 'wasm' ? 'WebAssembly' : 'ONNX Runtime' }))}</div>`;
    }
    el.innerHTML = h;
  }

  // ---- track card ----
  function renderTrack(): void {
    if (followPlayer && !job) {
      const np = nowPlaying();
      if (np && (!track || track.kind !== 'sc' || track.url !== np.url)) {
        const changed = !!track;
        track = np;
        if (changed) { $('lsx-cands').innerHTML = ''; }
      }
    }
    const el = $('lsx-track');
    let line: string;
    if (!track) line = `<span class="lsx-muted">${esc(tr('none_playing'))}</span>`;
    else if (track.kind === 'sc') line = `<span class="lsx-muted">${esc(tr('now'))}:</span> <b>${esc(track.title)}</b> <span class="lsx-muted">— ${esc(track.artist)}</span>`;
    else line = `<span class="lsx-muted">${esc(tr('file'))}:</span> <b>${esc(track.name)}</b>`;
    const busy = !!job;
    el.innerHTML = `<div class="sc-overlay-section-title">${esc(tr('track'))}</div>
      <div class="lsx-ellipsis">${line}</div>
      <div class="lsx-row">
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="current" ${busy ? 'disabled' : ''}>${esc(tr('use_current'))}</button>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="file" ${busy ? 'disabled' : ''}>${esc(tr('pick_file'))}</button>
      </div>`;
  }

  // ---- text ----
  let checkTimer: number | undefined;
  function scheduleCheck(): void {
    window.clearTimeout(checkTimer);
    checkTimer = window.setTimeout(async () => {
      try { checkInfo = await api.lsyncCheckText(ta.value); } catch { checkInfo = null; }
      renderCheck(); renderRun();
    }, 250);
  }
  function renderCheck(): void {
    const el = $('lsx-check');
    if (!checkInfo || !ta.value.trim()) { el.innerHTML = ''; return; }
    const lang = checkInfo.lang ? tr('lang_name_' + checkInfo.lang) : '';
    el.innerHTML = esc(tr('check_lines', { n: checkInfo.lines, lines: linesWord(checkInfo.lines), lang })) +
      checkInfo.suspicious.map((s) => `<div class="lsx-warn">${esc(tr('suspicious', { s }))}</div>`).join('');
  }
  async function findTexts(query?: string): Promise<void> {
    const list = $('lsx-cands');
    $('lsx-q-row').style.display = '';
    if (!track) return;
    list.innerHTML = `<div class="lsx-muted">${esc(tr('searching'))}</div>`;
    const forTrack = track;
    let items: any[] = [];
    try {
      const au = window.__scAudioElement;
      const dur = au && isFinite(au.duration) && au.duration > 1 && track.kind === 'sc' ? au.duration : undefined;
      items = await api.lyricsCandidates(track.artist, track.title, dur, query || undefined) || [];
    } catch { items = []; }
    if (track !== forTrack) return;
    items = items.filter((c) => c && c.lyrics && c.source !== 'sixteen');
    if (!items.length) { list.innerHTML = `<div class="lsx-muted">${esc(tr('no_texts'))}</div>`; return; }
    list.innerHTML = '';
    items.slice(0, 10).forEach((c) => {
      const row = document.createElement('div');
      row.className = 'lsx-cand';
      const prev = String(c.lyrics).split(/\r?\n/).filter(Boolean).slice(0, 2).join(' / ');
      row.innerHTML = `<div class="grow" style="flex:1;min-width:0"><div class="lsx-ellipsis">${esc(c.label)}</div>
        <div class="lsx-subtle">${esc(c.source)} · ${esc(c.synced ? tr('synced_src') : tr('plain_src'))}${typeof c.durationDiff === 'number' ? ' · Δ' + c.durationDiff.toFixed(0) + 's' : ''}</div>
        <div class="lsx-subtle lsx-ellipsis">${esc(prev.slice(0, 120))}</div></div>`;
      const b = document.createElement('button');
      b.className = 'sc-overlay-btn sc-overlay-btn-primary';
      b.textContent = tr('take');
      b.addEventListener('click', () => { ta.value = String(c.lyrics); scheduleCheck(); list.innerHTML = ''; });
      row.appendChild(b);
      list.appendChild(row);
    });
  }

  // ---- run card ----
  const STAGES = ['fetch', 'decode', 'separate', 'emissions', 'align'];
  function canRun(): string | null {
    if (!status) return 'why_models';
    const by = Object.fromEntries(status.packs.map((p) => [p.id, p])) as Record<PackId, PackInfo>;
    if (!by.engine.installed) return 'why_models';
    const lang = checkInfo?.lang === 'en' ? 'en' : 'ru';
    if (!by[lang].installed) return 'why_models';
    if (!track) return 'why_track';
    if (!checkInfo || checkInfo.lines < 2) return 'why_text';
    return null;
  }
  function renderRun(): void {
    const el = $('lsx-run');
    if (job) {
      const cur = STAGES.indexOf(job.stage === 'runtime' ? 'decode' : job.stage);
      const elapsed = job.elapsed;
      const eta = job.overall > 0.08 ? (elapsed / job.overall) * (1 - job.overall) : 0;
      el.innerHTML = `<div class="lsx-row"><span class="sc-overlay-section-title grow">${esc(tr('running'))}</span>
          <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="cancel-job">${esc(tr('cancel'))}</button></div>
        <div class="lsx-stages">${STAGES.map((s, i) => `<span class="lsx-stage ${i < cur ? 'done' : i === cur ? 'cur' : ''}">${i < cur ? icon('check', 'lsx-ico') : ''}${esc(tr('st_' + s))}</span>`).join('')}</div>
        <div class="sc-overlay-progress"><div class="sc-overlay-progress-bar" style="width:${(job.overall * 100).toFixed(1)}%"></div></div>
        <div class="lsx-muted">${esc(tr('elapsed', { t: clock(elapsed) }))}${eta ? ' · ' + esc(tr('left', { t: clock(eta) })) : ''}</div>
        ${job.note === 'wasm' ? `<div class="lsx-warn" style="font-size:12px">${esc(tr('wasm_note'))}</div>` : ''}
        <div class="lsx-alert">${icon('warn', 'lsx-ico')}<span>${esc(tr('perf'))}</span></div>
        <div class="lsx-subtle">${esc(tr('bg_hint'))}</div>`;
      return;
    }
    const why = canRun();
    let h = `<div class="lsx-alert">${icon('warn', 'lsx-ico')}<span>${esc(tr('perf'))}</span></div>
      <div class="lsx-row"><button class="sc-overlay-btn sc-overlay-btn-primary" data-a="run" ${why ? 'disabled' : ''}>${esc(tr('run'))}</button>
      ${why ? `<span class="lsx-muted">${esc(tr(why))}</span>` : ''}</div>`;
    if (jobErr && jobErr.code !== 'cancelled') {
      const k = 'err_job_' + jobErr.code;
      h += `<div class="lsx-err" style="font-size:12px">${esc(STR.en[k] ? tr(k, { msg: jobErr.message }) : jobErr.message)}</div>`;
    } else if (jobErr) h += `<div class="lsx-muted">${esc(tr('err_job_cancelled'))}</div>`;
    el.innerHTML = h;
  }

  // ---- result ----
  let rollRaf = 0, lastActive = -1;
  function renderResult(): void {
    const el = $('lsx-result');
    cancelAnimationFrame(rollRaf);
    lastActive = -1;
    if (!result) { el.style.display = 'none'; el.innerHTML = ''; return; }
    el.style.display = '';
    const r = result.res;
    const lvl = r.recognition.level;
    const unheard = r.lines.filter((l) => l.guessed || l.match < 0.3).length;
    let h = `<div class="lsx-row"><span class="sc-overlay-section-title grow">${esc(tr('result'))}</span><span class="lsx-subtle">${esc(tr('took', { t: clock(result.took) }))}</span></div>
      <div class="lsx-row"><span class="lsx-dot ${lvl}"></span><span class="grow ${lvl === 'good' ? '' : lvl === 'partial' ? 'lsx-warn' : 'lsx-err'}" style="font-size:13px">${esc(tr('rec_' + lvl))}</span></div>`;
    if (unheard && lvl !== 'poor') h += `<div class="lsx-muted">${esc(tr('unheard', { n: unheard }))}</div>`;
    if (r.missing.length) h += `<div class="lsx-warn" style="font-size:12px">${esc(tr('missing', { s: r.missing.map((m) => '«' + m.text + '»').join(', ') }))}</div>`;
    h += `<div class="lsx-row">
        <button class="sc-overlay-btn sc-overlay-btn-primary" data-a="save" ${result.saved ? 'disabled' : ''}>${esc(tr('save'))}</button>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="open-lyrics">${esc(tr('open_lyrics'))}</button>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="copy">${esc(tr('copy_lrc'))}</button></div>`;
    if (result.saved) h += `<div class="lsx-ok" style="font-size:12px">${esc(tr('saved'))}</div>`;
    h += `<div class="lsx-subtle">${esc(tr('seek_hint'))}</div><div class="lsx-lines" id="lsx-lines">` +
      r.lines.map((l, i) => `<div class="lsx-line" data-i="${i}"><span class="t">${ts(l.start)}</span><span class="m">${l.guessed || l.match < 0.3 ? icon('warn', 'lsx-ico') : ''}</span><span>${esc(l.text)}</span></div>`).join('') + `</div>`;
    el.innerHTML = h;
    const lines = Array.from(el.querySelectorAll('.lsx-line')) as HTMLElement[];
    lines.forEach((ln) => ln.addEventListener('click', () => {
      const au = window.__scAudioElement;
      const np = nowPlaying();
      if (au && np && result && np.key === result.key) au.currentTime = Math.max(0, r.lines[Number(ln.dataset.i)].start);
    }));
    const box = $('lsx-lines');
    const roll = () => {
      rollRaf = requestAnimationFrame(roll);
      if (!result || document.hidden || !root!.classList.contains('active')) return;
      const au = window.__scAudioElement, np = nowPlaying();
      if (!au || !np || np.key !== result.key) return;
      let k = -1;
      for (let i = 0; i < r.lines.length; i++) { if (r.lines[i].start <= au.currentTime) k = i; else break; }
      if (k === lastActive) return;
      if (lastActive >= 0 && lines[lastActive]) lines[lastActive].classList.remove('active');
      lastActive = k;
      if (k >= 0 && lines[k]) { lines[k].classList.add('active'); box.scrollTo({ top: lines[k].offsetTop - box.offsetTop - box.clientHeight / 2, behavior: 'smooth' }); }
    };
    rollRaf = requestAnimationFrame(roll);
  }

  // ---- library ----
  async function loadLibrary(): Promise<void> {
    try { library = await api.lsyncLibrary() || []; } catch { library = []; }
    renderLibrary();
  }
  function renderLibrary(): void {
    const el = $('lsx-libcard');
    let h = `<div class="sc-overlay-section-title">${esc(tr('library'))}${library.length ? ` (${library.length})` : ''}</div>`;
    if (!library.length) h += `<div class="lsx-muted">${esc(tr('lib_empty'))}</div>`;
    else h += `<div class="lsx-lib">` + library.slice(0, 100).map((e) => `<div class="lsx-libitem">
        <span class="lsx-dot ${esc(e.recognition?.level || 'idle')}" title="${esc(tr('lvl_' + (e.recognition?.level || 'good')))}"></span>
        <div style="flex:1;min-width:0"><div class="lsx-ellipsis">${esc(e.title)}${e.artist ? ` <span class="lsx-muted">— ${esc(e.artist)}</span>` : ''}</div>
          <div class="lsx-subtle">${esc(new Date(e.createdAt).toLocaleString())} · ${esc(e.lang)} · ${e.lineCount}</div></div>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="lib-show" data-id="${esc(e.id)}">${esc(tr('show'))}</button>
        <button class="sc-overlay-btn sc-overlay-btn-secondary" data-a="lib-del" data-id="${esc(e.id)}" aria-label="${esc(tr('remove'))}">${icon('x', 'lsx-ico')}</button>
      </div>`).join('') + `</div>`;
    el.innerHTML = h;
  }

  // ---- rail mark while busy ----
  function railDot(): void {
    const icon = document.querySelector('#sc-overlay-rail .sc-nav-item[data-target="lyricsync"] .sc-nav-icon');
    if (!icon) return;
    let dot = icon.querySelector('.sc-nav-dot');
    const state = job || status?.install ? 'busy' : '';
    if (!state) { dot?.remove(); return; }
    if (!dot) { dot = document.createElement('span'); dot.setAttribute('aria-hidden', 'true'); icon.appendChild(dot); }
    dot.className = 'sc-nav-dot sc-nav-dot-busy';
  }

  function renderAll(): void { renderModels(); renderTrack(); renderRun(); renderResult(); renderLibrary(); railDot(); }

  async function refreshStatus(): Promise<void> {
    try { status = await api.lsyncStatus(); } catch { return; }
    if (status?.job && !job) job = { id: status.job.id, stage: status.job.stage, overall: status.job.overall, elapsed: status.job.elapsed };
    if (!status?.job && job) job = null;
    renderModels(); renderRun(); railDot();
  }

  // ---- actions ----
  root.addEventListener('click', async (e) => {
    const b = (e.target as HTMLElement).closest('[data-a]') as HTMLElement | null;
    if (!b || (b as HTMLButtonElement).disabled) return;
    const a = b.dataset.a, p = b.dataset.p as PackId | undefined;
    try {
      if (a === 'get' && p) {
        installErr = null;
        const need: PackId[] = ['engine', p];
        await api.lsyncInstall(need);
        await refreshStatus();
      } else if (a === 'retry') {
        installErr = null;
        const missing = status?.packs.filter((x) => !x.installed).map((x) => x.id) || [];
        const lang = missing.includes('ru') && !status?.packs.find((x) => x.id === 'en')?.installed ? 'ru' : missing.find((x) => x !== 'engine') || 'ru';
        await api.lsyncInstall(['engine', lang]);
        await refreshStatus();
      } else if (a === 'cancel-install') {
        await api.lsyncCancelInstall();
      } else if (a === 'manage') {
        showManage = !showManage; renderModels();
      } else if (a === 'remove' && p) {
        if (!confirm(tr('confirm_remove', { p: packName(p) }))) return;
        await api.lsyncRemove(p);
        await refreshStatus();
      } else if (a === 'current') {
        followPlayer = true; track = null; renderTrack(); renderRun();
      } else if (a === 'file') {
        const f = await api.lsyncPickFile();
        if (f) {
          followPlayer = false;
          const base = String(f.name).replace(/\.[^.]+$/, '');
          const m = /^(.+?)\s+[-–—]\s+(.+)$/.exec(base);
          const artist = m ? m[1] : '', title = m ? m[2] : base;
          track = { kind: 'file', path: f.path, name: f.name, title, artist, key: `${artist}|${title}`.toLowerCase() };
          $('lsx-cands').innerHTML = '';
          renderTrack(); renderRun();
        }
      } else if (a === 'run') {
        if (!track) return;
        jobErr = null; result = null; renderResult();
        const source = track.kind === 'sc'
          ? { kind: 'sc', url: track.url, title: track.title, artist: track.artist }
          : { kind: 'file', path: track.path, title: track.title, artist: track.artist };
        const r = await api.lsyncStart({ source, text: ta.value });
        if (r && r.error) { jobErr = r.error; renderRun(); return; }
        pending = { ...track };
        job = { id: r.id, stage: 'fetch', overall: 0, elapsed: 0 };
        renderTrack(); renderRun(); railDot();
      } else if (a === 'cancel-job') {
        await api.lsyncCancel();
      } else if (a === 'save' && result) {
        await api.lsyncSave({ id: result.id, title: result.title, artist: result.artist, key: result.key, url: result.url });
        result.saved = true;
        renderResult();
        window.__scLyricsRefresh?.();
        await loadLibrary();
      } else if (a === 'open-lyrics') {
        (document.querySelector('#sc-overlay-rail .sc-nav-item[data-target="lyrics"]') as HTMLElement | null)?.click();
      } else if (a === 'copy' && result) {
        await navigator.clipboard.writeText(result.lrc);
        window.__scToast?.(tr('copied'));
      } else if (a === 'lib-show') {
        const e2 = await api.lsyncGet(b.dataset.id);
        if (e2) {
          await api.lyricsPref('setChoice', e2.key, { lyrics: e2.lines.map((l: any) => l.text).join('\n'), syncedLyrics: e2.lrc, source: 'sixteen' });
          window.__scLyricsRefresh?.();
          window.__scToast?.(tr('applied'));
          const np = nowPlaying();
          if (np && np.key === e2.key) (document.querySelector('#sc-overlay-rail .sc-nav-item[data-target="lyrics"]') as HTMLElement | null)?.click();
        }
      } else if (a === 'lib-del') {
        const ent = library.find((x) => x.id === b.dataset.id);
        if (!confirm(tr('confirm_del', { t: ent ? ent.title : '' }))) return;
        library = await api.lsyncDelete(b.dataset.id) || [];
        window.__scLyricsRefresh?.();
        renderLibrary();
      }
    } catch (err: any) {
      window.__scToast?.(String(err?.message || err));
    }
  });
  $('lsx-find').addEventListener('click', () => { void findTexts(); });
  $('lsx-q-go').addEventListener('click', () => { void findTexts($<HTMLInputElement>('lsx-q').value.trim()); });
  $<HTMLInputElement>('lsx-q').addEventListener('keydown', (e) => { if (e.key === 'Enter') void findTexts($<HTMLInputElement>('lsx-q').value.trim()); });
  ta.addEventListener('input', scheduleCheck);

  // ---- events from the main process ----
  let pending: Track | FileTrack | null = null;
  let lastSpeedT = 0;
  api.onLsyncEvent((ev: any) => {
    if (!ev || typeof ev !== 'object') return;
    if (ev.kind === 'install') {
      if (status) status.install = { packs: status.install?.packs || [], done: ev.done, total: ev.total, speed: ev.speed };
      if (Date.now() - lastSpeedT > 1000 && ev.speed > 0) { installSpeed = installSpeed ? installSpeed * 0.7 + ev.speed * 0.3 : ev.speed; lastSpeedT = Date.now(); }
      if (!status?.install?.packs.length) void refreshStatus(); else { renderModels(); railDot(); }
    } else if (ev.kind === 'install-done') {
      installSpeed = 0; installErr = null; void refreshStatus().then(() => renderRun());
    } else if (ev.kind === 'install-error') {
      installSpeed = 0; installErr = { code: ev.code, message: ev.message, need: ev.need, free: ev.free }; void refreshStatus();
    } else if (ev.kind === 'job') {
      job = { id: ev.id, stage: ev.stage, overall: ev.overall, elapsed: ev.elapsed, note: ev.note || job?.note };
      renderRun(); railDot();
    } else if (ev.kind === 'job-done') {
      const t = pending;
      result = {
        id: ev.id, res: ev.result, lrc: ev.lrc, lang: ev.lang, title: ev.title, artist: ev.artist, took: job?.elapsed || 0,
        key: t ? t.key : `${ev.artist}|${ev.title}`.toLowerCase(), url: t && t.kind === 'sc' ? t.url : undefined, saved: false,
      };
      job = null; jobErr = null;
      renderAll();
    } else if (ev.kind === 'job-error') {
      job = null; jobErr = { code: ev.code, message: ev.message };
      renderTrack(); renderRun(); railDot();
    }
  });

  // ---- language, first paint, light polling while visible ----
  api.storeGet('language').then((lang: unknown) => {
    L = lang === 'ru' ? STR.ru : STR.en;
    staticTexts(); renderAll();
  }).catch(() => { staticTexts(); renderAll(); });
  staticTexts();
  void refreshStatus().then(() => renderAll());
  void loadLibrary();
  window.setInterval(() => {
    if (document.hidden || !root.classList.contains('active')) return;
    if (!job) renderTrack();
    if (job) { job.elapsed += 1; renderRun(); }
  }, 1000);
  new MutationObserver(() => { if (root.classList.contains('active')) { void refreshStatus(); renderTrack(); renderRun(); } })
    .observe(root, { attributes: true, attributeFilter: ['class'] });
}

install();
export {};

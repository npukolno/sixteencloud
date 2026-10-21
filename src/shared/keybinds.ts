export const KEYBIND_ACTIONS = ['sidebar', 'playPause', 'volumeUp', 'volumeDown', 'miniPlayer'] as const;
export type KeybindAction = (typeof KEYBIND_ACTIONS)[number];

export type Keybinds = Partial<Record<KeybindAction, string>>;

export interface KeyInput {
  code: string;
  key: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

interface ParsedCombo {
  code: string;
  control: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

const MODIFIERS = new Set(['ctrl', 'control', 'alt', 'shift', 'meta', 'cmd', 'command', 'super', 'win']);

const DEFAULT_CODES: Record<KeybindAction, string> = {
  sidebar: 'Ctrl+KeyB',
  playPause: 'Space',
  volumeUp: 'Ctrl+ArrowUp',
  volumeDown: 'Ctrl+ArrowDown',
  miniPlayer: 'Ctrl+KeyP',
};

const KEY_LABELS: Record<string, string> = {
  Space: 'Space',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Tab: 'Tab',
  Minus: '-',
  Equal: '=',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backquote: '`',
};

function normalizeToken(token: string): string {
  const lower = token.toLowerCase();
  if (lower === 'ctrl' || lower === 'control') return 'control';
  if (lower === 'cmd' || lower === 'command' || lower === 'meta' || lower === 'super' || lower === 'win') return 'meta';
  if (lower === 'alt' || lower === 'option') return 'alt';
  if (lower === 'shift') return 'shift';
  return token;
}

const SUPPORTED_CODE = /^(Key[A-Z]|Digit[0-9]|F([1-9]|1[0-9]|2[0-4])|Arrow(Up|Down|Left|Right)|Space|Enter|Escape|Backspace|Tab|Home|End|PageUp|PageDown|Insert|Delete|Minus|Equal|Comma|Period|Slash|Backslash|Semicolon|Quote|BracketLeft|BracketRight|Backquote|Numpad[0-9]|Numpad(Add|Subtract|Multiply|Divide|Enter|Decimal))$/;

export function parseCombo(combo: string): ParsedCombo | null {
  if (typeof combo !== 'string' || !combo.trim()) return null;
  const parts = combo.split('+').map(p => p.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  const result: ParsedCombo = { code: '', control: false, alt: false, shift: false, meta: false };
  for (const part of parts) {
    const token = normalizeToken(part);
    if (MODIFIERS.has(part.toLowerCase()) || ['control', 'meta', 'alt', 'shift'].includes(token)) {
      if (token === 'control') result.control = true;
      else if (token === 'meta') result.meta = true;
      else if (token === 'alt') result.alt = true;
      else if (token === 'shift') result.shift = true;
    } else {
      result.code = part;
    }
  }
  return result.code && SUPPORTED_CODE.test(result.code) ? result : null;
}

export function matchesCombo(combo: string, input: KeyInput): boolean {
  const parsed = parseCombo(combo);
  if (!parsed) return false;
  return parsed.code === input.code &&
    parsed.control === input.control &&
    parsed.alt === input.alt &&
    parsed.shift === input.shift &&
    parsed.meta === input.meta;
}

export function isModifierKey(code: string): boolean {
  return code === 'ControlLeft' || code === 'ControlRight' ||
    code === 'AltLeft' || code === 'AltRight' ||
    code === 'ShiftLeft' || code === 'ShiftRight' ||
    code === 'MetaLeft' || code === 'MetaRight';
}

export function formatKeyLabel(code: string, key: string): string {
  if (KEY_LABELS[code]) return KEY_LABELS[code];
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return `Num ${code.slice(6)}`;
  if (/^F[0-9]{1,2}$/.test(code)) return code;
  return key && key.length <= 3 ? key.toUpperCase() : code;
}

export function formatCombo(input: KeyInput, platform: NodeJS.Platform = 'linux'): string | null {
  if (isModifierKey(input.code)) return null;
  const parts: string[] = [];
  if (input.control) parts.push('Ctrl');
  if (input.alt) parts.push(platform === 'darwin' ? 'Option' : 'Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push(platform === 'darwin' ? 'Cmd' : 'Meta');
  parts.push(formatKeyLabel(input.code, input.key));
  return parts.join('+');
}

export function defaultKeybinds(platform: NodeJS.Platform = 'linux'): Record<KeybindAction, string> {
  return {
    ...DEFAULT_CODES,
    miniPlayer: platform === 'darwin' ? 'Meta+KeyP' : DEFAULT_CODES.miniPlayer,
  };
}

export function resolveKeybinds(stored: unknown, platform: NodeJS.Platform = 'linux'): Record<KeybindAction, string> {
  const defaults = defaultKeybinds(platform);
  if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return defaults;
  const result = { ...defaults };
  for (const action of KEYBIND_ACTIONS) {
    const value = (stored as Record<string, unknown>)[action];
    if (typeof value === 'string' && parseCombo(value)) result[action] = value;
  }
  return result;
}

/** Display label for a stored combo, used by the settings panel. */
export function comboLabel(combo: string): string {
  const parsed = parseCombo(combo);
  if (!parsed) return combo;
  const parts: string[] = [];
  if (parsed.control) parts.push('Ctrl');
  if (parsed.alt) parts.push('Alt');
  if (parsed.shift) parts.push('Shift');
  if (parsed.meta) parts.push('Meta');
  parts.push(formatKeyLabel(parsed.code, parsed.code));
  return parts.join('+');
}

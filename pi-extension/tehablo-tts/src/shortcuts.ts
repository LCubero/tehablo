// Keyboard shortcuts for the TTS actions, read from raw terminal input (legacy or kitty sequences).
// A shortcut is Ctrl and/or Alt plus a letter or digit, written like Pi's key ids: "ctrl+alt+p".
const MODS = ['ctrl', 'alt', 'shift'];
// Ctrl+H, Ctrl+I, Ctrl+J and Ctrl+M are the same bytes as Backspace, Tab, newline and Enter.
const RESERVED = new Set([8, 9, 10, 13]);

const canonical = (mods: string[], key: string) => [...MODS.filter(m => mods.includes(m)), key].join('+');

/** The shortcut a key press produces, or '' when it cannot be a shortcut. */
export function keyOf(data: string): string {
  const kitty = /^\x1b\[(\d+)(?::\d+)*;(\d+)(?::(\d))?u$/.exec(data);
  if (kitty) {
    if (kitty[3] === '3') return '';
    const bits = Number(kitty[2]) - 1, key = String.fromCodePoint(Number(kitty[1])).toLowerCase();
    const mods = [bits & 4 ? 'ctrl' : '', bits & 2 ? 'alt' : '', bits & 1 ? 'shift' : ''].filter(Boolean);
    return /^[a-z0-9]$/.test(key) && (mods.includes('ctrl') || mods.includes('alt')) ? canonical(mods, key) : '';
  }
  const alt = data.length === 2 && data[0] === '\x1b';
  const ch = alt ? data[1] : data.length === 1 ? data : '';
  if (!ch) return '';
  const code = ch.charCodeAt(0);
  if (code >= 1 && code <= 26 && !RESERVED.has(code)) return canonical(alt ? ['ctrl', 'alt'] : ['ctrl'], String.fromCharCode(code + 96));
  if (alt && /^[a-z0-9]$/.test(ch)) return canonical(['alt'], ch);
  return '';
}

export function label(key: string | undefined): string {
  return key ? key.split('+').map(p => p[0].toUpperCase() + p.slice(1)).join('+') : '(sin atajo)';
}

/** Whether Pi already binds this combination (any modifier order). */
export function usedByPi(keybindings: {getResolvedBindings?: () => Record<string, string | string[] | undefined>}, key: string): boolean {
  const bindings = keybindings.getResolvedBindings?.() ?? {};
  const normal = (id: string) => { const parts = id.toLowerCase().split('+'); return canonical(parts.slice(0, -1), parts.at(-1)!); };
  return Object.values(bindings).some(keys => [keys ?? []].flat().some(k => normal(k) === key));
}

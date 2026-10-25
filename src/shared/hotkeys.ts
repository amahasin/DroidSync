/**
 * Keyboard shortcut text in Electron's accelerator format ("Ctrl+Alt+S"), shared by the settings
 * screen (which builds it from a key press) and the main process (which checks it and registers it).
 */

const MODIFIER_ORDER = ['Ctrl', 'Alt', 'Shift', 'Super'] as const
type Modifier = (typeof MODIFIER_ORDER)[number]

const MODIFIER_NAMES: Record<string, Modifier> = {
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
  super: 'Super',
  meta: 'Super',
  win: 'Super',
  windows: 'Super',
  cmd: 'Super',
  command: 'Super'
}

const NAMED_KEYS: Record<string, string> = {
  space: 'Space',
  tab: 'Tab',
  enter: 'Enter',
  return: 'Enter',
  backspace: 'Backspace',
  delete: 'Delete',
  insert: 'Insert',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
  up: 'Up',
  down: 'Down',
  left: 'Left',
  right: 'Right',
  plus: 'Plus',
  esc: 'Esc',
  escape: 'Esc',
  printscreen: 'PrintScreen'
}

const PUNCTUATION = new Set(['-', '=', '[', ']', ';', "'", ',', '.', '/', '\\', '`'])

/** The one non-modifier key of an accelerator, in canonical spelling, or null if unusable. */
function canonicalKey(raw: string): string | null {
  if (/^[a-z]$/i.test(raw)) return raw.toUpperCase()
  if (/^[0-9]$/.test(raw)) return raw
  const f = /^f([1-9]|1\d|2[0-4])$/i.exec(raw)
  if (f) return `F${f[1]}`
  if (PUNCTUATION.has(raw)) return raw
  return NAMED_KEYS[raw.toLowerCase()] ?? null
}

/**
 * Canonical form of an accelerator, or null when it is not usable as a global shortcut:
 * it needs one ordinary key and at least Ctrl, Alt or Super (Shift alone would swallow typing).
 */
export function normalizeAccelerator(text: unknown): string | null {
  if (typeof text !== 'string' || text.length === 0 || text.length > 40) return null
  const parts = text.split('+').map((part) => part.trim())
  // "Ctrl++" is the plus key.
  if (text.endsWith('++')) parts.splice(parts.length - 2, 2, '+')
  if (parts.some((part) => part === '')) return null

  const modifiers = new Set<Modifier>()
  let key: string | null = null
  for (const part of parts) {
    const modifier = MODIFIER_NAMES[part.toLowerCase()]
    if (modifier) {
      modifiers.add(modifier)
      continue
    }
    if (key !== null) return null
    key = canonicalKey(part === '+' ? 'plus' : part)
    if (key === null) return null
  }
  if (key === null) return null
  if (!modifiers.has('Ctrl') && !modifiers.has('Alt') && !modifiers.has('Super')) return null
  return [...MODIFIER_ORDER.filter((m) => modifiers.has(m)), key].join('+')
}

export const isValidAccelerator = (text: unknown): boolean => normalizeAccelerator(text) !== null

export interface KeyPress {
  key: string
  code: string
  ctrlKey: boolean
  altKey: boolean
  shiftKey: boolean
  metaKey: boolean
}

const CODE_KEYS: Record<string, string> = {
  Space: 'Space',
  Tab: 'Tab',
  Enter: 'Enter',
  NumpadEnter: 'Enter',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Insert: 'Insert',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backslash: '\\',
  Backquote: '`',
  PrintScreen: 'PrintScreen'
}

/**
 * The accelerator a key press spells, from the physical key (so the keyboard layout does not matter),
 * or null while only modifier keys are down. The result is not yet checked: use normalizeAccelerator.
 */
export function acceleratorFromKeyPress(press: KeyPress): string | null {
  let key: string | null
  const letter = /^Key([A-Z])$/.exec(press.code)
  const digit = /^(?:Digit|Numpad)([0-9])$/.exec(press.code)
  if (letter) key = letter[1]
  else if (digit) key = digit[1]
  else if (/^F([1-9]|1\d|2[0-4])$/.test(press.code)) key = press.code
  else key = CODE_KEYS[press.code] ?? null
  if (key === null) return null

  const parts: string[] = []
  if (press.ctrlKey) parts.push('Ctrl')
  if (press.altKey) parts.push('Alt')
  if (press.shiftKey) parts.push('Shift')
  if (press.metaKey) parts.push('Super')
  return [...parts, key].join('+')
}

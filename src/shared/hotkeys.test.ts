import { describe, expect, it } from 'vitest'
import { acceleratorFromKeyPress, isValidAccelerator, normalizeAccelerator } from './hotkeys'

const press = (
  code: string,
  mods: Partial<Record<string, boolean>> = {}
): Parameters<typeof acceleratorFromKeyPress>[0] => ({
  key: '',
  code,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  metaKey: false,
  ...mods
})

describe('normalizeAccelerator', () => {
  it('gives one canonical spelling', () => {
    expect(normalizeAccelerator('ctrl+alt+s')).toBe('Ctrl+Alt+S')
    expect(normalizeAccelerator('Alt+Control+S')).toBe('Ctrl+Alt+S')
    expect(normalizeAccelerator('shift + ctrl + f5')).toBe('Ctrl+Shift+F5')
    expect(normalizeAccelerator('Win+Esc')).toBe('Super+Esc')
    expect(normalizeAccelerator('Ctrl+Alt+Up')).toBe('Ctrl+Alt+Up')
    expect(normalizeAccelerator('Ctrl+Alt+,')).toBe('Ctrl+Alt+,')
  })

  it('accepts the plus key', () => {
    expect(normalizeAccelerator('Ctrl+Alt++')).toBe('Ctrl+Alt+Plus')
    expect(normalizeAccelerator('ctrl+plus')).toBe('Ctrl+Plus')
  })

  it('needs Ctrl, Alt or Super, so typing is not swallowed', () => {
    expect(normalizeAccelerator('S')).toBeNull()
    expect(normalizeAccelerator('Shift+S')).toBeNull()
    expect(normalizeAccelerator('F5')).toBeNull()
  })

  it('needs exactly one ordinary key', () => {
    expect(normalizeAccelerator('Ctrl+Alt')).toBeNull()
    expect(normalizeAccelerator('Ctrl+A+B')).toBeNull()
    expect(normalizeAccelerator('Ctrl+Nonsense')).toBeNull()
    expect(normalizeAccelerator('Ctrl+')).toBeNull()
    expect(normalizeAccelerator('+Ctrl+A')).toBeNull()
  })

  it('rejects non-strings, empty and very long text', () => {
    for (const bad of [undefined, null, 5, '', {}, 'Ctrl+'.repeat(20) + 'A']) {
      expect(isValidAccelerator(bad)).toBe(false)
    }
  })

  it('knows the function key range', () => {
    expect(normalizeAccelerator('Ctrl+F24')).toBe('Ctrl+F24')
    expect(normalizeAccelerator('Ctrl+F25')).toBeNull()
    expect(normalizeAccelerator('Ctrl+F0')).toBeNull()
  })
})

describe('acceleratorFromKeyPress', () => {
  it('uses the physical key and lists modifiers in a fixed order', () => {
    expect(acceleratorFromKeyPress(press('KeyS', { altKey: true, ctrlKey: true }))).toBe(
      'Ctrl+Alt+S'
    )
    expect(acceleratorFromKeyPress(press('Digit5', { ctrlKey: true, shiftKey: true }))).toBe(
      'Ctrl+Shift+5'
    )
    expect(acceleratorFromKeyPress(press('F9', { altKey: true }))).toBe('Alt+F9')
    expect(acceleratorFromKeyPress(press('ArrowLeft', { ctrlKey: true, altKey: true }))).toBe(
      'Ctrl+Alt+Left'
    )
    expect(acceleratorFromKeyPress(press('Backquote', { ctrlKey: true }))).toBe('Ctrl+`')
    expect(acceleratorFromKeyPress(press('Numpad3', { ctrlKey: true }))).toBe('Ctrl+3')
  })

  it('returns null while only modifiers are held, or for keys with no name', () => {
    expect(acceleratorFromKeyPress(press('ControlLeft', { ctrlKey: true }))).toBeNull()
    expect(acceleratorFromKeyPress(press('ShiftRight', { shiftKey: true }))).toBeNull()
    expect(acceleratorFromKeyPress(press('AudioVolumeUp'))).toBeNull()
  })

  it('produces text that normalizes to itself when it is usable', () => {
    const text = acceleratorFromKeyPress(
      press('KeyP', { ctrlKey: true, altKey: true, shiftKey: true })
    )
    expect(normalizeAccelerator(text)).toBe(text)
  })
})

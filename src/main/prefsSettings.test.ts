import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore } from './settings'

describe('SettingsStore app preferences', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'droidsync-prefs-'))
    file = join(dir, 'nested', 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('starts with everything off', () => {
    const state = new SettingsStore(file).snapshot
    expect(state.closeToTray).toBe(false)
    expect(state.preferManagedScrcpy).toBe(false)
    expect(state.hotkeys).toEqual({ showWindow: null, stopAll: null, screenshot: null })
  })

  it('saves the two switches and reloads them', () => {
    const store = new SettingsStore(file)
    store.setCloseToTray(true)
    store.setPreferManagedScrcpy(true)
    const again = new SettingsStore(file).snapshot
    expect(again.closeToTray).toBe(true)
    expect(again.preferManagedScrcpy).toBe(true)
    store.setCloseToTray('yes')
    expect(store.snapshot.closeToTray).toBe(false)
  })

  describe('hotkeys', () => {
    it('stores the canonical form and clears with null', () => {
      const store = new SettingsStore(file)
      expect(store.setHotkey('screenshot', 'alt+control+s')).toEqual({ ok: true })
      expect(store.snapshot.hotkeys.screenshot).toBe('Ctrl+Alt+S')
      expect(store.setHotkey('screenshot', null)).toEqual({ ok: true })
      expect(store.snapshot.hotkeys.screenshot).toBeNull()
    })

    it('rejects unknown actions and unusable shortcuts', () => {
      const store = new SettingsStore(file)
      expect(store.setHotkey('format', 'Ctrl+Alt+S').ok).toBe(false)
      expect(store.setHotkey('screenshot', 'S').ok).toBe(false)
      expect(store.setHotkey('screenshot', 'Shift+S').ok).toBe(false)
      expect(store.setHotkey('screenshot', 42).ok).toBe(false)
      expect(store.snapshot.hotkeys.screenshot).toBeNull()
    })

    it('does not let two actions share a shortcut', () => {
      const store = new SettingsStore(file)
      store.setHotkey('stopAll', 'Ctrl+Alt+X')
      const result = store.setHotkey('screenshot', 'ctrl+alt+x')
      expect(result.ok).toBe(false)
      expect(store.setHotkey('stopAll', 'Ctrl+Alt+X').ok).toBe(true)
    })

    it('drops damaged or duplicate shortcuts when loading', () => {
      mkdirSync(dirname(file), { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({
          version: 2,
          presets: [],
          hotkeys: { showWindow: 'Ctrl+Alt+H', stopAll: 'ctrl+alt+h', screenshot: 'nonsense' }
        })
      )
      const { hotkeys } = new SettingsStore(file).snapshot
      expect(hotkeys).toEqual({ showWindow: 'Ctrl+Alt+H', stopAll: null, screenshot: null })
      expect(JSON.parse(readFileSync(file, 'utf8')).hotkeys.stopAll).toBe('ctrl+alt+h')
    })
  })

  it('finds a preset by id', () => {
    const store = new SettingsStore(file)
    expect(store.presetById('default')?.name).toBe('Default')
    expect(store.presetById('missing')).toBeUndefined()
  })
})

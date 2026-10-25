import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_PRESET_ID, type Preset, type SettingsState } from '../shared/models'
import { SettingsStore } from './settings'

describe('SettingsStore', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'droidsync-settings-'))
    file = join(dir, 'nested', 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const named = (state: SettingsState, name: string): Preset =>
    state.presets.find((p) => p.name === name)!

  describe('first run', () => {
    it('has an empty Default preset first, then the starter presets', () => {
      const { presets } = new SettingsStore(file).snapshot
      expect(presets[0]).toEqual({ id: DEFAULT_PRESET_ID, name: 'Default', options: {} })
      expect(presets.map((p) => p.name)).toEqual([
        'Default',
        'Low bandwidth',
        'Presentation',
        'Screen off',
        'View only'
      ])
      expect(new Set(presets.map((p) => p.id)).size).toBe(presets.length)
    })

    it('does not write a file until something changes', () => {
      new SettingsStore(file)
      expect(existsSync(file)).toBe(false)
    })
  })

  describe('persistence', () => {
    it('saves and reloads presets and device choices', () => {
      const store = new SettingsStore(file)
      const created = store.createPreset('Gaming', { maxFps: 120, bogus: 1 })
      expect(created.ok).toBe(true)
      store.setDevicePreset('SERIAL1', created.id)

      const reloaded = new SettingsStore(file).snapshot
      expect(named(reloaded, 'Gaming').options).toEqual({ maxFps: 120 })
      expect(reloaded.devicePresets).toEqual({ SERIAL1: created.id })
      expect(existsSync(`${file}.tmp`)).toBe(false)
      expect(JSON.parse(readFileSync(file, 'utf8')).version).toBe(2)
    })

    it('falls back to a bare Default for a damaged file', () => {
      mkdirSync(join(dir, 'nested'), { recursive: true })
      writeFileSync(file, '{ not json', 'utf8')
      expect(new SettingsStore(file).snapshot.presets).toEqual([
        { id: DEFAULT_PRESET_ID, name: 'Default', options: {} }
      ])
    })

    it('migrates a version 1 file into the Default preset', () => {
      mkdirSync(join(dir, 'nested'), { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({ version: 1, options: { maxSize: 800, stayAwake: true, bogus: 2 } })
      )
      const state = new SettingsStore(file).snapshot
      expect(state.presets).toEqual([
        { id: DEFAULT_PRESET_ID, name: 'Default', options: { maxSize: 800, stayAwake: true } }
      ])
    })

    it('repairs a version 2 file: drops dangling device choices and bad presets', () => {
      mkdirSync(join(dir, 'nested'), { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({
          version: 2,
          presets: [
            { id: 'a', name: 'A', options: { noAudio: true } },
            { id: 'a', name: 'Duplicate id', options: {} },
            { id: 5, name: 'Bad id' },
            { id: DEFAULT_PRESET_ID, name: 'Renamed default', options: { maxSize: 640 } }
          ],
          devicePresets: { S1: 'a', S2: 'gone', S3: DEFAULT_PRESET_ID }
        })
      )
      const state = new SettingsStore(file).snapshot
      expect(state.presets.map((p) => [p.id, p.name])).toEqual([
        [DEFAULT_PRESET_ID, 'Default'],
        ['a', 'A']
      ])
      expect(state.devicePresets).toEqual({ S1: 'a' })
    })
  })

  describe('presets', () => {
    it('rejects empty, long and duplicate names', () => {
      const store = new SettingsStore(file)
      expect(store.createPreset('   ')).toMatchObject({ ok: false })
      expect(store.createPreset('x'.repeat(41))).toMatchObject({ ok: false })
      expect(store.createPreset('view only')).toMatchObject({
        ok: false,
        error: 'A preset with that name already exists.'
      })
      expect(store.createPreset(42)).toMatchObject({ ok: false })
    })

    it('renames, edits and deletes, but never the Default preset', () => {
      const store = new SettingsStore(file)
      const { id } = store.createPreset('Mine', {})
      expect(store.renamePreset(id, 'Mine 2')).toEqual({ ok: true })
      expect(store.renamePreset(id, 'View only')).toMatchObject({ ok: false })
      expect(store.setPresetOptions(id, { noAudio: true })).toEqual({ ok: true })
      expect(named(store.snapshot, 'Mine 2').options).toEqual({ noAudio: true })

      expect(store.renamePreset(DEFAULT_PRESET_ID, 'Other')).toMatchObject({ ok: false })
      expect(store.deletePreset(DEFAULT_PRESET_ID)).toMatchObject({ ok: false })
      expect(store.setPresetOptions(DEFAULT_PRESET_ID, { maxSize: 800 })).toEqual({ ok: true })

      expect(store.deletePreset(id)).toEqual({ ok: true })
      expect(store.deletePreset(id)).toMatchObject({ ok: false })
    })

    it('duplicates with a unique name and the same options', () => {
      const store = new SettingsStore(file)
      const first = store.duplicatePreset(named(store.snapshot, 'View only').id)
      const second = store.duplicatePreset(named(store.snapshot, 'View only').id)
      expect(first.ok && second.ok).toBe(true)
      const names = store.snapshot.presets.map((p) => p.name)
      expect(names).toContain('View only copy')
      expect(names).toContain('View only copy 2')
      expect(named(store.snapshot, 'View only copy').options).toEqual({
        noControl: true,
        noAudio: true
      })
    })

    it('does not hand out its internal state', () => {
      const store = new SettingsStore(file)
      const snapshot = store.snapshot
      snapshot.presets[0].options['maxSize'] = 1
      expect(store.snapshot.presets[0].options).toEqual({})
    })
  })

  describe('device presets', () => {
    it('uses the device choice, else Default', () => {
      const store = new SettingsStore(file)
      const { id } = store.createPreset('Gaming', { maxFps: 120 })
      store.setPresetOptions(DEFAULT_PRESET_ID, { maxSize: 800 })
      store.setDevicePreset('S1', id)
      expect(store.presetFor('S1').name).toBe('Gaming')
      expect(store.presetFor('S2').id).toBe(DEFAULT_PRESET_ID)
    })

    it('clears the choice with null or the Default id, and when the preset is deleted', () => {
      const store = new SettingsStore(file)
      const { id } = store.createPreset('Gaming', {})
      store.setDevicePreset('S1', id)
      store.setDevicePreset('S1', null)
      expect(store.snapshot.devicePresets).toEqual({})

      store.setDevicePreset('S1', id)
      store.setDevicePreset('S2', id)
      store.setDevicePreset('S2', DEFAULT_PRESET_ID)
      store.deletePreset(id)
      expect(store.snapshot.devicePresets).toEqual({})
    })

    it('rejects unknown presets and invalid serials', () => {
      const store = new SettingsStore(file)
      expect(store.setDevicePreset('S1', 'nope')).toMatchObject({ ok: false })
      expect(store.setDevicePreset('', null)).toMatchObject({ ok: false })
      expect(store.setDevicePreset(5, null)).toMatchObject({ ok: false })
    })
  })

  describe('remembered wireless devices', () => {
    it('starts empty with auto-reconnect on', () => {
      const state = new SettingsStore(file).snapshot
      expect(state.wireless).toEqual([])
      expect(state.autoReconnect).toBe(true)
    })

    it('remembers, refreshes the name, and forgets', () => {
      const store = new SettingsStore(file)
      expect(store.rememberDevice('192.168.1.5:5555')).toEqual({ ok: true })
      expect(store.snapshot.wireless).toEqual([{ address: '192.168.1.5:5555', name: null }])
      store.rememberDevice('192.168.1.5:5555', ' Pixel 7 ')
      store.rememberDevice('192.168.1.5:5555')
      expect(store.snapshot.wireless).toEqual([{ address: '192.168.1.5:5555', name: 'Pixel 7' }])
      expect(store.forgetDevice('192.168.1.5:5555')).toEqual({ ok: true })
      expect(store.forgetDevice('192.168.1.5:5555')).toMatchObject({ ok: false })
    })

    it('rejects addresses that are not host:port', () => {
      const store = new SettingsStore(file)
      for (const bad of [
        '192.168.1.5',
        'a b:5555',
        '192.168.1.5:',
        'x:y',
        42,
        '',
        '1.2.3.4:5555\n'
      ]) {
        expect(store.rememberDevice(bad), String(bad)).toMatchObject({ ok: false })
      }
    })

    it('moves a device to a new address, merging with an existing entry', () => {
      const store = new SettingsStore(file)
      store.rememberDevice('192.168.1.5:5555', 'Pixel')
      expect(store.moveRememberedDevice('192.168.1.5:5555', '192.168.1.5:37045')).toEqual({
        ok: true
      })
      expect(store.snapshot.wireless).toEqual([{ address: '192.168.1.5:37045', name: 'Pixel' }])
      store.rememberDevice('192.168.1.5:5555')
      store.moveRememberedDevice('192.168.1.5:5555', '192.168.1.5:37045')
      expect(store.snapshot.wireless.map((d) => d.address)).toEqual(['192.168.1.5:37045'])
      expect(store.moveRememberedDevice('nope:1', '1.2.3.4:5')).toMatchObject({ ok: false })
    })

    it('toggles auto-reconnect and persists everything', () => {
      const store = new SettingsStore(file)
      store.rememberDevice('10.0.0.2:5555', 'TV')
      store.setAutoReconnect(false)
      const reloaded = new SettingsStore(file).snapshot
      expect(reloaded.autoReconnect).toBe(false)
      expect(reloaded.wireless).toEqual([{ address: '10.0.0.2:5555', name: 'TV' }])
    })

    it('limits how many devices are remembered', () => {
      const store = new SettingsStore(file)
      for (let i = 0; i < 50; i++) store.rememberDevice(`10.0.0.${i}:5555`)
      expect(store.rememberDevice('10.0.1.1:5555')).toMatchObject({ ok: false })
    })

    it('repairs a damaged wireless list on load', () => {
      mkdirSync(join(dir, 'nested'), { recursive: true })
      writeFileSync(
        file,
        JSON.stringify({
          version: 2,
          presets: [],
          wireless: [
            { address: '10.0.0.2:5555', name: 'TV' },
            { address: '10.0.0.2:5555', name: 'Dup' },
            { address: 'bad address', name: 'x' },
            { address: 5 },
            'junk'
          ],
          autoReconnect: 'yes'
        })
      )
      const state = new SettingsStore(file).snapshot
      expect(state.wireless).toEqual([{ address: '10.0.0.2:5555', name: 'TV' }])
      expect(state.autoReconnect).toBe(true)
    })
  })

  it('notifies listeners only after a successful change', () => {
    const store = new SettingsStore(file)
    const seen: number[] = []
    store.onChange((state) => seen.push(state.presets.length))
    store.createPreset('')
    store.createPreset('Extra')
    expect(seen).toEqual([6])
  })
})

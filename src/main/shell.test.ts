import { describe, expect, it } from 'vitest'
import type { Device, Preset, SessionInfo } from '../shared/models'
import { getAutostart, HIDDEN_ARG, setAutostart, type LoginItemApp } from './autostart'
import { HotkeyService, type HotkeyBackend } from './hotkeys'
import { buildTrayMenu, trayTooltip, type TrayItem } from './trayMenu'

describe('HotkeyService', () => {
  function setup(taken: string[] = []): {
    service: HotkeyService
    registered: Map<string, () => void>
    calls: string[]
    fired: string[]
  } {
    const registered = new Map<string, () => void>()
    const calls: string[] = []
    const backend: HotkeyBackend = {
      register: (accelerator, callback) => {
        calls.push(`+${accelerator}`)
        if (taken.includes(accelerator) || registered.has(accelerator)) return false
        registered.set(accelerator, callback)
        return true
      },
      unregister: (accelerator) => {
        calls.push(`-${accelerator}`)
        registered.delete(accelerator)
      }
    }
    const fired: string[] = []
    const service = new HotkeyService(backend, {
      showWindow: () => fired.push('show'),
      stopAll: () => fired.push('stop'),
      screenshot: () => fired.push('shot')
    })
    return { service, registered, calls, fired }
  }
  const none = { showWindow: null, stopAll: null, screenshot: null }

  it('registers shortcuts and calls the right action', () => {
    const s = setup()
    expect(s.service.apply({ ...none, stopAll: 'ctrl+alt+x' })).toEqual({})
    s.registered.get('Ctrl+Alt+X')?.()
    expect(s.fired).toEqual(['stop'])
  })

  it('does nothing for unchanged shortcuts and releases removed ones', () => {
    const s = setup()
    s.service.apply({ ...none, stopAll: 'Ctrl+Alt+X' })
    s.calls.length = 0
    s.service.apply({ ...none, stopAll: 'Ctrl+Alt+X' })
    expect(s.calls).toEqual([])
    s.service.apply(none)
    expect(s.calls).toEqual(['-Ctrl+Alt+X'])
    expect(s.registered.size).toBe(0)
  })

  it('reports a shortcut another program holds, and keeps the rest working', () => {
    const s = setup(['Ctrl+Alt+X'])
    const problems = s.service.apply({ ...none, stopAll: 'Ctrl+Alt+X', screenshot: 'Ctrl+Alt+S' })
    expect(problems).toEqual({ stopAll: 'Another program already uses this shortcut.' })
    expect(s.registered.has('Ctrl+Alt+S')).toBe(true)
    expect(s.service.status).toEqual(problems)
  })

  it('lets a shortcut move from one action to another in one change', () => {
    const s = setup()
    s.service.apply({ ...none, stopAll: 'Ctrl+Alt+X' })
    expect(s.service.apply({ ...none, screenshot: 'Ctrl+Alt+X' })).toEqual({})
    s.registered.get('Ctrl+Alt+X')?.()
    expect(s.fired).toEqual(['shot'])
  })

  it('ignores accelerators that are not usable, and releases everything on dispose', () => {
    const s = setup()
    s.service.apply({ ...none, showWindow: 'S', stopAll: 'Ctrl+Alt+X' })
    expect(s.registered.size).toBe(1)
    s.service.dispose()
    expect(s.registered.size).toBe(0)
  })
})

describe('buildTrayMenu', () => {
  const device = (
    serial: string,
    state: Device['state'] = 'device',
    model: string | null = serial
  ): Device => ({
    serial,
    state,
    rawState: state,
    connection: 'usb',
    transportId: '1',
    model,
    manufacturer: null,
    androidVersion: null,
    sdk: null
  })
  const session = (serial: string, state: SessionInfo['state'] = 'running'): SessionInfo => ({
    serial,
    state,
    pid: 1,
    startedAt: 0,
    exitCode: null,
    error: null,
    command: ''
  })
  const presets: Preset[] = [
    { id: 'default', name: 'Default', options: {} },
    { id: 'p', name: 'Q&A', options: {} }
  ]
  const labels = (items: TrayItem[]): string[] =>
    items.map((i) => (i.type === 'separator' ? '-' : i.label))

  it('offers Start with a choice of presets, a screenshot, and the fixed entries', () => {
    const items = buildTrayMenu({
      devices: [device('A', 'device', 'Pixel')],
      sessions: [],
      presets,
      canMirror: true
    })
    expect(labels(items)).toEqual([
      'Show DroidSync',
      '-',
      'Start Pixel',
      'Screenshot of Pixel',
      '-',
      'Stop all',
      '-',
      'Quit'
    ])
    const start = items[2]
    expect(start.type).toBe('submenu')
    if (start.type === 'submenu') {
      expect(start.items).toMatchObject([
        { label: 'Default', action: { kind: 'start', serial: 'A', presetId: 'default' } },
        { label: 'Q&&A', action: { kind: 'start', serial: 'A', presetId: 'p' } }
      ])
    }
  })

  it('has a plain Start item when there is only one preset', () => {
    const items = buildTrayMenu({
      devices: [device('A')],
      sessions: [],
      presets: [presets[0]],
      canMirror: true
    })
    expect(items[2]).toMatchObject({
      type: 'item',
      label: 'Start A',
      action: { kind: 'start', serial: 'A' }
    })
  })

  it('shows Stop for a device that is mirroring and counts running sessions', () => {
    const items = buildTrayMenu({
      devices: [device('A'), device('B')],
      sessions: [session('A'), session('B', 'exited')],
      presets: [presets[0]],
      canMirror: true
    })
    expect(labels(items)).toContain('Stop A')
    expect(labels(items)).toContain('Start B')
    expect(items.find((i) => i.type === 'item' && i.label.startsWith('Stop all'))).toMatchObject({
      label: 'Stop all (1)',
      enabled: true
    })
  })

  it('lists only ready devices and disables Start without scrcpy', () => {
    const items = buildTrayMenu({
      devices: [device('A', 'unauthorized')],
      sessions: [],
      presets: [presets[0]],
      canMirror: false
    })
    expect(labels(items)).toContain('No devices ready')
    const ready = buildTrayMenu({
      devices: [device('A')],
      sessions: [],
      presets: [presets[0]],
      canMirror: false
    })
    expect(ready[2]).toMatchObject({ label: 'Start A', enabled: false })
  })

  it('writes the tooltip with the number of mirrors', () => {
    expect(trayTooltip([])).toBe('DroidSync')
    expect(trayTooltip([session('A'), session('B'), session('C', 'exited')])).toBe(
      'DroidSync: 2 mirroring'
    )
  })
})

describe('autostart', () => {
  function fakeApp(isPackaged: boolean): { app: LoginItemApp; calls: unknown[] } {
    let openAtLogin = false
    const calls: unknown[] = []
    const app: LoginItemApp = {
      isPackaged,
      getLoginItemSettings: (options) => {
        calls.push(options)
        return { openAtLogin }
      },
      setLoginItemSettings: (settings) => {
        calls.push(settings)
        openAtLogin = settings.openAtLogin
      }
    }
    return { app, calls }
  }

  it('is only available in an installed build on Windows', () => {
    expect(getAutostart(fakeApp(false).app, 'win32')).toEqual({ supported: false, enabled: false })
    expect(getAutostart(fakeApp(true).app, 'linux')).toEqual({ supported: false, enabled: false })
    expect(getAutostart(fakeApp(true).app, 'win32')).toEqual({ supported: true, enabled: false })
  })

  it('turns on with the hidden flag, so sign-in opens no window', () => {
    const { app, calls } = fakeApp(true)
    expect(setAutostart(app, true, 'win32')).toEqual({ ok: true })
    expect(calls).toContainEqual({ openAtLogin: true, args: [HIDDEN_ARG] })
    expect(getAutostart(app, 'win32').enabled).toBe(true)
    setAutostart(app, false, 'win32')
    expect(getAutostart(app, 'win32').enabled).toBe(false)
  })

  it('refuses in a development build and for non-boolean input', () => {
    const dev = fakeApp(false)
    expect(setAutostart(dev.app, true, 'win32')).toMatchObject({ ok: false })
    expect(dev.calls).toEqual([])
    expect(setAutostart(fakeApp(true).app, 'yes', 'win32')).toMatchObject({ ok: false })
  })
})

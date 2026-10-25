import { describe, expect, it } from 'vitest'
import {
  DEFAULT_PRESET_ID,
  type CaptureEntry,
  type Device,
  type Preset,
  type StartResult
} from '../shared/models'
import { MirrorService, type MirrorDeps } from './mirror'
import type { StartRequest } from './sessions/manager'

const device = (serial: string, overrides: Partial<Device> = {}): Device => ({
  serial,
  state: 'device',
  rawState: 'device',
  connection: 'usb',
  transportId: '1',
  model: `Phone ${serial}`,
  manufacturer: null,
  androidVersion: '14',
  sdk: 34,
  ...overrides
})

interface Setup {
  service: MirrorService
  started: StartRequest[]
  active: Set<string>
  notes: string[]
  pauses: number[]
  captures: CaptureEntry[]
}

function setup(
  options: {
    devices?: Device[]
    presets?: Record<string, Preset>
    presetsById?: Record<string, Preset>
    scrcpyFlags?: string[] | null
    noScrcpy?: boolean
    folders?: string[]
    startOutcome?: (request: StartRequest) => StartResult
  } = {}
): Setup {
  const started: StartRequest[] = []
  const active = new Set<string>()
  const notes: string[] = []
  const pauses: number[] = []
  const captures: CaptureEntry[] = []
  const defaultPreset: Preset = { id: DEFAULT_PRESET_ID, name: 'Default', options: {} }
  const deps: MirrorDeps = {
    tools: {
      state: {
        status: {
          scrcpy: options.noScrcpy
            ? null
            : {
                path: 'C:\\scrcpy.exe',
                version: '5.0.1',
                source: 'path',
                flags: options.scrcpyFlags === undefined ? null : options.scrcpyFlags
              },
          adb: { path: 'C:\\adb.exe', version: '35' },
          managedRoot: 'C:\\managed'
        },
        download: { phase: 'idle', received: 0, total: 0, version: null, error: null }
      }
    },
    devices: {
      snapshot: { adb: 'connected', error: null, devices: options.devices ?? [device('A')] }
    },
    settings: {
      presetFor: (serial) => options.presets?.[serial] ?? defaultPreset,
      presetById: (id) => options.presetsById?.[id],
      addCapture: (entry) => void captures.push(entry)
    },
    sessions: {
      start: (request) => {
        const outcome = options.startOutcome?.(request) ?? { ok: true }
        if (outcome.ok) {
          started.push(request)
          active.add(request.serial)
        }
        return outcome
      },
      stop: async (serial) => void active.delete(serial),
      stopAll: async () => active.clear(),
      isActive: (serial) => active.has(serial),
      note: (_serial, line) => void notes.push(line)
    },
    now: () => new Date(2026, 9, 25, 14, 5, 9),
    folderExists: (folder) => (options.folders ?? ['C:\\Videos']).includes(folder),
    pause: async (ms) => void pauses.push(ms)
  }
  return { service: new MirrorService(deps), started, active, notes, pauses, captures }
}

const preset = (options: Preset['options']): Preset => ({ id: 'p', name: 'P', options })

describe('MirrorService.start', () => {
  it('starts with the preset chosen for that device', () => {
    const s = setup({
      devices: [device('A'), device('B')],
      presets: { B: preset({ maxSize: 800 }) }
    })
    expect(s.service.start('A')).toEqual({ ok: true })
    expect(s.service.start('B')).toEqual({ ok: true })
    expect(s.started[0].args).not.toContain('--max-size=800')
    expect(s.started[1].args).toContain('--max-size=800')
    expect(s.started[1].env).toEqual({ ADB: 'C:\\adb.exe' })
  })

  it('refuses invalid serials, unknown, unready devices and a missing scrcpy', () => {
    expect(setup().service.start(5)).toMatchObject({ ok: false, error: 'Invalid device.' })
    expect(setup().service.start('A"B')).toMatchObject({ ok: false })
    expect(setup().service.start('Z')).toMatchObject({
      ok: false,
      error: expect.stringContaining('not connected')
    })
    expect(
      setup({ devices: [device('A', { state: 'unauthorized' })] }).service.start('A')
    ).toMatchObject({
      ok: false,
      error: expect.stringContaining('not ready')
    })
    expect(setup({ noScrcpy: true }).service.start('A')).toMatchObject({
      ok: false,
      error: expect.stringContaining('not installed')
    })
  })

  it('reports option problems with their labels instead of starting', () => {
    const s = setup({ presets: { A: preset({ maxSize: -1 }) } })
    expect(s.service.start('A')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Max size')
    })
    expect(s.started).toEqual([])
  })

  it('notes options the installed scrcpy does not support', () => {
    const s = setup({
      scrcpyFlags: ['--serial', '--window-title', '--stay-awake'],
      presets: { A: preset({ stayAwake: true, cameraTorch: true }) }
    })
    expect(s.service.start('A')).toEqual({ ok: true })
    expect(s.notes).toEqual(['[gui] Skipped "Torch on": not supported by this scrcpy version.'])
  })

  it('passes a session failure through', () => {
    const s = setup({ startOutcome: () => ({ ok: false, error: 'busy' }) })
    expect(s.service.start('A')).toEqual({ ok: false, error: 'busy' })
  })
})

describe('recording', () => {
  const rec = (record: string): Preset => preset({ record })

  it('fills in {device}, {date} and {time}', () => {
    const s = setup({ presets: { A: rec('C:\\Videos\\{device}-{date}-{time}.mp4') } })
    expect(s.service.start('A')).toEqual({ ok: true })
    expect(s.started[0].args).toContain('--record=C:\\Videos\\Phone_A-2026-10-25-14-05-09.mp4')
  })

  it('refuses a folder that does not exist', () => {
    const s = setup({ presets: { A: rec('D:\\Nope\\x.mp4') } })
    expect(s.service.start('A')).toMatchObject({
      ok: false,
      error: 'The recording folder does not exist: D:\\Nope'
    })
  })

  it('refuses two running devices writing the same file, but allows it once one stopped', async () => {
    const same = rec('C:\\Videos\\out.mp4')
    const s = setup({ devices: [device('A'), device('B')], presets: { A: same, B: same } })
    expect(s.service.start('A')).toEqual({ ok: true })
    expect(s.service.start('B')).toMatchObject({
      ok: false,
      error: expect.stringContaining('{device}')
    })
    await s.service.stop('A')
    expect(s.service.start('B')).toEqual({ ok: true })
  })

  it('gives each device its own file with {device}', () => {
    const tpl = rec('C:\\Videos\\{device}.mp4')
    const s = setup({ devices: [device('A'), device('B')], presets: { A: tpl, B: tpl } })
    expect(s.service.start('A').ok && s.service.start('B').ok).toBe(true)
  })

  it('needs a known extension unless a format is set', () => {
    expect(setup({ presets: { A: rec('C:\\Videos\\out.txt') } }).service.start('A')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Record to file')
    })
    const withFormat = preset({ record: 'C:\\Videos\\out.txt', recordFormat: 'mkv' })
    expect(setup({ presets: { A: withFormat } }).service.start('A')).toEqual({ ok: true })
  })
})

describe('startAll / stopAll', () => {
  it('starts every ready device that is not mirrored yet, pausing between them', async () => {
    const s = setup({
      devices: [device('A'), device('B'), device('C', { state: 'offline' }), device('D')]
    })
    s.service.start('A')
    const result = await s.service.startAll()
    expect(result).toEqual({ started: ['B', 'D'], failed: [] })
    expect(s.pauses).toEqual([300])
  })

  it('reports devices that failed to start and carries on', async () => {
    const s = setup({
      devices: [device('A'), device('B')],
      presets: { A: preset({ maxSize: -1 }) }
    })
    const result = await s.service.startAll()
    expect(result.started).toEqual(['B'])
    expect(result.failed).toHaveLength(1)
    expect(result.failed[0].serial).toBe('A')
  })

  it('stops everything', async () => {
    const s = setup({ devices: [device('A'), device('B')] })
    await s.service.startAll()
    expect(s.active.size).toBe(2)
    await s.service.stopAll()
    expect(s.active.size).toBe(0)
  })
})

describe('start overrides', () => {
  const flags = ['--start-app', '--no-audio']

  it('starts an app by package name', () => {
    const s = setup({ scrcpyFlags: flags })
    expect(s.service.start('A', { startApp: 'com.android.chrome' })).toEqual({ ok: true })
    expect(s.started[0].args).toContain('--start-app=com.android.chrome')
  })

  it('lets the override win over the preset', () => {
    const s = setup({ scrcpyFlags: flags, presets: { A: preset({ startApp: 'com.old.app' }) } })
    s.service.start('A', { startApp: 'com.new.app' })
    expect(s.started[0].args).toContain('--start-app=com.new.app')
    expect(s.started[0].args.join(' ')).not.toContain('com.old.app')
  })

  it('refuses names that are not packages, without starting', () => {
    const s = setup({ scrcpyFlags: flags })
    for (const bad of ['calc', 'com.x && calc', '"; calc', 5, '', 'com..x ']) {
      expect(s.service.start('A', { startApp: bad }).ok).toBe(false)
    }
    expect(s.started).toHaveLength(0)
  })

  it('refuses non-object overrides and ignores unknown fields', () => {
    const s = setup({ scrcpyFlags: flags })
    expect(s.service.start('A', 'com.android.chrome').ok).toBe(false)
    expect(s.service.start('A', { record: 'C:\\evil.mp4', args: '--x' })).toEqual({ ok: true })
    expect(s.started[0].args.join(' ')).not.toContain('evil')
  })

  it('says when this scrcpy cannot start an app', () => {
    const s = setup({ scrcpyFlags: ['--no-audio'] })
    expect(s.service.start('A', { startApp: 'com.android.chrome' }).ok).toBe(false)
    expect(s.started).toHaveLength(0)
  })

  it('still starts when nothing is overridden', () => {
    const s = setup({ scrcpyFlags: ['--no-audio'] })
    expect(s.service.start('A', undefined)).toEqual({ ok: true })
  })
})

describe('preset override', () => {
  const quick: Preset = { id: 'quick', name: 'Quick', options: { maxSize: 800 } }

  it('uses the preset named in the override instead of the device preset', () => {
    const s = setup({ presets: { A: preset({ maxSize: 1920 }) }, presetsById: { quick } })
    expect(s.service.start('A', { presetId: 'quick' })).toEqual({ ok: true })
    expect(s.started[0].args).toContain('--max-size=800')
  })

  it('refuses a preset that does not exist', () => {
    const s = setup({ presetsById: { quick } })
    expect(s.service.start('A', { presetId: 'gone' }).ok).toBe(false)
    expect(s.service.start('A', { presetId: 5 }).ok).toBe(false)
    expect(s.started).toHaveLength(0)
  })
})

describe('keyboard and mouse mode (OTG)', () => {
  it('runs scrcpy --otg for a USB device, without mirroring options', () => {
    const s = setup({
      scrcpyFlags: ['--otg', '--no-audio'],
      presets: { A: preset({ maxSize: 1024 }) }
    })
    expect(s.service.startOtg('A')).toEqual({ ok: true })
    expect(s.started[0].args).toEqual([
      '--serial=A',
      '--otg',
      '--window-title=Phone A (A) keyboard and mouse'
    ])
    expect(s.started[0].env).toBeUndefined()
  })

  it('needs a USB cable', () => {
    const s = setup({ devices: [device('A', { connection: 'tcpip' })], scrcpyFlags: ['--otg'] })
    expect(s.service.startOtg('A').ok).toBe(false)
    expect(s.started).toHaveLength(0)
  })

  it('says when this scrcpy has no OTG mode, or when there is no scrcpy', () => {
    expect(setup({ scrcpyFlags: ['--no-audio'] }).service.startOtg('A').ok).toBe(false)
    expect(setup({ noScrcpy: true }).service.startOtg('A').ok).toBe(false)
  })

  it('checks the device like a normal start', () => {
    const s = setup({ scrcpyFlags: ['--otg'], devices: [device('A', { state: 'unauthorized' })] })
    expect(s.service.startOtg('A').ok).toBe(false)
    expect(s.service.startOtg('missing').ok).toBe(false)
    expect(s.service.startOtg(5).ok).toBe(false)
    expect(s.service.startOtg('a"b').ok).toBe(false)
  })

  it('tries unknown flags list as allowed when the help could not be read', () => {
    const s = setup({ scrcpyFlags: null })
    expect(s.service.startOtg('A')).toEqual({ ok: true })
  })
})

describe('recording history', () => {
  it('remembers the file a recording goes to', () => {
    const s = setup({ presets: { A: preset({ record: 'C:\\Videos\\{device}-{date}.mp4' }) } })
    s.service.start('A')
    expect(s.captures).toEqual([
      {
        path: 'C:\\Videos\\Phone_A-2026-10-25.mp4',
        kind: 'recording',
        device: 'Phone A',
        at: new Date(2026, 9, 25, 14, 5, 9).toISOString()
      }
    ])
  })

  it('adds nothing without a recording, or when the start fails', () => {
    const none = setup()
    none.service.start('A')
    expect(none.captures).toEqual([])

    const failed = setup({
      presets: { A: preset({ record: 'C:\\Videos\\a.mp4' }) },
      startOutcome: () => ({ ok: false, error: 'no' })
    })
    failed.service.start('A')
    expect(failed.captures).toEqual([])
  })
})

import { describe, expect, it } from 'vitest'
import type { Device, SessionInfo, SettingsState } from '../shared/models'
import { buildReport, redact, type DiagnosticsInput } from './diagnostics'

const device = (serial: string, model: string): Device => ({
  serial,
  state: 'device',
  rawState: 'device',
  connection: serial.includes(':') ? 'tcpip' : 'usb',
  transportId: '1',
  model,
  manufacturer: 'Xiaomi',
  androidVersion: '10',
  sdk: 29
})

const settings: SettingsState = {
  presets: [
    { id: 'default', name: 'Default', options: {} },
    { id: 'p2', name: 'My secret preset', options: { record: 'C:\\Users\\jdoe\\Videos\\x.mp4' } }
  ],
  devicePresets: { R5CT1234ABC: 'p2' },
  wireless: [{ address: '192.168.1.50:5555', name: 'TV' }],
  autoReconnect: true,
  screenshotFolder: 'C:\\Users\\jdoe\\Pictures',
  captures: [
    {
      path: 'C:\\Users\\jdoe\\Videos\\x.mp4',
      kind: 'recording',
      device: 'TV',
      at: '2026-10-25T10:00:00Z'
    }
  ],
  closeToTray: true,
  preferManagedScrcpy: false,
  hotkeys: { showWindow: 'Ctrl+Alt+S', stopAll: null, screenshot: null }
}

const session: SessionInfo = {
  serial: '192.168.1.50:5555',
  state: 'exited',
  pid: null,
  startedAt: 0,
  exitCode: 1,
  error: 'Device disconnected',
  command: 'C:\\Users\\jdoe\\scrcpy\\scrcpy.exe --serial=192.168.1.50:5555'
}

const input = (overrides: Partial<DiagnosticsInput> = {}): DiagnosticsInput => ({
  app: { name: 'DroidSync', version: '0.0.1', electron: '44.7.2', chrome: '150', node: '24' },
  os: { platform: 'win32', release: '10.0.26300', arch: 'x64' },
  tools: {
    status: {
      scrcpy: {
        path: 'C:\\Users\\jdoe\\scrcpy\\scrcpy.exe',
        version: '2.6.1',
        source: 'path',
        flags: ['--a', '--b']
      },
      adb: { path: 'C:\\Users\\jdoe\\scrcpy\\adb.exe', version: '35.0.0' },
      managedRoot: 'C:\\Users\\jdoe\\AppData\\Local\\DroidSync\\scrcpy'
    },
    download: { phase: 'idle', received: 0, total: 0, version: null, error: null }
  },
  devices: {
    adb: 'connected',
    error: null,
    devices: [device('R5CT1234ABC', 'Pixel 7'), device('192.168.1.50:5555', 'Living room TV')]
  },
  sessions: [session],
  sessionLogs: { '192.168.1.50:5555': ['INFO: connecting to 192.168.1.50:5555'] },
  settings,
  autostart: { supported: true, enabled: false },
  logTail: ['2026-10-25T10:00:00.000Z ERROR something at C:\\Users\\jdoe\\app'],
  now: new Date('2026-10-25T12:00:00Z'),
  home: 'C:\\Users\\jdoe',
  userName: 'jdoe',
  ...overrides
})

describe('redact', () => {
  const options = {
    serials: ['R5CT1234ABC', '192.168.1.50:5555'],
    home: 'C:\\Users\\jdoe',
    userName: 'jdoe'
  }

  it('replaces serials with numbered names', () => {
    expect(redact('R5CT1234ABC and 192.168.1.50:5555', options)).toBe('device-1 and device-2')
  })

  it('replaces a serial that contains another one as a whole', () => {
    expect(
      redact('abc and abc-long', { serials: ['abc', 'abc-long'], home: '', userName: '' })
    ).toBe('device-1 and device-2')
  })

  it('hides the home folder in both slash styles, ignoring case', () => {
    expect(redact('C:\\Users\\jdoe\\x and c:/users/JDOE/y', options)).toBe(
      '%USERPROFILE%\\x and %USERPROFILE%/y'
    )
  })

  it('hides the user name elsewhere, but not inside other words', () => {
    expect(redact('hello jdoe, jdoes', options)).toBe('hello <user>, jdoes')
  })

  it('masks the last number of other IP addresses', () => {
    expect(redact('peer 10.1.2.3 version 1.2.3.4', options)).toBe('peer 10.1.2.x version 1.2.3.x')
  })

  it('leaves short user names alone, since they would match everywhere', () => {
    expect(redact('a b ab', { serials: [], home: '', userName: 'ab' })).toBe('a b ab')
  })
})

describe('buildReport', () => {
  it('describes the app, tools, devices, settings and sessions', () => {
    const report = buildReport(input())
    expect(report).toContain('DroidSync 0.0.1 diagnostics')
    expect(report).toContain('scrcpy 2.6.1 (from PATH)')
    expect(report).toContain('adb 35.0.0')
    expect(report).toContain('Android 10 (API 29)')
    expect(report).toContain('2 presets, 1 devices with their own preset')
    expect(report).toContain('Hotkeys set: showWindow')
    expect(report).toContain('1 recordings, 0 screenshots')
    expect(report).toContain('exit code 1, Device disconnected')
    expect(report).toContain('INFO: connecting to')
  })

  it('leaves out private details: serials, IPs, the user name, preset contents and file paths', () => {
    const report = buildReport(input())
    expect(report).not.toContain('R5CT1234ABC')
    expect(report).not.toContain('192.168.1.50')
    expect(report).not.toContain('jdoe')
    expect(report).not.toContain('My secret preset')
    expect(report).not.toContain('x.mp4')
    expect(report).toContain('device-1')
    expect(report).toContain('%USERPROFILE%')
  })

  it('copes with nothing being installed or connected', () => {
    const report = buildReport(
      input({
        tools: {
          status: { scrcpy: null, adb: null, managedRoot: 'C:\\m' },
          download: { phase: 'idle', received: 0, total: 0, version: null, error: null }
        },
        devices: { adb: 'unavailable', error: 'refused', devices: [] },
        sessions: [],
        logTail: []
      })
    )
    expect(report).toContain('scrcpy: not found')
    expect(report).toContain('adb: not found')
    expect(report).toContain('No devices.')
    expect(report).toContain('None.')
    expect(report).toContain('Empty.')
    expect(report).toContain('unavailable (refused)')
  })

  it('shows only the last 30 lines of a session log', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`)
    const report = buildReport(input({ sessionLogs: { '192.168.1.50:5555': lines } }))
    expect(report).toContain('line 99')
    expect(report).toContain('line 70')
    expect(report).not.toContain('line 69\n')
  })
})

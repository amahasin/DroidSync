import { existsSync } from 'fs'
import { dirname } from 'path'
import type {
  CaptureEntry,
  Device,
  DevicesSnapshot,
  Preset,
  StartAllResult,
  StartResult,
  ToolsState
} from '../shared/models'
import { PACKAGE_NAME } from './actions/parse'
import {
  OPTIONS,
  buildArgs,
  defaultWindowTitle,
  expandPlaceholders,
  formatCommand,
  type MirrorConfig
} from '../shared/options'
import type { StartRequest } from './sessions/manager'

/** The parts of the other services this one uses, so tests can substitute small fakes. */
export interface MirrorDeps {
  tools: { state: ToolsState }
  devices: { snapshot: DevicesSnapshot }
  settings: {
    presetFor(serial: string): Preset
    presetById?(id: string): Preset | undefined
    addCapture?(entry: CaptureEntry): unknown
  }
  sessions: {
    start(request: StartRequest): StartResult
    stop(serial: string): Promise<void>
    stopAll(): Promise<void>
    isActive(serial: string): boolean
    note(serial: string, line: string): void
  }
  now?: () => Date
  folderExists?: (folder: string) => boolean
  /** Pause between starting devices, so they do not all hit adb at the same moment. */
  pause?: (ms: number) => Promise<void>
}

const START_GAP_MS = 300

const labelOf = (id: string): string => OPTIONS.find((option) => option.id === id)?.label ?? id
const sameFile = (a: string, b: string): boolean => a.toLowerCase() === b.toLowerCase()

/** Ties together tools, devices, presets and sessions to start and stop mirroring. */
export class MirrorService {
  /** Recording file each device is writing, while its session is active. */
  private recordings = new Map<string, string>()

  constructor(private readonly deps: MirrorDeps) {}

  /** `overrides` is whatever the renderer sent; only the known, validated fields are used. */
  start(requested: unknown, overrides?: unknown): StartResult {
    const found = this.readyDevice(requested)
    if ('ok' in found) return found
    const device = found

    const { scrcpy, adb } = this.deps.tools.state.status
    if (!scrcpy) return { ok: false, error: 'scrcpy is not installed yet.' }

    const preset = this.pickPreset(device.serial, overrides)
    if ('ok' in preset) return preset
    const config: MirrorConfig = { ...preset.options }
    const startApp = this.checkStartApp(overrides, scrcpy.flags)
    if (typeof startApp === 'object' && startApp !== null) return startApp
    if (typeof startApp === 'string') config['startApp'] = startApp
    const recording = this.prepareRecording(config, device)
    if (typeof recording !== 'string' && recording !== null) return recording

    const built = buildArgs(config, {
      serial: device.serial,
      flags: scrcpy.flags ? new Set(scrcpy.flags) : null,
      defaultTitle: defaultWindowTitle(device.model, device.serial)
    })

    const problems = Object.entries(built.errors).map(
      ([id, message]) => `${labelOf(id)}: ${message}`
    )
    if (problems.length > 0) {
      return { ok: false, error: `Fix these options first. ${problems.join(' ')}` }
    }

    const result = this.deps.sessions.start({
      serial: device.serial,
      scrcpyPath: scrcpy.path,
      args: built.args,
      command: formatCommand(scrcpy.path, built.args),
      // Make scrcpy use the same adb we track devices with.
      env: adb ? { ADB: adb.path } : undefined
    })
    if (!result.ok) return result
    const { serial } = device

    if (recording) {
      this.recordings.set(serial, recording)
      this.deps.settings.addCapture?.({
        path: recording,
        kind: 'recording',
        device: device.model ?? serial,
        at: (this.deps.now ?? (() => new Date()))().toISOString()
      })
    } else {
      this.recordings.delete(serial)
    }
    for (const id of built.unsupported) {
      this.deps.sessions.note(
        serial,
        `[gui] Skipped "${labelOf(id)}": not supported by this scrcpy version.`
      )
    }
    return result
  }

  /**
   * Keyboard and mouse only (scrcpy --otg): the computer's keyboard and mouse act on the phone
   * and nothing is mirrored. It works over a USB cable only.
   */
  startOtg(serial: unknown): StartResult {
    const found = this.readyDevice(serial)
    if ('ok' in found) return found
    const device = found
    if (device.connection !== 'usb') {
      return { ok: false, error: 'Keyboard and mouse mode needs the phone connected by USB cable.' }
    }
    const { scrcpy } = this.deps.tools.state.status
    if (!scrcpy) return { ok: false, error: 'scrcpy is not installed yet.' }
    if (scrcpy.flags && !scrcpy.flags.includes('--otg')) {
      return {
        ok: false,
        error: 'This version of scrcpy has no keyboard and mouse mode. Update scrcpy.'
      }
    }
    const title = `${defaultWindowTitle(device.model, device.serial)} keyboard and mouse`.slice(
      0,
      100
    )
    // OTG does not use adb for the connection, so ADB is left alone.
    const args = [`--serial=${device.serial}`, '--otg', `--window-title=${title}`]
    const result = this.deps.sessions.start({
      serial: device.serial,
      scrcpyPath: scrcpy.path,
      args,
      command: formatCommand(scrcpy.path, args)
    })
    if (result.ok) this.recordings.delete(device.serial)
    return result
  }

  /** The connected, ready device with this serial, or the reason there is none. */
  private readyDevice(serial: unknown): Device | StartResult {
    if (typeof serial !== 'string' || serial === '' || serial.length > 200) {
      return { ok: false, error: 'Invalid device.' }
    }
    // Serials are passed through a Windows command line; refuse the few that cannot be quoted.
    if (/["%]/.test(serial)) return { ok: false, error: 'This device name is not supported.' }
    const device = this.deps.devices.snapshot.devices.find((d) => d.serial === serial)
    if (!device) return { ok: false, error: 'That device is not connected any more.' }
    if (device.state !== 'device') {
      return { ok: false, error: 'The device is not ready. Check the message on its card.' }
    }
    return device
  }

  /** The device's own preset, or the one named in `overrides.presetId`. */
  private pickPreset(serial: string, overrides: unknown): Preset | StartResult {
    const id =
      typeof overrides === 'object' && overrides !== null
        ? (overrides as { presetId?: unknown }).presetId
        : undefined
    if (id === undefined) return this.deps.settings.presetFor(serial)
    const preset = typeof id === 'string' ? this.deps.settings.presetById?.(id) : undefined
    return preset ?? { ok: false, error: 'That preset no longer exists.' }
  }

  /** Starts every ready device that is not already mirrored, one after another. */
  async startAll(): Promise<StartAllResult> {
    const pause = this.deps.pause ?? ((ms) => new Promise<void>((r) => setTimeout(r, ms)))
    const targets = this.deps.devices.snapshot.devices.filter(
      (device) => device.state === 'device' && !this.deps.sessions.isActive(device.serial)
    )
    const result: StartAllResult = { started: [], failed: [] }
    for (const [index, device] of targets.entries()) {
      if (index > 0) await pause(START_GAP_MS)
      const outcome = this.start(device.serial)
      if (outcome.ok) result.started.push(device.serial)
      else result.failed.push({ serial: device.serial, error: outcome.error })
    }
    return result
  }

  async stop(serial: unknown): Promise<void> {
    if (typeof serial !== 'string') return
    await this.deps.sessions.stop(serial)
  }

  async stopAll(): Promise<void> {
    await this.deps.sessions.stopAll()
  }

  /**
   * @returns the app to start, null for none, or a failure to report
   */
  private checkStartApp(overrides: unknown, flags: string[] | null): string | null | StartResult {
    if (overrides === undefined || overrides === null) return null
    if (typeof overrides !== 'object') return { ok: false, error: 'Invalid start options.' }
    const app = (overrides as { startApp?: unknown }).startApp
    if (app === undefined) return null
    if (typeof app !== 'string' || app.length > 200 || !PACKAGE_NAME.test(app)) {
      return { ok: false, error: 'That is not a valid app.' }
    }
    if (flags && !flags.includes('--start-app')) {
      return {
        ok: false,
        error: 'This version of scrcpy cannot open an app as it starts. Update scrcpy.'
      }
    }
    return app
  }

  /**
   * Fills in {device}/{date}/{time} in the recording name, in place, and checks the folder exists
   * and no other running session is writing the same file.
   * @returns the final path, null when not recording, or a failure to report
   */
  private prepareRecording(config: MirrorConfig, device: Device): string | null | StartResult {
    const template = config['record']
    if (typeof template !== 'string') return null

    const now = (this.deps.now ?? (() => new Date()))()
    const file = expandPlaceholders(template, device.model ?? device.serial, now)
    config['record'] = file

    const exists = this.deps.folderExists ?? existsSync
    const folder = dirname(file)
    if (folder !== '.' && !exists(folder)) {
      return { ok: false, error: `The recording folder does not exist: ${folder}` }
    }
    for (const [other, path] of this.recordings) {
      if (other !== device.serial && this.deps.sessions.isActive(other) && sameFile(path, file)) {
        return {
          ok: false,
          error: 'Another device is already recording to that file. Add {device} to the name.'
        }
      }
    }
    return file
  }
}

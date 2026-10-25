import { randomBytes } from 'crypto'
import { mkdir, writeFile } from 'fs/promises'
import { basename, extname, isAbsolute, join } from 'path'
import type {
  AppEntry,
  AppsResult,
  CameraEntry,
  CaptureEntry,
  Device,
  DevicesSnapshot,
  ActionResult,
  ScreenshotResult,
  SourcesResult,
  ToolsState,
  TransferOutcome,
  TransferProgress,
  TransferResult
} from '../../shared/models'
import { expandPlaceholders } from '../../shared/options'
import {
  PACKAGE_NAME,
  parseCameras,
  parseDisplays,
  parseInstallOutput,
  parseLauncherPackages,
  parseListApps,
  parsePackageList
} from './parse'

export interface ScrcpyRun {
  code: number | null
  /** Everything scrcpy printed, both streams. */
  output: string
}

/** The parts of the outside world this service uses, so tests can substitute small fakes. */
export interface ActionsDeps {
  tools: { state: ToolsState }
  devices: { snapshot: DevicesSnapshot }
  adb: {
    shell(serial: string, command: string, timeoutMs?: number): Promise<string>
    bytes(serial: string, service: string, timeoutMs?: number): Promise<Buffer>
    push(
      serial: string,
      localPath: string,
      remotePath: string,
      onProgress: (sent: number, total: number) => void
    ): Promise<void>
  }
  runScrcpy(scrcpyPath: string, args: string[], adbPath: string | null): Promise<ScrcpyRun>
  settings: { screenshotFolder: () => string; addCapture(entry: CaptureEntry): void }
  /** Puts a PNG on the clipboard. Resolves false when that was not possible. */
  copyImage(png: Buffer): Promise<boolean>
  now?: () => Date
  randomId?: () => string
}

/** Where plain files go on the device. */
const DOWNLOAD_DIR = '/sdcard/Download'
const MAX_FILES = 20
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const PROGRESS_INTERVAL_MS = 120

/**
 * The PNG inside what screencap printed. Some devices (a Xiaomi TV, for one) write log lines to
 * stdout before the image, so the image is found by its signature, and ends after the IEND chunk.
 */
export function extractPng(output: Buffer): Buffer | null {
  const start = output.subarray(0, 4096).indexOf(PNG_SIGNATURE)
  if (start === -1) return null
  const end = output.lastIndexOf('IEND')
  // IEND is followed by its 4-byte checksum.
  return end > start ? output.subarray(start, Math.min(output.length, end + 8)) : null
}

const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error)

/** Things you do to a connected device from the app: screenshots, sending files, app lists. */
export class DeviceActions {
  private busy = new Set<string>()
  private progressListeners = new Set<(progress: TransferProgress) => void>()

  constructor(private readonly deps: ActionsDeps) {}

  onProgress(listener: (progress: TransferProgress) => void): () => void {
    this.progressListeners.add(listener)
    return () => this.progressListeners.delete(listener)
  }

  // ── screenshot ───────────────────────────────────────────────────────────

  async screenshot(serial: unknown): Promise<ScreenshotResult> {
    const device = this.readyDevice(serial)
    if (typeof device === 'string') return { ok: false, error: device }

    let raw: Buffer
    try {
      raw = await this.deps.adb.bytes(device.serial, 'exec:screencap -p', 30000)
    } catch (error) {
      return { ok: false, error: `Could not take the screenshot. ${messageOf(error)}` }
    }
    const png = extractPng(raw)
    if (!png) {
      const said = raw.toString('utf8', 0, 400).trim().split(/\r?\n/)[0]?.slice(0, 160)
      return {
        ok: false,
        error:
          'The device did not return an image. The screen may be off or protected.' +
          (said ? ` It said: “${said}”` : '')
      }
    }

    const now = (this.deps.now ?? (() => new Date()))()
    const folder = this.deps.settings.screenshotFolder()
    const name = device.model ?? device.serial
    let path: string
    try {
      await mkdir(folder, { recursive: true })
      path = await this.writeUnique(
        folder,
        expandPlaceholders('{device}-{date}-{time}', name, now),
        '.png',
        png
      )
    } catch (error) {
      return { ok: false, error: `Could not save the screenshot to ${folder}. ${messageOf(error)}` }
    }
    this.deps.settings.addCapture({
      path,
      kind: 'screenshot',
      device: name,
      at: now.toISOString()
    })
    return { ok: true, path, copied: await this.deps.copyImage(png) }
  }

  /** Writes a new file, adding -2, -3… when the name is taken. Never overwrites. */
  private async writeUnique(
    folder: string,
    base: string,
    extension: string,
    data: Buffer
  ): Promise<string> {
    for (let n = 1; n < 1000; n++) {
      const path = join(folder, `${base}${n === 1 ? '' : `-${n}`}${extension}`)
      try {
        await writeFile(path, data, { flag: 'wx' })
        return path
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      }
    }
    throw new Error('Too many files with the same name')
  }

  // ── send files / install ─────────────────────────────────────────────────

  /** Installs APKs and copies other files to the Download folder, one after another. */
  async sendFiles(serial: unknown, paths: unknown): Promise<TransferResult> {
    const device = this.readyDevice(serial)
    if (typeof device === 'string') return { ok: false, error: device }
    if (!Array.isArray(paths) || paths.length === 0) return { ok: false, error: 'No files given.' }
    if (paths.length > MAX_FILES) {
      return { ok: false, error: `Send at most ${MAX_FILES} files at a time.` }
    }
    if (this.busy.has(device.serial)) {
      return { ok: false, error: 'Another transfer to this device is still running.' }
    }

    this.busy.add(device.serial)
    try {
      const outcomes: TransferOutcome[] = []
      for (const path of paths) outcomes.push(await this.sendOne(device.serial, path))
      return { ok: true, outcomes }
    } finally {
      this.busy.delete(device.serial)
    }
  }

  private async sendOne(serial: string, path: unknown): Promise<TransferOutcome> {
    const shown = typeof path === 'string' ? basename(path) || 'file' : 'file'
    const kind = extname(shown).toLowerCase() === '.apk' ? 'install' : 'push'
    const fail = (message: string): TransferOutcome => ({ name: shown, kind, ok: false, message })

    if (typeof path !== 'string' || !isAbsolute(path) || path.includes('\0')) {
      return fail('That is not a usable file path.')
    }
    if (path.startsWith('\\\\')) {
      return fail('Files on a network path cannot be sent. Copy it to this computer first.')
    }
    if (/\.(xapk|apks|apkm|aab)$/i.test(shown)) {
      return fail('App bundles are not supported. Use a plain .apk file.')
    }

    let lastReport = 0
    const report = (sent: number, total: number): void => {
      const now = Date.now()
      if (sent < total && now - lastReport < PROGRESS_INTERVAL_MS) return
      lastReport = now
      for (const listener of this.progressListeners) listener({ serial, name: shown, sent, total })
    }

    try {
      return kind === 'install'
        ? await this.install(serial, path, shown, report)
        : await this.copy(serial, path, shown, report)
    } catch (error) {
      return fail(this.explain(error))
    }
  }

  private async copy(
    serial: string,
    path: string,
    shown: string,
    report: (sent: number, total: number) => void
  ): Promise<TransferOutcome> {
    // The name goes into a device path; keep it to one plain file name.
    const name = [...shown]
      .map((ch) => (ch.charCodeAt(0) < 32 || ch === '/' || ch === '\\' ? '_' : ch))
      .join('')
      .trim()
      .slice(0, 200)
    if (name === '' || name === '.' || name === '..') {
      return { name: shown, kind: 'push', ok: false, message: 'That file name cannot be used.' }
    }
    await this.deps.adb.push(serial, path, `${DOWNLOAD_DIR}/${name}`, report)
    return { name: shown, kind: 'push', ok: true, message: `Copied to ${DOWNLOAD_DIR}.` }
  }

  private async install(
    serial: string,
    path: string,
    shown: string,
    report: (sent: number, total: number) => void
  ): Promise<TransferOutcome> {
    const id = (this.deps.randomId ?? (() => randomBytes(5).toString('hex')))()
    // Our own generated name: letters and digits only, so it is safe in a shell command.
    const remote = `/data/local/tmp/droidsync-${id}.apk`
    await this.deps.adb.push(serial, path, remote, report)
    try {
      const output = await this.deps.adb.shell(serial, `pm install -r ${remote}`, 180000)
      const result = parseInstallOutput(output)
      return { name: shown, kind: 'install', ok: result.ok, message: result.message }
    } finally {
      await this.deps.adb.shell(serial, `rm -f ${remote}`, 8000).catch(() => '')
    }
  }

  private explain(error: unknown): string {
    const text = messageOf(error)
    if (/ENOENT/.test(text)) return 'The file was not found.'
    if (/EACCES|EPERM|EBUSY/.test(text)) return 'The file could not be read. Is it open elsewhere?'
    if (/Not a regular file/.test(text)) return 'Folders cannot be sent. Select the files in it.'
    if (/timed out/i.test(text)) {
      return 'The device stopped responding. If it shows a prompt, answer it and try again.'
    }
    return text
  }

  // ── apps ─────────────────────────────────────────────────────────────────

  /** Apps with a launcher icon. Uses scrcpy for names when it can, else adb for package names. */
  async listApps(serial: unknown): Promise<AppsResult> {
    const device = this.readyDevice(serial)
    if (typeof device === 'string') return { ok: false, error: device }

    const { scrcpy, adb } = this.deps.tools.state.status
    if (scrcpy && scrcpy.flags?.includes('--list-apps')) {
      try {
        const run = await this.deps.runScrcpy(
          scrcpy.path,
          ['--serial', device.serial, '--list-apps'],
          adb?.path ?? null
        )
        const apps = parseListApps(run.output)
        if (apps.length > 0) return { ok: true, apps, source: 'scrcpy' }
      } catch {
        // Fall through to adb.
      }
    }

    try {
      const launchable = parseLauncherPackages(
        await this.deps.adb.shell(
          device.serial,
          'cmd package query-activities --brief -a android.intent.action.MAIN -c android.intent.category.LAUNCHER',
          20000
        )
      )
      const user = new Set(
        parsePackageList(await this.deps.adb.shell(device.serial, 'pm list packages -3', 15000))
      )
      const names = launchable.length > 0 ? launchable : [...user]
      const apps: AppEntry[] = names.map((packageName) => ({
        packageName,
        label: null,
        system: !user.has(packageName)
      }))
      return { ok: true, apps, source: 'adb' }
    } catch (error) {
      return { ok: false, error: `Could not list the apps. ${messageOf(error)}` }
    }
  }

  /** Opens an app on the device itself (it shows in the mirror if one is open). */
  async launchApp(serial: unknown, packageName: unknown): Promise<ActionResult> {
    const device = this.readyDevice(serial)
    if (typeof device === 'string') return { ok: false, error: device }
    if (
      typeof packageName !== 'string' ||
      !PACKAGE_NAME.test(packageName) ||
      packageName.length > 200
    ) {
      return { ok: false, error: 'That is not a valid app.' }
    }
    try {
      const output = await this.deps.adb.shell(
        device.serial,
        `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1`,
        15000
      )
      if (/No activities found|monkey aborted/i.test(output)) {
        return { ok: false, error: 'This app has no screen to open.' }
      }
      return { ok: true }
    } catch (error) {
      return { ok: false, error: `Could not open the app. ${messageOf(error)}` }
    }
  }

  // ── displays and cameras ─────────────────────────────────────────────────

  async listSources(serial: unknown, kind: unknown): Promise<SourcesResult> {
    const device = this.readyDevice(serial)
    if (typeof device === 'string') return { ok: false, error: device }
    if (kind !== 'displays' && kind !== 'cameras') return { ok: false, error: 'Unknown source.' }

    const { scrcpy, adb } = this.deps.tools.state.status
    if (!scrcpy) return { ok: false, error: 'scrcpy is not installed yet.' }
    const flag = kind === 'displays' ? '--list-displays' : '--list-cameras'
    if (scrcpy.flags && !scrcpy.flags.includes(flag)) {
      return { ok: false, error: `This version of scrcpy cannot list ${kind}. Update scrcpy.` }
    }

    const run = (extra: string): Promise<ScrcpyRun> =>
      this.deps.runScrcpy(scrcpy.path, ['--serial', device.serial, extra], adb?.path ?? null)

    try {
      const first = await run(flag)
      if (kind === 'displays') {
        const displays = parseDisplays(first.output)
        return displays.length > 0 || first.code === 0
          ? { ok: true, displays, cameras: [] }
          : { ok: false, error: this.scrcpyProblem(first.output) }
      }

      const cameras = parseCameras(first.output)
      if (cameras.length === 0 && first.code !== 0) {
        return { ok: false, error: this.scrcpyProblem(first.output) }
      }
      if (cameras.length > 0 && (!scrcpy.flags || scrcpy.flags.includes('--list-camera-sizes'))) {
        const sizes = await run('--list-camera-sizes').catch(() => null)
        if (sizes) this.mergeSizes(cameras, parseCameras(sizes.output))
      }
      return { ok: true, displays: [], cameras }
    } catch (error) {
      return { ok: false, error: messageOf(error) }
    }
  }

  private mergeSizes(cameras: CameraEntry[], detailed: CameraEntry[]): void {
    for (const camera of cameras) {
      camera.sizes = detailed.find((d) => d.id === camera.id)?.sizes ?? camera.sizes
    }
  }

  /** The most useful line of a failed scrcpy run. */
  private scrcpyProblem(output: string): string {
    const lines = output.split(/\r?\n/).map((l) => l.trim())
    const error = lines.filter((l) => /\bERROR\b|error:|exception/i.test(l)).pop()
    const text = (error ?? lines.filter(Boolean).pop() ?? '').replace(/^\[server\]\s*/, '')
    return text ? `scrcpy said: ${text.slice(0, 200)}` : 'scrcpy could not read the device.'
  }

  // ── shared ───────────────────────────────────────────────────────────────

  /** The connected, ready device with this serial, or the reason there is none. */
  private readyDevice(serial: unknown): Device | string {
    if (typeof serial !== 'string' || serial === '' || serial.length > 200) return 'Invalid device.'
    const device = this.deps.devices.snapshot.devices.find((d) => d.serial === serial)
    if (!device) return 'That device is not connected any more.'
    if (device.state !== 'device') return 'The device is not ready. Check the message on its card.'
    return device
  }
}

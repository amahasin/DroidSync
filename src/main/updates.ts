import type { ActionResult, AppUpdate, ScrcpyUpdate, UpdatesState } from '../shared/models'
import { compareVersions } from './tools/locate'
import type { Release } from './tools/release'

/** What the app needs from an updater, so electron-updater can be swapped for a fake in tests. */
export interface AppUpdater {
  /** The newer version, or null when this one is current. */
  check(): Promise<{ version: string } | null>
  download(onProgress: (percent: number) => void): Promise<void>
  quitAndInstall(): void
}

export interface UpdateDeps {
  currentScrcpy(): string | null
  managedScrcpy(): string | null
  fetchLatest(): Promise<Pick<Release, 'version'>>
  /** null when this build has no update feed (a development build, or none published). */
  appUpdater: AppUpdater | null
}

/**
 * A short reason for the person to read. electron-updater's own messages can run to dozens of lines
 * of HTTP headers and cookies, so only the cause is kept.
 */
export function friendlyError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (/\b404\b/.test(text)) return 'No release was found on GitHub yet.'
  if (/\b(401|403)\b/.test(text)) return 'GitHub refused the request. Try again later.'
  if (
    /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|ERR_INTERNET|net::|fetch failed/i.test(
      text
    )
  ) {
    return 'Could not reach GitHub. Check your internet connection.'
  }
  const first = text.split(/\r?\n/).find((line) => line.trim() !== '') ?? ''
  return first.trim().slice(0, 160)
}

const message = friendlyError

/** Checks for newer scrcpy and for a newer version of the app itself. */
export class UpdateService {
  private scrcpy: ScrcpyUpdate = {
    phase: 'idle',
    current: null,
    latest: null,
    newer: false,
    managedVersion: null,
    error: null
  }
  private app: AppUpdate
  private listeners = new Set<(state: UpdatesState) => void>()

  constructor(private readonly deps: UpdateDeps) {
    this.app = {
      phase: deps.appUpdater ? 'idle' : 'unconfigured',
      version: null,
      percent: 0,
      error: null
    }
  }

  get state(): UpdatesState {
    return { scrcpy: { ...this.scrcpy }, app: { ...this.app } }
  }

  onChange(listener: (state: UpdatesState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async checkScrcpy(): Promise<UpdatesState> {
    if (this.scrcpy.phase === 'checking') return this.state
    this.setScrcpy({ phase: 'checking', error: null })
    const current = this.deps.currentScrcpy()
    const managedVersion = this.deps.managedScrcpy()
    try {
      const latest = (await this.deps.fetchLatest()).version
      this.setScrcpy({
        phase: 'done',
        current,
        latest,
        managedVersion,
        newer: current === null || compareVersions(latest, current) > 0
      })
    } catch (error) {
      this.setScrcpy({
        phase: 'error',
        current,
        managedVersion,
        error: `Could not check for a newer scrcpy. ${message(error)}`
      })
    }
    return this.state
  }

  async checkApp(): Promise<UpdatesState> {
    const updater = this.deps.appUpdater
    if (!updater || ['checking', 'downloading'].includes(this.app.phase)) return this.state
    this.setApp({ phase: 'checking', error: null })
    try {
      const found = await updater.check()
      this.setApp(
        found ? { phase: 'available', version: found.version } : { phase: 'current', version: null }
      )
    } catch (error) {
      this.setApp({ phase: 'error', error: `Could not check for updates. ${message(error)}` })
    }
    return this.state
  }

  async downloadApp(): Promise<ActionResult> {
    const updater = this.deps.appUpdater
    if (!updater) return { ok: false, error: 'This build has no update feed.' }
    if (this.app.phase !== 'available')
      return { ok: false, error: 'There is no update to download.' }
    this.setApp({ phase: 'downloading', percent: 0, error: null })
    try {
      await updater.download((percent) => this.setApp({ percent: Math.round(percent) }))
      this.setApp({ phase: 'ready', percent: 100 })
      return { ok: true }
    } catch (error) {
      this.setApp({ phase: 'error', error: `The download failed. ${message(error)}` })
      return { ok: false, error: this.app.error ?? 'The download failed.' }
    }
  }

  installApp(): ActionResult {
    if (!this.deps.appUpdater || this.app.phase !== 'ready') {
      return { ok: false, error: 'There is no downloaded update.' }
    }
    this.deps.appUpdater.quitAndInstall()
    return { ok: true }
  }

  private setScrcpy(patch: Partial<ScrcpyUpdate>): void {
    this.scrcpy = { ...this.scrcpy, ...patch }
    this.emit()
  }

  private setApp(patch: Partial<AppUpdate>): void {
    this.app = { ...this.app, ...patch }
    this.emit()
  }

  private emit(): void {
    const state = this.state
    for (const listener of this.listeners) listener(state)
  }
}

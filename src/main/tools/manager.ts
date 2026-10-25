import type { DownloadState, ToolsState, ToolStatus } from '../../shared/models'
import { downloadRelease } from './download'
import { resolveTools } from './locate'
import { fetchLatestRelease } from './release'

const IDLE: DownloadState = { phase: 'idle', received: 0, total: 0, version: null, error: null }

/** Owns the resolved scrcpy/adb locations and the download-on-demand flow. */
export class ToolManager {
  private status: ToolStatus
  private download: DownloadState = { ...IDLE }
  private abort: AbortController | null = null
  private listeners = new Set<(state: ToolsState) => void>()

  constructor(
    private readonly managedRoot: string,
    private readonly preferManaged: () => boolean = () => false
  ) {
    this.status = { scrcpy: null, adb: null, managedRoot }
  }

  get state(): ToolsState {
    return { status: this.status, download: this.download }
  }

  onChange(listener: (state: ToolsState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async refresh(): Promise<ToolsState> {
    this.status = await this.resolve()
    this.emit()
    return this.state
  }

  /** Starts the download in the background; progress is reported through onChange. */
  startDownload(): void {
    if (this.abort) return
    const abort = new AbortController()
    this.abort = abort
    void this.runDownload(abort)
  }

  cancelDownload(): void {
    this.abort?.abort()
  }

  private async runDownload(abort: AbortController): Promise<void> {
    this.setDownload({ ...IDLE, phase: 'checking' })
    try {
      const release = await fetchLatestRelease(process.arch, abort.signal)
      await downloadRelease({
        release,
        managedRoot: this.managedRoot,
        signal: abort.signal,
        onProgress: (patch) => this.setDownload({ ...this.download, ...patch })
      })
      this.status = await this.resolve()
      this.setDownload({ ...this.download, phase: 'done', error: null })
    } catch (error) {
      if (abort.signal.aborted) {
        this.setDownload({ ...IDLE })
      } else {
        this.setDownload({ ...this.download, phase: 'error', error: (error as Error).message })
      }
    } finally {
      this.abort = null
    }
  }

  private resolve(): Promise<ToolStatus> {
    return resolveTools({ managedRoot: this.managedRoot, preferManaged: this.preferManaged() })
  }

  private setDownload(next: DownloadState): void {
    this.download = next
    this.emit()
  }

  private emit(): void {
    const state = this.state
    for (const listener of this.listeners) listener(state)
  }
}

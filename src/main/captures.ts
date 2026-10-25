import { stat } from 'fs/promises'
import { extname, join } from 'path'
import type { ActionResult, CaptureEntry, CaptureItem } from '../shared/models'

/** Kinds of file it is safe to hand to the default app. Anything else is only shown in Explorer. */
const OPENABLE = new Set(['.mp4', '.mkv', '.m4a', '.mka', '.opus', '.aac', '.flac', '.wav', '.png'])

/** The folder screenshots go to: the one the person chose, else a folder inside Pictures. */
export function resolveScreenshotFolder(configured: string | null, pictures: string): string {
  return configured ?? join(pictures, 'DroidSync')
}

export interface CaptureDeps {
  settings: {
    snapshot: { captures: CaptureEntry[] }
    removeCapture(path: unknown): ActionResult
    hasCapture(path: unknown): boolean
  }
  shell: {
    openPath(path: string): Promise<string>
    showItemInFolder(path: string): void
    trashItem(path: string): Promise<void>
  }
  /** Asks the person before a file goes to the Recycle Bin. */
  confirmTrash(path: string): Promise<boolean>
}

/**
 * The list of recordings and screenshots, and what can be done to them.
 * Every action takes a path from the renderer, so each one first checks the path is in our list.
 */
export class Captures {
  constructor(private readonly deps: CaptureDeps) {}

  async list(): Promise<CaptureItem[]> {
    return Promise.all(
      this.deps.settings.snapshot.captures.map(async (entry) => {
        try {
          const info = await stat(entry.path)
          return info.isFile()
            ? { ...entry, exists: true, size: info.size }
            : { ...entry, exists: false, size: null }
        } catch {
          return { ...entry, exists: false, size: null }
        }
      })
    )
  }

  async open(path: unknown): Promise<ActionResult> {
    const known = this.known(path)
    if (typeof known !== 'string') return known
    if (!(await this.exists(known))) return { ok: false, error: 'The file is gone.' }
    if (!OPENABLE.has(extname(known).toLowerCase())) {
      this.deps.shell.showItemInFolder(known)
      return { ok: true }
    }
    const problem = await this.deps.shell.openPath(known)
    return problem ? { ok: false, error: problem } : { ok: true }
  }

  async show(path: unknown): Promise<ActionResult> {
    const known = this.known(path)
    if (typeof known !== 'string') return known
    if (!(await this.exists(known))) return { ok: false, error: 'The file is gone.' }
    this.deps.shell.showItemInFolder(known)
    return { ok: true }
  }

  /** Forgets the entry; the file stays where it is. */
  remove(path: unknown): ActionResult {
    return this.deps.settings.removeCapture(path)
  }

  /** Moves the file to the Recycle Bin (after asking), then drops it from the list. */
  async trash(path: unknown): Promise<ActionResult> {
    const known = this.known(path)
    if (typeof known !== 'string') return known
    if (!(await this.exists(known))) {
      this.deps.settings.removeCapture(known)
      return { ok: true }
    }
    if (!(await this.deps.confirmTrash(known))) return { ok: false, error: 'Cancelled.' }
    try {
      await this.deps.shell.trashItem(known)
    } catch (error) {
      return {
        ok: false,
        error:
          `Could not move the file to the Recycle Bin. ${error instanceof Error ? error.message : ''}`.trim()
      }
    }
    this.deps.settings.removeCapture(known)
    return { ok: true }
  }

  private known(path: unknown): string | ActionResult {
    if (typeof path !== 'string' || !this.deps.settings.hasCapture(path)) {
      return { ok: false, error: 'That file is not in the list.' }
    }
    return path
  }

  private async exists(path: string): Promise<boolean> {
    try {
      return (await stat(path)).isFile()
    } catch {
      return false
    }
  }
}

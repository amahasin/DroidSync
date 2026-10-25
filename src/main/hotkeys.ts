import { normalizeAccelerator } from '../shared/hotkeys'
import { HOTKEY_ACTIONS, type HotkeyAction } from '../shared/models'

export interface HotkeyBackend {
  /** Returns false when another program already holds the shortcut. Never throws. */
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

export type HotkeyProblems = Partial<Record<HotkeyAction, string>>

/** Keeps the global shortcuts in step with the settings. */
export class HotkeyService {
  private registered = new Map<HotkeyAction, string>()
  private problems: HotkeyProblems = {}

  constructor(
    private readonly backend: HotkeyBackend,
    private readonly handlers: Record<HotkeyAction, () => void>
  ) {}

  /** Why a shortcut could not be registered, per action. */
  get status(): HotkeyProblems {
    return { ...this.problems }
  }

  /** Registers what changed, releases what was removed, and records what could not be had. */
  apply(wanted: Record<HotkeyAction, string | null>): HotkeyProblems {
    this.problems = {}
    const target = (action: HotkeyAction): string | null => normalizeAccelerator(wanted[action])
    // Release first, so a shortcut can move from one action to another in a single change.
    for (const action of HOTKEY_ACTIONS) {
      const current = this.registered.get(action)
      if (current && current !== target(action)) {
        this.backend.unregister(current)
        this.registered.delete(action)
      }
    }
    for (const action of HOTKEY_ACTIONS) {
      const accelerator = target(action)
      if (!accelerator || this.registered.get(action) === accelerator) continue
      const ok = this.backend.register(accelerator, () => this.handlers[action]())
      if (ok) this.registered.set(action, accelerator)
      else this.problems[action] = 'Another program already uses this shortcut.'
    }
    return this.status
  }

  dispose(): void {
    for (const accelerator of this.registered.values()) this.backend.unregister(accelerator)
    this.registered.clear()
  }
}

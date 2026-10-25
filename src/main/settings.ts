import { randomUUID } from 'crypto'
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'fs'
import { dirname, isAbsolute } from 'path'
import { normalizeAccelerator } from '../shared/hotkeys'
import {
  DEFAULT_PRESET_ID,
  HOTKEY_ACTIONS,
  type ActionResult,
  type CaptureEntry,
  type HotkeyAction,
  type Preset,
  type RememberedDevice,
  type SettingsState
} from '../shared/models'
import { sanitizeConfig } from '../shared/options'

const FILE_VERSION = 2
const MAX_NAME = 40
const MAX_REMEMBERED = 50
const MAX_CAPTURES = 200
/** host:port where host is an IPv4 address or a plain host name. */
const ADDRESS = /^[A-Za-z0-9.-]{1,253}:\d{1,5}$/

/** Presets a fresh install starts with. Ordinary presets: they can be edited or deleted. */
const STARTER_PRESETS: Array<Pick<Preset, 'name' | 'options'>> = [
  { name: 'Low bandwidth', options: { maxSize: 1024, videoBitRate: '2M', maxFps: 30 } },
  { name: 'Presentation', options: { showTouches: true, stayAwake: true, alwaysOnTop: true } },
  {
    name: 'Screen off',
    options: { turnScreenOff: true, stayAwake: true, powerOffOnClose: true }
  },
  { name: 'View only', options: { noControl: true, noAudio: true } }
]

interface SettingsFile {
  version: number
  presets?: unknown
  devicePresets?: unknown
  wireless?: unknown
  autoReconnect?: unknown
  screenshotFolder?: unknown
  captures?: unknown
  closeToTray?: unknown
  preferManagedScrcpy?: unknown
  hotkeys?: unknown
  /** Version 1 kept a single set of options. */
  options?: unknown
}

type Change = (state: SettingsState) => ActionResult

/**
 * Presets and per-device preset choices, saved as JSON.
 *
 * Reads never throw (a missing or damaged file means defaults) and writes go through a temp file,
 * so a crash cannot leave a half-written file behind. A version 1 file, which held one set of
 * options, becomes the Default preset.
 */
export class SettingsStore {
  private state: SettingsState
  private listeners = new Set<(state: SettingsState) => void>()

  constructor(private readonly file: string) {
    this.state = this.load()
  }

  get snapshot(): SettingsState {
    return structuredClone(this.state)
  }

  onChange(listener: (state: SettingsState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** The preset a device mirrors with: its own choice, else Default. */
  presetFor(serial: string): Preset {
    const chosen = this.state.devicePresets[serial]
    return this.find(chosen) ?? (this.find(DEFAULT_PRESET_ID) as Preset)
  }

  presetById(id: string): Preset | undefined {
    return this.find(id)
  }

  createPreset(name: unknown, options?: unknown): ActionResult & { id?: string } {
    const id = randomUUID()
    const result = this.apply((state) => {
      const checked = this.checkName(state, name, null)
      if (typeof checked !== 'string') return checked
      state.presets.push({ id, name: checked, options: sanitizeConfig(options) })
      return { ok: true }
    })
    return result.ok ? { ok: true, id } : result
  }

  duplicatePreset(id: unknown): ActionResult & { id?: string } {
    const source = this.find(id)
    if (!source) return { ok: false, error: 'That preset no longer exists.' }
    let name = `${source.name} copy`
    for (let n = 2; this.state.presets.some((p) => sameName(p.name, name)); n++) {
      name = `${source.name} copy ${n}`
    }
    return this.createPreset(name.slice(0, MAX_NAME), source.options)
  }

  setPresetOptions(id: unknown, options: unknown): ActionResult {
    return this.apply((state) => {
      const preset = state.presets.find((p) => p.id === id)
      if (!preset) return { ok: false, error: 'That preset no longer exists.' }
      preset.options = sanitizeConfig(options)
      return { ok: true }
    })
  }

  renamePreset(id: unknown, name: unknown): ActionResult {
    return this.apply((state) => {
      const preset = state.presets.find((p) => p.id === id)
      if (!preset) return { ok: false, error: 'That preset no longer exists.' }
      if (preset.id === DEFAULT_PRESET_ID) {
        return { ok: false, error: 'The Default preset cannot be renamed.' }
      }
      const checked = this.checkName(state, name, preset.id)
      if (typeof checked !== 'string') return checked
      preset.name = checked
      return { ok: true }
    })
  }

  deletePreset(id: unknown): ActionResult {
    return this.apply((state) => {
      if (id === DEFAULT_PRESET_ID)
        return { ok: false, error: 'The Default preset cannot be deleted.' }
      if (!state.presets.some((p) => p.id === id)) {
        return { ok: false, error: 'That preset no longer exists.' }
      }
      state.presets = state.presets.filter((p) => p.id !== id)
      // Devices that used it fall back to Default.
      for (const [serial, presetId] of Object.entries(state.devicePresets)) {
        if (presetId === id) delete state.devicePresets[serial]
      }
      return { ok: true }
    })
  }

  /** null clears the choice, so the device uses Default again. */
  setDevicePreset(serial: unknown, presetId: unknown): ActionResult {
    return this.apply((state) => {
      if (typeof serial !== 'string' || serial === '' || serial.length > 200) {
        return { ok: false, error: 'Invalid device.' }
      }
      if (presetId === null || presetId === DEFAULT_PRESET_ID) {
        delete state.devicePresets[serial]
        return { ok: true }
      }
      if (!state.presets.some((p) => p.id === presetId)) {
        return { ok: false, error: 'That preset no longer exists.' }
      }
      state.devicePresets[serial] = presetId as string
      return { ok: true }
    })
  }

  // ── wireless ───────────────────────────────────────────────────────────

  /** Remember an address to reconnect to. Remembering one again just refreshes its name. */
  rememberDevice(address: unknown, name?: unknown): ActionResult {
    return this.apply((state) => {
      if (typeof address !== 'string' || !ADDRESS.test(address)) {
        return { ok: false, error: 'That is not a valid address.' }
      }
      const cleanName =
        typeof name === 'string' && name.trim() ? name.trim().slice(0, MAX_NAME) : null
      const existing = state.wireless.find((d) => d.address === address)
      if (existing) {
        existing.name = cleanName ?? existing.name
      } else {
        if (state.wireless.length >= MAX_REMEMBERED) {
          return { ok: false, error: `You can remember up to ${MAX_REMEMBERED} devices.` }
        }
        state.wireless.push({ address, name: cleanName })
      }
      return { ok: true }
    })
  }

  forgetDevice(address: unknown): ActionResult {
    return this.apply((state) => {
      if (!state.wireless.some((d) => d.address === address)) {
        return { ok: false, error: 'That device is not remembered.' }
      }
      state.wireless = state.wireless.filter((d) => d.address !== address)
      return { ok: true }
    })
  }

  /** The device moved to another address (new port, new IP). Keeps its name. */
  moveRememberedDevice(from: string, to: string): ActionResult {
    return this.apply((state) => {
      const device = state.wireless.find((d) => d.address === from)
      if (!device) return { ok: false, error: 'That device is not remembered.' }
      if (!ADDRESS.test(to)) return { ok: false, error: 'That is not a valid address.' }
      if (state.wireless.some((d) => d.address === to)) {
        state.wireless = state.wireless.filter((d) => d.address !== from)
      } else {
        device.address = to
      }
      return { ok: true }
    })
  }

  setAutoReconnect(enabled: unknown): ActionResult {
    return this.apply((state) => {
      state.autoReconnect = enabled === true
      return { ok: true }
    })
  }

  // ── app preferences ────────────────────────────────────────────────────

  setCloseToTray(enabled: unknown): ActionResult {
    return this.apply((state) => {
      state.closeToTray = enabled === true
      return { ok: true }
    })
  }

  setPreferManagedScrcpy(enabled: unknown): ActionResult {
    return this.apply((state) => {
      state.preferManagedScrcpy = enabled === true
      return { ok: true }
    })
  }

  /** null clears the shortcut. Two actions cannot share one. */
  setHotkey(action: unknown, accelerator: unknown): ActionResult {
    return this.apply((state) => {
      if (!HOTKEY_ACTIONS.includes(action as HotkeyAction)) {
        return { ok: false, error: 'Unknown action.' }
      }
      const key = action as HotkeyAction
      if (accelerator === null) {
        state.hotkeys[key] = null
        return { ok: true }
      }
      const normal = normalizeAccelerator(accelerator)
      if (!normal) {
        return { ok: false, error: 'Use Ctrl, Alt or the Windows key with one other key.' }
      }
      const taken = HOTKEY_ACTIONS.find((other) => other !== key && state.hotkeys[other] === normal)
      if (taken) return { ok: false, error: 'That shortcut is already used by another action.' }
      state.hotkeys[key] = normal
      return { ok: true }
    })
  }

  // ── captures ───────────────────────────────────────────────────────────

  /** null goes back to the default folder. */
  setScreenshotFolder(folder: unknown): ActionResult {
    return this.apply((state) => {
      if (folder === null) {
        state.screenshotFolder = null
        return { ok: true }
      }
      if (typeof folder !== 'string' || !isAbsolute(folder) || folder.length > 400) {
        return { ok: false, error: 'That is not a usable folder.' }
      }
      state.screenshotFolder = folder
      return { ok: true }
    })
  }

  /** Newest first. The same file is listed once; the list keeps the latest MAX_CAPTURES. */
  addCapture(entry: CaptureEntry): ActionResult {
    return this.apply((state) => {
      const clean = cleanCapture(entry)
      if (!clean) return { ok: false, error: 'That is not a valid file.' }
      state.captures = [
        clean,
        ...state.captures.filter((c) => !samePath(c.path, clean.path))
      ].slice(0, MAX_CAPTURES)
      return { ok: true }
    })
  }

  /** Takes a file off the list. The file itself is not touched. */
  removeCapture(path: unknown): ActionResult {
    return this.apply((state) => {
      const before = state.captures.length
      state.captures = state.captures.filter(
        (c) => typeof path !== 'string' || !samePath(c.path, path)
      )
      return state.captures.length < before
        ? { ok: true }
        : { ok: false, error: 'That file is not in the list.' }
    })
  }

  hasCapture(path: unknown): boolean {
    return typeof path === 'string' && this.state.captures.some((c) => samePath(c.path, path))
  }

  // ── internals ───────────────────────────────────────────────────────────

  private find(id: unknown): Preset | undefined {
    return this.state.presets.find((p) => p.id === id)
  }

  private checkName(
    state: SettingsState,
    name: unknown,
    selfId: string | null
  ): string | ActionResult {
    if (typeof name !== 'string') return { ok: false, error: 'Enter a name.' }
    const trimmed = name.trim()
    if (trimmed === '') return { ok: false, error: 'Enter a name.' }
    if (trimmed.length > MAX_NAME) {
      return { ok: false, error: `Use at most ${MAX_NAME} characters.` }
    }
    if (state.presets.some((p) => p.id !== selfId && sameName(p.name, trimmed))) {
      return { ok: false, error: 'A preset with that name already exists.' }
    }
    return trimmed
  }

  /** Runs a change on a copy; keeps and saves it only if it succeeded. */
  private apply(change: Change): ActionResult {
    const draft = structuredClone(this.state)
    const result = change(draft)
    if (!result.ok) return result
    this.state = draft
    this.save()
    const snapshot = this.snapshot
    for (const listener of this.listeners) listener(snapshot)
    return result
  }

  private load(): SettingsState {
    if (!existsSync(this.file)) return this.fresh()
    try {
      const raw = JSON.parse(readFileSync(this.file, 'utf8')) as SettingsFile
      return this.normalise(raw)
    } catch {
      return this.fresh(false)
    }
  }

  private fresh(withStarters = true): SettingsState {
    const presets: Preset[] = [{ id: DEFAULT_PRESET_ID, name: 'Default', options: {} }]
    if (withStarters) {
      for (const starter of STARTER_PRESETS) {
        presets.push({
          id: randomUUID(),
          name: starter.name,
          options: sanitizeConfig(starter.options)
        })
      }
    }
    return {
      presets,
      devicePresets: {},
      wireless: [],
      autoReconnect: true,
      screenshotFolder: null,
      captures: [],
      closeToTray: false,
      preferManagedScrcpy: false,
      hotkeys: { showWindow: null, stopAll: null, screenshot: null }
    }
  }

  private normalise(raw: SettingsFile): SettingsState {
    const presets: Preset[] = []
    const seen = new Set<string>()

    if (Array.isArray(raw.presets)) {
      for (const item of raw.presets as Array<Partial<Preset>>) {
        if (typeof item?.id !== 'string' || typeof item.name !== 'string' || seen.has(item.id))
          continue
        seen.add(item.id)
        presets.push({
          id: item.id,
          name:
            item.id === DEFAULT_PRESET_ID
              ? 'Default'
              : item.name.trim().slice(0, MAX_NAME) || 'Preset',
          options: sanitizeConfig(item.options)
        })
      }
    }

    // Version 1: one set of options is the Default preset.
    const defaultIndex = presets.findIndex((p) => p.id === DEFAULT_PRESET_ID)
    if (defaultIndex === -1) {
      presets.unshift({
        id: DEFAULT_PRESET_ID,
        name: 'Default',
        options: sanitizeConfig(raw.options)
      })
    } else if (defaultIndex > 0) {
      presets.unshift(...presets.splice(defaultIndex, 1))
    }

    const devicePresets: Record<string, string> = {}
    if (typeof raw.devicePresets === 'object' && raw.devicePresets !== null) {
      for (const [serial, id] of Object.entries(raw.devicePresets as Record<string, unknown>)) {
        if (typeof id === 'string' && id !== DEFAULT_PRESET_ID && seen.has(id))
          devicePresets[serial] = id
      }
    }

    const wireless: RememberedDevice[] = []
    if (Array.isArray(raw.wireless)) {
      for (const item of raw.wireless as Array<Partial<RememberedDevice>>) {
        if (typeof item?.address !== 'string' || !ADDRESS.test(item.address)) continue
        if (wireless.some((d) => d.address === item.address)) continue
        const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : null
        wireless.push({ address: item.address, name: name?.slice(0, MAX_NAME) ?? null })
        if (wireless.length >= MAX_REMEMBERED) break
      }
    }

    const captures: CaptureEntry[] = []
    if (Array.isArray(raw.captures)) {
      for (const item of raw.captures) {
        const clean = cleanCapture(item)
        if (clean && !captures.some((c) => samePath(c.path, clean.path))) captures.push(clean)
        if (captures.length >= MAX_CAPTURES) break
      }
    }

    const hotkeys: SettingsState['hotkeys'] = { showWindow: null, stopAll: null, screenshot: null }
    if (typeof raw.hotkeys === 'object' && raw.hotkeys !== null) {
      for (const action of HOTKEY_ACTIONS) {
        const normal = normalizeAccelerator((raw.hotkeys as Record<string, unknown>)[action])
        // A shortcut already given to an earlier action is dropped.
        if (normal && !Object.values(hotkeys).includes(normal)) hotkeys[action] = normal
      }
    }

    return {
      presets,
      closeToTray: raw.closeToTray === true,
      preferManagedScrcpy: raw.preferManagedScrcpy === true,
      hotkeys,
      devicePresets,
      wireless,
      autoReconnect: typeof raw.autoReconnect === 'boolean' ? raw.autoReconnect : true,
      screenshotFolder:
        typeof raw.screenshotFolder === 'string' && isAbsolute(raw.screenshotFolder)
          ? raw.screenshotFolder.slice(0, 400)
          : null,
      captures
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.file), { recursive: true })
      const temp = `${this.file}.tmp`
      writeFileSync(temp, JSON.stringify({ version: FILE_VERSION, ...this.state }, null, 2), 'utf8')
      renameSync(temp, this.file)
    } catch (error) {
      console.error('Could not save settings:', error)
    }
  }
}

function sameName(a: string, b: string): boolean {
  return a.trim().toLowerCase() === b.trim().toLowerCase()
}

/** Windows paths are not case sensitive. */
function samePath(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase()
}

/** A capture entry with every field checked, or null when it cannot be trusted. */
function cleanCapture(item: unknown): CaptureEntry | null {
  const value = item as Partial<CaptureEntry> | null
  if (typeof value?.path !== 'string' || !isAbsolute(value.path) || value.path.length > 600) {
    return null
  }
  if (value.kind !== 'recording' && value.kind !== 'screenshot') return null
  if (typeof value.at !== 'string' || Number.isNaN(Date.parse(value.at))) return null
  const device = typeof value.device === 'string' ? value.device.trim().slice(0, 80) : ''
  return { path: value.path, kind: value.kind, device: device || 'Device', at: value.at }
}

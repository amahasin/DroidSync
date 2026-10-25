/** Data shapes sent between main and renderer. Plain JSON only. */

export type ToolSource = 'path' | 'managed'

export interface ScrcpyTool {
  path: string
  version: string | null
  source: ToolSource
  /** Long flags this scrcpy documents in `--help`. null if they could not be read. */
  flags: string[] | null
}

export interface AdbTool {
  path: string
  version: string | null
}

export interface ToolStatus {
  scrcpy: ScrcpyTool | null
  adb: AdbTool | null
  /** Folder where the app keeps downloaded scrcpy builds. */
  managedRoot: string
}

export type DownloadPhase =
  'idle' | 'checking' | 'downloading' | 'verifying' | 'extracting' | 'done' | 'error'

export interface DownloadState {
  phase: DownloadPhase
  received: number
  total: number
  version: string | null
  error: string | null
}

export interface ToolsState {
  status: ToolStatus
  download: DownloadState
}

export type DeviceState =
  | 'device'
  | 'unauthorized'
  | 'offline'
  | 'authorizing'
  | 'connecting'
  | 'no-permissions'
  | 'recovery'
  | 'sideload'
  | 'bootloader'
  | 'unknown'

export type DeviceConnection = 'usb' | 'tcpip'

export interface Device {
  serial: string
  state: DeviceState
  /** State exactly as adb reported it. */
  rawState: string
  connection: DeviceConnection
  transportId: string | null
  model: string | null
  manufacturer: string | null
  androidVersion: string | null
  sdk: number | null
}

export type SessionState = 'starting' | 'running' | 'stopping' | 'exited'

/** One scrcpy process mirroring one device. The last exited session is kept until the next start. */
export interface SessionInfo {
  serial: string
  state: SessionState
  pid: number | null
  startedAt: number
  exitCode: number | null
  /** Friendly explanation when scrcpy ended on its own with a problem. */
  error: string | null
  /** The command line, for display. */
  command: string
}

export type StartResult = { ok: true } | { ok: false; error: string }

/** Result of starting several devices at once, in device order. */
export interface StartAllResult {
  started: string[]
  failed: Array<{ serial: string; error: string }>
}

export const DEFAULT_PRESET_ID = 'default'

/** A named set of mirror options. The preset with id "default" always exists. */
export interface Preset {
  id: string
  name: string
  options: Record<string, boolean | number | string>
}

/** A device reached over Wi-Fi that the app reconnects to by itself. */
export interface RememberedDevice {
  /** ip:port */
  address: string
  /** Model name, once known, so the list reads well while the device is offline. */
  name: string | null
}

/** A file the app made for the person: a recording or a screenshot. */
export interface CaptureEntry {
  /** Absolute path on this computer. */
  path: string
  kind: 'recording' | 'screenshot'
  /** Device name at the time. */
  device: string
  /** ISO time the capture was made (a recording: when it started). */
  at: string
}

/** A capture plus what the disk says about it right now. */
export interface CaptureItem extends CaptureEntry {
  exists: boolean
  size: number | null
}

/** Whether a newer scrcpy exists, from the official GitHub releases. */
export interface ScrcpyUpdate {
  phase: 'idle' | 'checking' | 'done' | 'error'
  /** Version in use now. */
  current: string | null
  latest: string | null
  /** The latest release is newer than the one in use. */
  newer: boolean
  /** Newest downloaded build in this app's own folder, if any. */
  managedVersion: string | null
  error: string | null
}

/** State of the app's own updater. "unconfigured" means this build has nowhere to look. */
export interface AppUpdate {
  phase:
    | 'unconfigured'
    | 'idle'
    | 'checking'
    | 'current'
    | 'available'
    | 'downloading'
    | 'ready'
    | 'error'
  version: string | null
  percent: number
  error: string | null
}

export interface UpdatesState {
  scrcpy: ScrcpyUpdate
  app: AppUpdate
}

export interface AutostartState {
  /** Only an installed build can start with Windows. */
  supported: boolean
  enabled: boolean
}

/** Things a global keyboard shortcut can do. */
export const HOTKEY_ACTIONS = ['showWindow', 'stopAll', 'screenshot'] as const
export type HotkeyAction = (typeof HOTKEY_ACTIONS)[number]

export interface SettingsState {
  presets: Preset[]
  /** Closing the window keeps the app in the tray instead of quitting. */
  closeToTray: boolean
  /** Use the downloaded scrcpy even when another one is on PATH. */
  preferManagedScrcpy: boolean
  /** Action → Electron accelerator such as "Ctrl+Alt+S", or null when not set. */
  hotkeys: Record<HotkeyAction, string | null>
  /** Device serial → preset id. Devices not listed use the default preset. */
  devicePresets: Record<string, string>
  wireless: RememberedDevice[]
  /** Reconnect remembered devices in the background. */
  autoReconnect: boolean
  /** Where screenshots are saved. null means the default folder inside Pictures. */
  screenshotFolder: string | null
  /** Recent recordings and screenshots, newest first. */
  captures: CaptureEntry[]
}

export type ActionResult = { ok: true } | { ok: false; error: string }

/** A screenshot taken from a device. */
export type ScreenshotResult =
  { ok: true; path: string; copied: boolean } | { ok: false; error: string }

export interface TransferOutcome {
  /** File name as shown to the person. */
  name: string
  /** An APK is installed; anything else is copied to the Download folder. */
  kind: 'install' | 'push'
  ok: boolean
  message: string
}

/** Result of sending files; `cancelled` is true when the person closed the file dialog. */
export type TransferResult =
  | { ok: true; outcomes: TransferOutcome[]; cancelled?: false }
  | { ok: true; outcomes: []; cancelled: true }
  | { ok: false; error: string }

export interface TransferProgress {
  serial: string
  name: string
  sent: number
  total: number
}

export interface AppEntry {
  packageName: string
  /** The name shown on the launcher; null when only the package name is known. */
  label: string | null
  /** true for apps that came with the device; null when unknown. */
  system: boolean | null
}

export type AppsResult =
  { ok: true; apps: AppEntry[]; source: 'scrcpy' | 'adb' } | { ok: false; error: string }

export interface DisplayEntry {
  id: number
  size: string | null
}

export interface CameraEntry {
  id: string
  facing: string | null
  /** Largest capture size. */
  size: string | null
  fps: string | null
  /** Capture sizes the camera supports, when scrcpy listed them. */
  sizes: string[]
}

export type SourcesResult =
  { ok: true; displays: DisplayEntry[]; cameras: CameraEntry[] } | { ok: false; error: string }

/** What a session start can be told beyond the device's preset. */
export interface StartOverrides {
  /** Launch this app (package name) as mirroring starts. */
  startApp?: string
  /** Use this preset instead of the device's own. */
  presetId?: string
}

/** A device announcing itself on the network through mDNS. */
export interface MdnsService {
  name: string
  /** ip:port */
  address: string
  /** pairing: showing a pairing code now. connect: Wireless debugging is on, ready to connect. */
  kind: 'pairing' | 'connect'
}

export type MdnsStatus = 'unknown' | 'available' | 'unavailable'

export interface WirelessState {
  mdns: MdnsStatus
  mdnsError: string | null
  pairing: MdnsService[]
  /** Devices to connect to that are not connected yet. */
  connectable: MdnsService[]
  /** Remembered addresses the person disconnected on purpose: not reconnected until asked. */
  paused: string[]
  /** Remembered addresses being connected right now. */
  attempting: string[]
}

export type WirelessResult =
  | {
      ok: true
      message: string
      address?: string
      /** Part of the job is done but the device is not connected yet. */
      warning?: boolean
    }
  | { ok: false; error: string }

export interface SessionLog {
  serial: string
  lines: string[]
}

/** unavailable: adb is missing or its server could not be reached. */
export type AdbStatus = 'starting' | 'connected' | 'unavailable'

export interface DevicesSnapshot {
  adb: AdbStatus
  error: string | null
  devices: Device[]
}

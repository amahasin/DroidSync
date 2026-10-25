/**
 * IPC contract shared by main, preload and renderer.
 * Add a channel here first, then implement it in main and expose it in preload.
 */
import type {
  ActionResult,
  AppsResult,
  AutostartState,
  CaptureItem,
  DevicesSnapshot,
  HotkeyAction,
  ScreenshotResult,
  SessionInfo,
  SessionLog,
  SettingsState,
  SourcesResult,
  StartAllResult,
  StartOverrides,
  StartResult,
  ToolsState,
  TransferProgress,
  TransferResult,
  UpdatesState,
  WirelessResult,
  WirelessState
} from './models'
import type { MirrorConfig } from './options'

export const IpcChannel = {
  AppInfo: 'app:info',
  ToolsGet: 'tools:get',
  ToolsRefresh: 'tools:refresh',
  ToolsDownload: 'tools:download',
  ToolsCancelDownload: 'tools:cancel-download',
  /** main → renderer */
  ToolsChanged: 'tools:changed',
  DevicesGet: 'devices:get',
  /** main → renderer */
  DevicesChanged: 'devices:changed',
  SettingsGet: 'settings:get',
  /** main → renderer */
  SettingsChanged: 'settings:changed',
  PresetsCreate: 'presets:create',
  PresetsDuplicate: 'presets:duplicate',
  PresetsSetOptions: 'presets:set-options',
  PresetsRename: 'presets:rename',
  PresetsDelete: 'presets:delete',
  DevicePresetSet: 'device-preset:set',
  DialogChooseRecording: 'dialog:choose-recording',
  WirelessGet: 'wireless:get',
  WirelessWatch: 'wireless:watch',
  WirelessUnwatch: 'wireless:unwatch',
  WirelessConnect: 'wireless:connect',
  WirelessPair: 'wireless:pair',
  WirelessDisconnect: 'wireless:disconnect',
  WirelessEnableWifi: 'wireless:enable-wifi',
  WirelessForget: 'wireless:forget',
  WirelessReconnect: 'wireless:reconnect',
  WirelessSetAutoReconnect: 'wireless:set-auto-reconnect',
  /** main → renderer */
  WirelessChanged: 'wireless:changed',
  DeviceScreenshot: 'device:screenshot',
  DeviceSendFiles: 'device:send-files',
  DeviceChooseAndSend: 'device:choose-and-send',
  /** main → renderer */
  DeviceTransferProgress: 'device:transfer-progress',
  DeviceListApps: 'device:list-apps',
  DeviceLaunchApp: 'device:launch-app',
  DeviceListSources: 'device:list-sources',
  CapturesList: 'captures:list',
  CapturesOpen: 'captures:open',
  CapturesShow: 'captures:show',
  CapturesRemove: 'captures:remove',
  CapturesTrash: 'captures:trash',
  ScreenshotFolderChoose: 'screenshot-folder:choose',
  ScreenshotFolderReset: 'screenshot-folder:reset',
  ScreenshotFolderOpen: 'screenshot-folder:open',
  DiagnosticsGet: 'diagnostics:get',
  LogsOpenFolder: 'logs:open-folder',
  AutostartGet: 'autostart:get',
  AutostartSet: 'autostart:set',
  PrefsCloseToTray: 'prefs:close-to-tray',
  PrefsPreferManaged: 'prefs:prefer-managed',
  HotkeySet: 'hotkey:set',
  HotkeyProblems: 'hotkey:problems',
  UpdatesGet: 'updates:get',
  /** main → renderer */
  UpdatesChanged: 'updates:changed',
  UpdatesCheckScrcpy: 'updates:check-scrcpy',
  UpdatesCheckApp: 'updates:check-app',
  UpdatesDownloadApp: 'updates:download-app',
  UpdatesInstallApp: 'updates:install-app',
  SessionsStartOtg: 'sessions:start-otg',
  SessionsGet: 'sessions:get',
  SessionsStart: 'sessions:start',
  SessionsStop: 'sessions:stop',
  SessionsStartAll: 'sessions:start-all',
  SessionsStopAll: 'sessions:stop-all',
  SessionsLogGet: 'sessions:log-get',
  /** main → renderer */
  SessionsChanged: 'sessions:changed',
  /** main → renderer */
  SessionsLog: 'sessions:log'
} as const

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
}

export type Unsubscribe = () => void

/** The only surface the renderer sees, exposed as `window.api`. */
export interface Api {
  getAppInfo(): Promise<AppInfo>

  getTools(): Promise<ToolsState>
  /** Re-check PATH and the managed folder. */
  refreshTools(): Promise<ToolsState>
  /** Starts a download of the latest scrcpy; progress arrives through onToolsChanged. */
  downloadScrcpy(): Promise<void>
  cancelDownload(): Promise<void>
  onToolsChanged(callback: (state: ToolsState) => void): Unsubscribe

  getDevices(): Promise<DevicesSnapshot>
  onDevicesChanged(callback: (snapshot: DevicesSnapshot) => void): Unsubscribe

  getSettings(): Promise<SettingsState>
  onSettingsChanged(callback: (state: SettingsState) => void): Unsubscribe
  /** Create from the given options (or empty). Resolves with the new preset's id. */
  createPreset(name: string, options?: MirrorConfig): Promise<ActionResult & { id?: string }>
  duplicatePreset(id: string): Promise<ActionResult & { id?: string }>
  setPresetOptions(id: string, options: MirrorConfig): Promise<ActionResult>
  renamePreset(id: string, name: string): Promise<ActionResult>
  deletePreset(id: string): Promise<ActionResult>
  /** null makes the device use the Default preset again. */
  setDevicePreset(serial: string, presetId: string | null): Promise<ActionResult>
  /** Opens a save dialog; resolves with the chosen path, or null if cancelled. */
  chooseRecordingPath(): Promise<string | null>

  getWireless(): Promise<WirelessState>
  /** Start polling for nearby devices (mDNS). Polling stops when unwatched or the window closes. */
  watchWireless(): Promise<void>
  unwatchWireless(): Promise<void>
  onWirelessChanged(callback: (state: WirelessState) => void): Unsubscribe
  /** Connect to host or host:port (port defaults to 5555) and remember the device. */
  connectWireless(address: string): Promise<WirelessResult>
  /** Pair with the six-digit code shown on the phone, then connect if the device announces itself. */
  pairWireless(address: string, code: string): Promise<WirelessResult>
  disconnectWireless(serial: string): Promise<WirelessResult>
  /** Switch a USB device to Wi-Fi (adb tcpip) and connect to it. */
  enableWifi(serial: string): Promise<WirelessResult>
  forgetWireless(address: string): Promise<ActionResult>
  reconnectWireless(address: string): Promise<WirelessResult>
  setAutoReconnect(enabled: boolean): Promise<ActionResult>

  /** Takes a screenshot, saves it in the screenshot folder and copies it to the clipboard. */
  screenshot(serial: string): Promise<ScreenshotResult>
  /** Installs APKs and copies other files to the device's Download folder. */
  sendFiles(serial: string, paths: string[]): Promise<TransferResult>
  /** Shows an open-file dialog, then sends what was chosen. */
  chooseAndSendFiles(serial: string): Promise<TransferResult>
  /** The full path of a file dropped on the window. */
  pathsForFiles(files: File[]): string[]
  onTransferProgress(callback: (progress: TransferProgress) => void): Unsubscribe
  listApps(serial: string): Promise<AppsResult>
  /** Opens an app on the device itself. */
  launchApp(serial: string, packageName: string): Promise<ActionResult>
  /** Displays or cameras the device offers, as scrcpy lists them. */
  listSources(serial: string, kind: 'displays' | 'cameras'): Promise<SourcesResult>

  listCaptures(): Promise<CaptureItem[]>
  openCapture(path: string): Promise<ActionResult>
  showCapture(path: string): Promise<ActionResult>
  /** Takes the file off the list; the file stays. */
  removeCapture(path: string): Promise<ActionResult>
  /** Asks, then moves the file to the Recycle Bin. */
  trashCapture(path: string): Promise<ActionResult>
  /** Resolves with ok:false and error "Cancelled." when the dialog is closed. */
  chooseScreenshotFolder(): Promise<ActionResult>
  resetScreenshotFolder(): Promise<ActionResult>
  openScreenshotFolder(): Promise<ActionResult>

  /** A plain-text report for bug reports, with device serials, IPs and the user name hidden. */
  getDiagnostics(): Promise<string>
  openLogFolder(): Promise<ActionResult>
  getAutostart(): Promise<AutostartState>
  setAutostart(enabled: boolean): Promise<ActionResult>
  setCloseToTray(enabled: boolean): Promise<ActionResult>
  /** Use the downloaded scrcpy even when another is on PATH. Tools are looked up again. */
  setPreferManagedScrcpy(enabled: boolean): Promise<ActionResult>
  /** An accelerator like "Ctrl+Alt+S", or null to clear. Fails if another program holds it. */
  setHotkey(action: HotkeyAction, accelerator: string | null): Promise<ActionResult>
  /** Shortcuts that are set but could not be registered, with the reason. */
  getHotkeyProblems(): Promise<Partial<Record<HotkeyAction, string>>>
  getUpdates(): Promise<UpdatesState>
  onUpdatesChanged(callback: (state: UpdatesState) => void): Unsubscribe
  checkScrcpyUpdate(): Promise<UpdatesState>
  checkAppUpdate(): Promise<UpdatesState>
  downloadAppUpdate(): Promise<ActionResult>
  /** Restarts the app to finish installing a downloaded update. */
  installAppUpdate(): Promise<ActionResult>
  /** Keyboard and mouse only (scrcpy --otg), over USB. Nothing is mirrored. */
  startOtg(serial: string): Promise<StartResult>

  getSessions(): Promise<SessionInfo[]>
  /**
   * Starts mirroring with the device's preset. The renderer never supplies a command line;
   * `overrides` carries only a few validated choices.
   */
  startSession(serial: string, overrides?: StartOverrides): Promise<StartResult>
  stopSession(serial: string): Promise<void>
  startAllSessions(): Promise<StartAllResult>
  stopAllSessions(): Promise<void>
  onSessionsChanged(callback: (sessions: SessionInfo[]) => void): Unsubscribe
  getSessionLog(serial: string): Promise<string[]>
  onSessionLog(callback: (log: SessionLog) => void): Unsubscribe
}

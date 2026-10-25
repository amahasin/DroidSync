import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions,
  type SaveDialogOptions
} from 'electron'
import { mkdir } from 'fs/promises'
import { join } from 'path'
import { IpcChannel, type AppInfo } from '../shared/ipc'
import type { ActionResult, HotkeyAction, TransferResult } from '../shared/models'
import { getAutostart, setAutostart } from './autostart'
import type { HotkeyService } from './hotkeys'
import type { UpdateService } from './updates'
import type { DeviceActions } from './actions/service'
import { resolveScreenshotFolder, type Captures } from './captures'
import type { DeviceService } from './devices'
import type { MirrorService } from './mirror'
import { isTrustedUrl } from './security'
import type { SessionManager } from './sessions/manager'
import type { SettingsStore } from './settings'
import type { ToolManager } from './tools/manager'
import type { WirelessService } from './wireless/service'

function trusted(url: string | undefined): boolean {
  return isTrustedUrl(url, process.env['ELECTRON_RENDERER_URL'])
}

/**
 * Registers an invoke handler that rejects calls from frames we did not load.
 * Arguments come from the renderer and are `unknown`: each service validates its own.
 */
function handle<T>(
  channel: string,
  handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => T | Promise<T>
): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (!trusted(event.senderFrame?.url)) throw new Error(`Untrusted sender for ${channel}`)
    return handler(event, ...args)
  })
}

/** Pushes an event to every window whose current page is ours. */
function broadcast(channel: string, payload: unknown): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.isDestroyed() || !trusted(window.webContents.getURL())) continue
    window.webContents.send(channel, payload)
  }
}

export interface Services {
  tools: ToolManager
  devices: DeviceService
  settings: SettingsStore
  sessions: SessionManager
  mirror: MirrorService
  wireless: WirelessService
  actions: DeviceActions
  captures: Captures
  hotkeys: HotkeyService
  updates: UpdateService
  /** Builds the diagnostics report. */
  diagnostics: () => Promise<string>
  logsFolder: string
}

export function registerIpc({
  tools,
  devices,
  settings,
  sessions,
  mirror,
  wireless,
  actions,
  captures,
  hotkeys,
  updates,
  diagnostics,
  logsFolder
}: Services): void {
  handle<AppInfo>(IpcChannel.AppInfo, () => ({
    name: app.getName(),
    version: app.getVersion(),
    electron: process.versions.electron,
    chrome: process.versions.chrome,
    node: process.versions.node,
    platform: process.platform
  }))

  handle(IpcChannel.ToolsGet, () => tools.state)
  handle(IpcChannel.ToolsRefresh, () => tools.refresh())
  handle(IpcChannel.ToolsDownload, () => tools.startDownload())
  handle(IpcChannel.ToolsCancelDownload, () => tools.cancelDownload())
  tools.onChange((state) => broadcast(IpcChannel.ToolsChanged, state))

  handle(IpcChannel.DevicesGet, () => devices.snapshot)
  devices.onChange((snapshot) => broadcast(IpcChannel.DevicesChanged, snapshot))

  handle(IpcChannel.SettingsGet, () => settings.snapshot)
  handle(IpcChannel.PresetsCreate, (_e, name, options) => settings.createPreset(name, options))
  handle(IpcChannel.PresetsDuplicate, (_e, id) => settings.duplicatePreset(id))
  handle(IpcChannel.PresetsSetOptions, (_e, id, options) => settings.setPresetOptions(id, options))
  handle(IpcChannel.PresetsRename, (_e, id, name) => settings.renamePreset(id, name))
  handle(IpcChannel.PresetsDelete, (_e, id) => settings.deletePreset(id))
  handle(IpcChannel.DevicePresetSet, (_e, serial, presetId) =>
    settings.setDevicePreset(serial, presetId)
  )
  settings.onChange((state) => broadcast(IpcChannel.SettingsChanged, state))

  handle<string | null>(IpcChannel.DialogChooseRecording, async (event) => {
    // The default name keeps the placeholders, so every device and run gets its own file.
    const options: SaveDialogOptions = {
      title: 'Record to file',
      defaultPath: join(app.getPath('videos'), '{device}-{date}-{time}.mp4'),
      buttonLabel: 'Use this file',
      filters: [
        { name: 'Video', extensions: ['mp4', 'mkv'] },
        { name: 'Audio only', extensions: ['m4a', 'mka', 'opus', 'aac', 'flac', 'wav'] }
      ]
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const result = parent
      ? await dialog.showSaveDialog(parent, options)
      : await dialog.showSaveDialog(options)
    return result.canceled || !result.filePath ? null : result.filePath
  })

  handle(IpcChannel.DeviceScreenshot, (_e, serial) => actions.screenshot(serial))
  handle(IpcChannel.DeviceSendFiles, (_e, serial, paths) => actions.sendFiles(serial, paths))
  handle<TransferResult>(IpcChannel.DeviceChooseAndSend, async (event, serial) => {
    const options: OpenDialogOptions = {
      title: 'Send to device',
      buttonLabel: 'Send',
      properties: ['openFile', 'multiSelections']
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: true, outcomes: [], cancelled: true }
    }
    return actions.sendFiles(serial, picked.filePaths)
  })
  actions.onProgress((progress) => broadcast(IpcChannel.DeviceTransferProgress, progress))
  handle(IpcChannel.DeviceListApps, (_e, serial) => actions.listApps(serial))
  handle(IpcChannel.DeviceLaunchApp, (_e, serial, name) => actions.launchApp(serial, name))
  handle(IpcChannel.DeviceListSources, (_e, serial, kind) => actions.listSources(serial, kind))

  handle(IpcChannel.CapturesList, () => captures.list())
  handle(IpcChannel.CapturesOpen, (_e, path) => captures.open(path))
  handle(IpcChannel.CapturesShow, (_e, path) => captures.show(path))
  handle(IpcChannel.CapturesRemove, (_e, path) => captures.remove(path))
  handle(IpcChannel.CapturesTrash, (_e, path) => captures.trash(path))
  handle<ActionResult>(IpcChannel.ScreenshotFolderChoose, async (event) => {
    const options: OpenDialogOptions = {
      title: 'Screenshot folder',
      defaultPath: resolveScreenshotFolder(
        settings.snapshot.screenshotFolder,
        app.getPath('pictures')
      ),
      buttonLabel: 'Use this folder',
      properties: ['openDirectory', 'createDirectory']
    }
    const parent = BrowserWindow.fromWebContents(event.sender)
    const picked = parent
      ? await dialog.showOpenDialog(parent, options)
      : await dialog.showOpenDialog(options)
    if (picked.canceled || picked.filePaths.length === 0) {
      return { ok: false, error: 'Cancelled.' }
    }
    return settings.setScreenshotFolder(picked.filePaths[0])
  })
  handle(IpcChannel.ScreenshotFolderReset, () => settings.setScreenshotFolder(null))
  handle<ActionResult>(IpcChannel.ScreenshotFolderOpen, async () => {
    const folder = resolveScreenshotFolder(
      settings.snapshot.screenshotFolder,
      app.getPath('pictures')
    )
    try {
      await mkdir(folder, { recursive: true })
    } catch (error) {
      return { ok: false, error: `Could not create ${folder}. ${(error as Error).message}` }
    }
    const problem = await shell.openPath(folder)
    return problem ? { ok: false, error: problem } : { ok: true }
  })

  // Each window that opens the Wireless tab holds one watch; it is released when the window goes.
  const watches = new Map<number, () => void>()
  const release = (id: number): void => {
    watches.get(id)?.()
    watches.delete(id)
  }
  handle(IpcChannel.WirelessGet, () => wireless.state)
  handle(IpcChannel.WirelessWatch, (event) => {
    const id = event.sender.id
    if (watches.has(id)) return
    watches.set(id, wireless.watch())
    event.sender.once('destroyed', () => release(id))
  })
  handle(IpcChannel.WirelessUnwatch, (event) => release(event.sender.id))
  handle(IpcChannel.WirelessConnect, (_e, address) => wireless.connect(address))
  handle(IpcChannel.WirelessPair, (_e, address, code) => wireless.pair(address, code))
  handle(IpcChannel.WirelessDisconnect, (_e, serial) => wireless.disconnect(serial))
  handle(IpcChannel.WirelessEnableWifi, (_e, serial) => wireless.enableWifi(serial))
  handle(IpcChannel.WirelessForget, (_e, address) => wireless.forget(address))
  handle(IpcChannel.WirelessReconnect, (_e, address) => wireless.reconnectNow(address))
  handle(IpcChannel.WirelessSetAutoReconnect, (_e, enabled) => wireless.setAutoReconnect(enabled))
  wireless.onChange((state) => broadcast(IpcChannel.WirelessChanged, state))

  handle(IpcChannel.SessionsGet, () => sessions.list())
  handle(IpcChannel.DiagnosticsGet, () => diagnostics())
  handle<ActionResult>(IpcChannel.LogsOpenFolder, async () => {
    try {
      await mkdir(logsFolder, { recursive: true })
    } catch (error) {
      return { ok: false, error: `Could not create ${logsFolder}. ${(error as Error).message}` }
    }
    const problem = await shell.openPath(logsFolder)
    return problem ? { ok: false, error: problem } : { ok: true }
  })
  handle(IpcChannel.AutostartGet, () => getAutostart(app))
  handle(IpcChannel.AutostartSet, (_e, enabled) => setAutostart(app, enabled))
  handle(IpcChannel.PrefsCloseToTray, (_e, enabled) => settings.setCloseToTray(enabled))
  handle(IpcChannel.PrefsPreferManaged, async (_e, enabled) => {
    const result = settings.setPreferManagedScrcpy(enabled)
    await tools.refresh()
    return result
  })
  handle<ActionResult>(IpcChannel.HotkeySet, (_e, action, accelerator) => {
    const before = settings.snapshot.hotkeys
    const result = settings.setHotkey(action, accelerator)
    if (!result.ok) return result
    const key = action as HotkeyAction
    const problem = hotkeys.apply(settings.snapshot.hotkeys)[key]
    if (!problem) return result
    // Could not get the shortcut: put the old one back.
    settings.setHotkey(key, before[key])
    hotkeys.apply(settings.snapshot.hotkeys)
    return { ok: false, error: problem }
  })
  handle(IpcChannel.HotkeyProblems, () => hotkeys.status)
  handle(IpcChannel.UpdatesGet, () => updates.state)
  handle(IpcChannel.UpdatesCheckScrcpy, () => updates.checkScrcpy())
  handle(IpcChannel.UpdatesCheckApp, () => updates.checkApp())
  handle(IpcChannel.UpdatesDownloadApp, () => updates.downloadApp())
  handle(IpcChannel.UpdatesInstallApp, () => updates.installApp())
  updates.onChange((state) => broadcast(IpcChannel.UpdatesChanged, state))
  handle(IpcChannel.SessionsStartOtg, (_e, serial) => mirror.startOtg(serial))
  handle(IpcChannel.SessionsStart, (_e, serial, overrides) => mirror.start(serial, overrides))
  handle(IpcChannel.SessionsStop, (_e, serial) => mirror.stop(serial))
  handle(IpcChannel.SessionsStartAll, () => mirror.startAll())
  handle(IpcChannel.SessionsStopAll, () => mirror.stopAll())
  handle(IpcChannel.SessionsLogGet, (_e, serial) =>
    typeof serial === 'string' ? sessions.getLog(serial) : []
  )
  sessions.onChange((list) => broadcast(IpcChannel.SessionsChanged, list))
  sessions.onLog((log) => broadcast(IpcChannel.SessionsLog, log))
}

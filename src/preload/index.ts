import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { IpcChannel, type Api } from '../shared/ipc'

// Sandboxed preload: only `electron` may be imported here. Keep this surface narrow and typed.
// The IPC event object is never handed to the renderer, only the payload.
function subscribe<T>(channel: string, callback: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => callback(payload)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: Api = {
  getAppInfo: () => ipcRenderer.invoke(IpcChannel.AppInfo),

  getTools: () => ipcRenderer.invoke(IpcChannel.ToolsGet),
  refreshTools: () => ipcRenderer.invoke(IpcChannel.ToolsRefresh),
  downloadScrcpy: () => ipcRenderer.invoke(IpcChannel.ToolsDownload),
  cancelDownload: () => ipcRenderer.invoke(IpcChannel.ToolsCancelDownload),
  onToolsChanged: (callback) => subscribe(IpcChannel.ToolsChanged, callback),

  getDevices: () => ipcRenderer.invoke(IpcChannel.DevicesGet),
  onDevicesChanged: (callback) => subscribe(IpcChannel.DevicesChanged, callback),

  getSettings: () => ipcRenderer.invoke(IpcChannel.SettingsGet),
  onSettingsChanged: (callback) => subscribe(IpcChannel.SettingsChanged, callback),
  createPreset: (name, options) => ipcRenderer.invoke(IpcChannel.PresetsCreate, name, options),
  duplicatePreset: (id) => ipcRenderer.invoke(IpcChannel.PresetsDuplicate, id),
  setPresetOptions: (id, options) => ipcRenderer.invoke(IpcChannel.PresetsSetOptions, id, options),
  renamePreset: (id, name) => ipcRenderer.invoke(IpcChannel.PresetsRename, id, name),
  deletePreset: (id) => ipcRenderer.invoke(IpcChannel.PresetsDelete, id),
  setDevicePreset: (serial, presetId) =>
    ipcRenderer.invoke(IpcChannel.DevicePresetSet, serial, presetId),
  chooseRecordingPath: () => ipcRenderer.invoke(IpcChannel.DialogChooseRecording),

  getWireless: () => ipcRenderer.invoke(IpcChannel.WirelessGet),
  watchWireless: () => ipcRenderer.invoke(IpcChannel.WirelessWatch),
  unwatchWireless: () => ipcRenderer.invoke(IpcChannel.WirelessUnwatch),
  onWirelessChanged: (callback) => subscribe(IpcChannel.WirelessChanged, callback),
  connectWireless: (address) => ipcRenderer.invoke(IpcChannel.WirelessConnect, address),
  pairWireless: (address, code) => ipcRenderer.invoke(IpcChannel.WirelessPair, address, code),
  disconnectWireless: (serial) => ipcRenderer.invoke(IpcChannel.WirelessDisconnect, serial),
  enableWifi: (serial) => ipcRenderer.invoke(IpcChannel.WirelessEnableWifi, serial),
  forgetWireless: (address) => ipcRenderer.invoke(IpcChannel.WirelessForget, address),
  reconnectWireless: (address) => ipcRenderer.invoke(IpcChannel.WirelessReconnect, address),
  setAutoReconnect: (enabled) => ipcRenderer.invoke(IpcChannel.WirelessSetAutoReconnect, enabled),

  screenshot: (serial) => ipcRenderer.invoke(IpcChannel.DeviceScreenshot, serial),
  sendFiles: (serial, paths) => ipcRenderer.invoke(IpcChannel.DeviceSendFiles, serial, paths),
  chooseAndSendFiles: (serial) => ipcRenderer.invoke(IpcChannel.DeviceChooseAndSend, serial),
  pathsForFiles: (files) => files.map((file) => webUtils.getPathForFile(file)).filter(Boolean),
  onTransferProgress: (callback) => subscribe(IpcChannel.DeviceTransferProgress, callback),
  listApps: (serial) => ipcRenderer.invoke(IpcChannel.DeviceListApps, serial),
  launchApp: (serial, packageName) =>
    ipcRenderer.invoke(IpcChannel.DeviceLaunchApp, serial, packageName),
  listSources: (serial, kind) => ipcRenderer.invoke(IpcChannel.DeviceListSources, serial, kind),

  listCaptures: () => ipcRenderer.invoke(IpcChannel.CapturesList),
  openCapture: (path) => ipcRenderer.invoke(IpcChannel.CapturesOpen, path),
  showCapture: (path) => ipcRenderer.invoke(IpcChannel.CapturesShow, path),
  removeCapture: (path) => ipcRenderer.invoke(IpcChannel.CapturesRemove, path),
  trashCapture: (path) => ipcRenderer.invoke(IpcChannel.CapturesTrash, path),
  chooseScreenshotFolder: () => ipcRenderer.invoke(IpcChannel.ScreenshotFolderChoose),
  resetScreenshotFolder: () => ipcRenderer.invoke(IpcChannel.ScreenshotFolderReset),
  openScreenshotFolder: () => ipcRenderer.invoke(IpcChannel.ScreenshotFolderOpen),

  getDiagnostics: () => ipcRenderer.invoke(IpcChannel.DiagnosticsGet),
  openLogFolder: () => ipcRenderer.invoke(IpcChannel.LogsOpenFolder),
  getAutostart: () => ipcRenderer.invoke(IpcChannel.AutostartGet),
  setAutostart: (enabled) => ipcRenderer.invoke(IpcChannel.AutostartSet, enabled),
  setCloseToTray: (enabled) => ipcRenderer.invoke(IpcChannel.PrefsCloseToTray, enabled),
  setPreferManagedScrcpy: (enabled) => ipcRenderer.invoke(IpcChannel.PrefsPreferManaged, enabled),
  setHotkey: (action, accelerator) => ipcRenderer.invoke(IpcChannel.HotkeySet, action, accelerator),
  getHotkeyProblems: () => ipcRenderer.invoke(IpcChannel.HotkeyProblems),
  getUpdates: () => ipcRenderer.invoke(IpcChannel.UpdatesGet),
  onUpdatesChanged: (callback) => subscribe(IpcChannel.UpdatesChanged, callback),
  checkScrcpyUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesCheckScrcpy),
  checkAppUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesCheckApp),
  downloadAppUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesDownloadApp),
  installAppUpdate: () => ipcRenderer.invoke(IpcChannel.UpdatesInstallApp),
  startOtg: (serial) => ipcRenderer.invoke(IpcChannel.SessionsStartOtg, serial),

  getSessions: () => ipcRenderer.invoke(IpcChannel.SessionsGet),
  startSession: (serial, overrides) =>
    ipcRenderer.invoke(IpcChannel.SessionsStart, serial, overrides),
  stopSession: (serial) => ipcRenderer.invoke(IpcChannel.SessionsStop, serial),
  startAllSessions: () => ipcRenderer.invoke(IpcChannel.SessionsStartAll),
  stopAllSessions: () => ipcRenderer.invoke(IpcChannel.SessionsStopAll),
  onSessionsChanged: (callback) => subscribe(IpcChannel.SessionsChanged, callback),
  getSessionLog: (serial) => ipcRenderer.invoke(IpcChannel.SessionsLogGet, serial),
  onSessionLog: (callback) => subscribe(IpcChannel.SessionsLog, callback)
}

contextBridge.exposeInMainWorld('api', api)

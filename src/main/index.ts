import {
  app,
  shell,
  BrowserWindow,
  clipboard,
  ClipboardItem,
  dialog,
  globalShortcut,
  Notification
} from 'electron'
import { arch, homedir, platform, release, userInfo } from 'os'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { runScrcpy } from './actions/run'
import { DeviceActions } from './actions/service'
import { adbDeviceBytes, adbShell } from './adb/client'
import { adbPush } from './adb/sync'
import { createAppUpdater } from './appUpdater'
import { getAutostart, HIDDEN_ARG } from './autostart'
import { Captures, resolveScreenshotFolder } from './captures'
import { DeviceService } from './devices'
import { buildReport } from './diagnostics'
import { HotkeyService } from './hotkeys'
import { registerIpc } from './ipc'
import { Logger } from './logger'
import { MirrorService } from './mirror'
import { isSafeExternalUrl, isTrustedUrl } from './security'
import { SessionManager } from './sessions/manager'
import { createWindowsDeps } from './sessions/windows'
import { SettingsStore } from './settings'
import { findManaged } from './tools/locate'
import { ToolManager } from './tools/manager'
import { fetchLatestRelease } from './tools/release'
import { TrayController } from './trayController'
import type { TrayAction } from './trayMenu'
import { UpdateService } from './updates'
import { createWirelessAdb } from './wireless/ops'
import { WirelessService } from './wireless/service'
import { defaultEndpoint } from './adb/client'

let devices: DeviceService | undefined
let settings: SettingsStore | undefined
let sessions: SessionManager | undefined
let wireless: WirelessService | undefined
let hotkeys: HotkeyService | undefined
let tray: TrayController | undefined
let mainWindow: BrowserWindow | null = null
let quitting = false

/** Launched at sign-in (or with --hidden): live in the tray and open no window. */
const startHidden = process.argv.includes(HIDDEN_ARG)

const localData = process.env['LOCALAPPDATA'] ?? app.getPath('userData')
const logsFolder = join(localData, 'DroidSync', 'logs')
const logger = new Logger(join(logsFolder, 'app.log'))

/** Everything that goes wrong should leave a line in the log, even when nobody is watching. */
function installCrashLogging(): void {
  for (const level of ['warn', 'error'] as const) {
    const original = console[level].bind(console)
    console[level] = (...parts: unknown[]) => {
      logger.write(level, parts)
      original(...parts)
    }
  }
  process.on('uncaughtException', (error) => logger.error('Uncaught exception:', error))
  process.on('unhandledRejection', (reason) => logger.error('Unhandled rejection:', reason))
  app.on('render-process-gone', (_e, contents, details) =>
    logger.error(
      'Renderer gone:',
      details.reason,
      `exit code ${details.exitCode}`,
      contents.getURL()
    )
  )
  app.on('child-process-gone', (_e, details) =>
    logger.error(
      'Child process gone:',
      details.type,
      details.reason,
      `exit code ${details.exitCode}`
    )
  )
}

function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show()
}

function showWindow(): void {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow(true)
    return
  }
  if (mainWindow.isMinimized()) mainWindow.restore()
  mainWindow.show()
  mainWindow.focus()
}

function toggleWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible() && mainWindow.isFocused()) {
    mainWindow.hide()
  } else {
    showWindow()
  }
}

function createWindow(show: boolean): void {
  const window = new BrowserWindow({
    width: 1000,
    height: 700,
    minWidth: 720,
    minHeight: 480,
    show: false,
    autoHideMenuBar: true,
    icon,
    // Windows 11 22H2+ Mica; ignored elsewhere. The renderer keeps a solid fallback colour.
    ...(process.platform === 'win32' ? { backgroundMaterial: 'mica' as const } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow = window

  window.on('ready-to-show', () => {
    if (show) window.show()
  })

  // With "keep running in the tray" on, the close button only hides the window.
  window.on('close', (event) => {
    if (!quitting && settings?.snapshot.closeToTray && tray) {
      event.preventDefault()
      window.hide()
    }
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  window.webContents.setWindowOpenHandler((details) => {
    if (isSafeExternalUrl(details.url)) shell.openExternal(details.url)
    return { action: 'deny' }
  })

  window.webContents.on('will-navigate', (event, url) => {
    if (!isTrustedUrl(url, process.env['ELECTRON_RENDERER_URL'])) event.preventDefault()
  })

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    window.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

/** A second launch (the shortcut clicked again) brings the running app forward instead. */
const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', () => showWindow())
  void app.whenReady().then(start)
}

async function start(): Promise<void> {
  installCrashLogging()
  logger.info(`Starting ${app.getName()} ${app.getVersion()}${startHidden ? ' (hidden)' : ''}`)
  electronApp.setAppUserModelId('io.github.amahasin.droidsync')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // Settings first: the tools lookup depends on them.
  const store = new SettingsStore(join(app.getPath('userData'), 'settings.json'))
  settings = store
  // Downloaded scrcpy builds live outside roaming AppData: they are binaries, not settings.
  const managedRoot = join(localData, 'DroidSync', 'scrcpy')
  const tools = new ToolManager(managedRoot, () => store.snapshot.preferManagedScrcpy)
  const deviceService = new DeviceService(tools)
  devices = deviceService
  const sessionManager = new SessionManager(createWindowsDeps())
  sessions = sessionManager
  const mirror = new MirrorService({
    tools,
    devices: deviceService,
    settings: store,
    sessions: sessionManager
  })
  const wirelessService = new WirelessService({
    adb: createWirelessAdb(defaultEndpoint()),
    settings: store,
    devices: deviceService
  })
  wireless = wirelessService
  deviceService.onChange(() => wirelessService.devicesChanged())

  const endpoint = defaultEndpoint()
  const actions = new DeviceActions({
    tools,
    devices: deviceService,
    adb: {
      shell: (serial, command, timeoutMs) => adbShell({ ...endpoint, serial, command, timeoutMs }),
      bytes: (serial, service, timeoutMs) =>
        adbDeviceBytes({ ...endpoint, serial, service, timeoutMs }),
      push: (serial, localPath, remotePath, onProgress) =>
        adbPush({ ...endpoint, serial, localPath, remotePath, onProgress })
    },
    runScrcpy,
    settings: {
      screenshotFolder: () =>
        resolveScreenshotFolder(store.snapshot.screenshotFolder, app.getPath('pictures')),
      addCapture: (entry) => store.addCapture(entry)
    },
    copyImage: async (png) => {
      try {
        const blob = new Blob([new Uint8Array(png)], { type: 'image/png' })
        await clipboard.write([new ClipboardItem({ 'image/png': blob })])
        return true
      } catch {
        return false
      }
    }
  })
  const captures = new Captures({
    settings: store,
    shell,
    confirmTrash: async (path) => {
      const options = {
        type: 'warning' as const,
        title: 'Move to Recycle Bin',
        message: 'Move this file to the Recycle Bin?',
        detail: path,
        buttons: ['Move to Recycle Bin', 'Cancel'],
        defaultId: 1,
        cancelId: 1
      }
      const parent = BrowserWindow.getFocusedWindow()
      const answer = parent
        ? await dialog.showMessageBox(parent, options)
        : await dialog.showMessageBox(options)
      return answer.response === 0
    }
  })

  // ── global shortcuts ──────────────────────────────────────────────────
  const screenshotAll = async (): Promise<void> => {
    const ready = deviceService.snapshot.devices.filter((d) => d.state === 'device')
    if (ready.length === 0) return notify('Screenshot', 'No device is ready.')
    for (const device of ready) {
      const result = await actions.screenshot(device.serial)
      const name = device.model ?? device.serial
      notify(
        result.ok ? `Screenshot of ${name}` : `Screenshot of ${name} failed`,
        result.ok ? `Saved${result.copied ? ' and copied' : ''}: ${result.path}` : result.error
      )
    }
  }
  const hotkeyService = new HotkeyService(
    {
      register: (accelerator, callback) => {
        try {
          return globalShortcut.register(accelerator, callback)
        } catch {
          return false
        }
      },
      unregister: (accelerator) => globalShortcut.unregister(accelerator)
    },
    {
      showWindow: toggleWindow,
      stopAll: () => void mirror.stopAll(),
      screenshot: () => void screenshotAll()
    }
  )
  hotkeys = hotkeyService
  const problems = hotkeyService.apply(store.snapshot.hotkeys)
  for (const [action, problem] of Object.entries(problems))
    logger.warn(`Hotkey ${action}: ${problem}`)

  // ── tray ──────────────────────────────────────────────────────────────
  const onTrayAction = (action: TrayAction): void => {
    switch (action.kind) {
      case 'show':
        return showWindow()
      case 'start': {
        const result = mirror.start(
          action.serial,
          action.presetId ? { presetId: action.presetId } : undefined
        )
        if (!result.ok) notify('Could not start mirroring', result.error)
        return
      }
      case 'stop':
        return void mirror.stop(action.serial)
      case 'screenshot': {
        void actions
          .screenshot(action.serial)
          .then((result) =>
            notify(
              result.ok ? 'Screenshot saved' : 'Screenshot failed',
              result.ok ? result.path : result.error
            )
          )
        return
      }
      case 'stopAll':
        return void mirror.stopAll()
      case 'quit':
        return app.quit()
    }
  }
  try {
    tray = new TrayController(icon, onTrayAction)
  } catch (error) {
    logger.error('Could not create the tray icon:', error)
  }
  const refreshTray = (): void =>
    tray?.update({
      devices: deviceService.snapshot.devices,
      sessions: sessionManager.list(),
      presets: store.snapshot.presets,
      canMirror: tools.state.status.scrcpy !== null
    })
  deviceService.onChange(refreshTray)
  sessionManager.onChange(refreshTray)
  store.onChange(refreshTray)
  tools.onChange(refreshTray)
  refreshTray()

  // ── updates ───────────────────────────────────────────────────────────
  const updates = new UpdateService({
    currentScrcpy: () => tools.state.status.scrcpy?.version ?? null,
    managedScrcpy: () => findManaged(managedRoot)?.version ?? null,
    fetchLatest: () => fetchLatestRelease(process.arch),
    appUpdater: await createAppUpdater(app.isPackaged, process.resourcesPath).catch((error) => {
      logger.error('Updater unavailable:', error)
      return null
    })
  })

  const diagnostics = async (): Promise<string> =>
    buildReport({
      app: {
        name: app.getName(),
        version: app.getVersion(),
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node
      },
      os: { platform: platform(), release: release(), arch: arch() },
      tools: tools.state,
      devices: deviceService.snapshot,
      sessions: sessionManager.list(),
      sessionLogs: Object.fromEntries(
        sessionManager.list().map((s) => [s.serial, sessionManager.getLog(s.serial)])
      ),
      settings: store.snapshot,
      autostart: getAutostart(app),
      logTail: logger.tail(80),
      now: new Date(),
      home: homedir(),
      userName: userInfo().username
    })

  registerIpc({
    tools,
    devices: deviceService,
    settings: store,
    sessions: sessionManager,
    mirror,
    wireless: wirelessService,
    actions,
    captures,
    hotkeys: hotkeyService,
    updates,
    diagnostics,
    logsFolder
  })

  // Resolve tools first so the tracker starts with the right adb.
  void tools.refresh().then(() => {
    deviceService.start()
    wirelessService.start()
  })
  createWindow(!startHidden)

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(true)
  })
}

let shuttingDown = false

app.on('before-quit', (event) => {
  quitting = true
  if (shuttingDown) return
  shuttingDown = true
  const cleanUp = (): void => {
    hotkeys?.dispose()
    tray?.dispose()
    devices?.stop()
    wireless?.stop()
  }
  // Close running mirrors gracefully first so they clean up their tunnels on the device.
  if (sessions && sessions.list().some((s) => s.state !== 'exited')) {
    event.preventDefault()
    void sessions.stopAll().finally(() => {
      cleanUp()
      app.quit()
    })
    return
  }
  cleanUp()
})

app.on('window-all-closed', () => {
  // Closing to the tray hides the window rather than closing it, so this means a real close.
  app.quit()
})

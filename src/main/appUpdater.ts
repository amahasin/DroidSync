import { existsSync } from 'fs'
import { join } from 'path'
import type { AppUpdater } from './updates'

/**
 * The app's own updater, built on electron-updater. It exists only in an installed build that was
 * packaged with an update feed (electron-builder writes resources/app-update.yml when `publish`
 * is set in electron-builder.yml). Anywhere else there is nothing to check, so this returns null.
 */
export async function createAppUpdater(
  isPackaged: boolean,
  resourcesPath: string
): Promise<AppUpdater | null> {
  if (!isPackaged || !existsSync(join(resourcesPath, 'app-update.yml'))) return null
  // electron-updater is a CommonJS module whose exports are getters, so depending on how the bundle
  // loads it, `autoUpdater` is on the namespace or on its default export.
  const loaded = await import('electron-updater')
  const fromDefault = (loaded as { default?: { autoUpdater?: typeof loaded.autoUpdater } }).default
  const autoUpdater = loaded.autoUpdater ?? fromDefault?.autoUpdater
  if (!autoUpdater) throw new Error('electron-updater did not load')
  // The person decides when to download and when to restart.
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = false
  return {
    async check() {
      const result = await autoUpdater.checkForUpdates()
      return result?.isUpdateAvailable ? { version: result.updateInfo.version } : null
    },
    async download(onProgress) {
      const listener = (progress: { percent: number }): void => onProgress(progress.percent)
      autoUpdater.on('download-progress', listener)
      try {
        await autoUpdater.downloadUpdate()
      } finally {
        autoUpdater.removeListener('download-progress', listener)
      }
    },
    quitAndInstall() {
      autoUpdater.quitAndInstall()
    }
  }
}

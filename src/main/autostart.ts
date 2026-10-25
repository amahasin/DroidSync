import type { AutostartState } from '../shared/models'

/** The login-item part of Electron's `app`, so the logic can be tested with a fake. */
export interface LoginItemApp {
  isPackaged: boolean
  getLoginItemSettings(options?: { args?: string[] }): { openAtLogin: boolean }
  setLoginItemSettings(settings: { openAtLogin: boolean; args?: string[] }): void
}

/** Launched this way at sign-in, the app starts in the tray without opening a window. */
export const HIDDEN_ARG = '--hidden'

/**
 * Start with Windows. A development build would register electron.exe itself, which is never what
 * anyone wants, so only an installed (packaged) build on Windows can turn this on.
 */
export function getAutostart(app: LoginItemApp, platform = process.platform): AutostartState {
  if (!app.isPackaged || platform !== 'win32') return { supported: false, enabled: false }
  return { supported: true, enabled: app.getLoginItemSettings({ args: [HIDDEN_ARG] }).openAtLogin }
}

export function setAutostart(
  app: LoginItemApp,
  enabled: unknown,
  platform = process.platform
): { ok: true } | { ok: false; error: string } {
  if (typeof enabled !== 'boolean') return { ok: false, error: 'Invalid setting.' }
  if (!getAutostart(app, platform).supported) {
    return { ok: false, error: 'Start with Windows is available in the installed app.' }
  }
  app.setLoginItemSettings({ openAtLogin: enabled, args: [HIDDEN_ARG] })
  return { ok: true }
}

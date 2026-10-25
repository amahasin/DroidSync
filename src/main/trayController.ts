import { Menu, Tray, nativeImage, type MenuItemConstructorOptions } from 'electron'
import {
  buildTrayMenu,
  trayTooltip,
  type TrayAction,
  type TrayItem,
  type TrayModel
} from './trayMenu'

function toElectron(
  items: TrayItem[],
  onAction: (action: TrayAction) => void
): MenuItemConstructorOptions[] {
  return items.map((item): MenuItemConstructorOptions => {
    if (item.type === 'separator') return { type: 'separator' }
    if (item.type === 'submenu') {
      return { label: item.label, enabled: item.enabled, submenu: toElectron(item.items, onAction) }
    }
    return { label: item.label, enabled: item.enabled, click: () => onAction(item.action) }
  })
}

/** The notification-area icon and its menu. The menu text is decided in buildTrayMenu. */
export class TrayController {
  private tray: Tray

  constructor(
    iconPath: string,
    private readonly onAction: (action: TrayAction) => void
  ) {
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 16, height: 16 })
    this.tray = new Tray(icon)
    // A left click opens the window; the menu is on the right click, like most tray apps.
    this.tray.on('click', () => this.onAction({ kind: 'show' }))
  }

  update(model: TrayModel): void {
    if (this.tray.isDestroyed()) return
    this.tray.setToolTip(trayTooltip(model.sessions))
    this.tray.setContextMenu(
      Menu.buildFromTemplate(toElectron(buildTrayMenu(model), this.onAction))
    )
  }

  dispose(): void {
    if (!this.tray.isDestroyed()) this.tray.destroy()
  }
}

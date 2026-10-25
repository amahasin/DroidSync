import type { Device, Preset, SessionInfo } from '../shared/models'

export type TrayAction =
  | { kind: 'show' }
  | { kind: 'start'; serial: string; presetId?: string }
  | { kind: 'stop'; serial: string }
  | { kind: 'screenshot'; serial: string }
  | { kind: 'stopAll' }
  | { kind: 'quit' }

export type TrayItem =
  | { type: 'separator' }
  | { type: 'item'; label: string; enabled: boolean; action: TrayAction }
  | { type: 'submenu'; label: string; enabled: boolean; items: TrayItem[] }

export interface TrayModel {
  devices: Device[]
  sessions: SessionInfo[]
  presets: Preset[]
  canMirror: boolean
}

/** Menu text is shown with & as an accelerator marker; a literal & has to be doubled. */
const text = (label: string): string => label.replace(/&/g, '&&')

const nameOf = (device: Device): string => device.model ?? device.serial

/**
 * What the tray menu holds right now: for every ready device a Start (with a choice of preset when
 * there is more than one) or Stop, plus a screenshot; then Stop all, Show and Quit.
 */
export function buildTrayMenu(model: TrayModel): TrayItem[] {
  const active = (serial: string): boolean =>
    model.sessions.some((s) => s.serial === serial && s.state !== 'exited')
  const items: TrayItem[] = [
    { type: 'item', label: 'Show DroidSync', enabled: true, action: { kind: 'show' } },
    { type: 'separator' }
  ]

  const ready = model.devices.filter((device) => device.state === 'device')
  if (ready.length === 0) {
    items.push({
      type: 'item',
      label: 'No devices ready',
      enabled: false,
      action: { kind: 'show' }
    })
  }
  for (const device of ready) {
    const name = text(nameOf(device))
    if (active(device.serial)) {
      items.push({
        type: 'item',
        label: `Stop ${name}`,
        enabled: true,
        action: { kind: 'stop', serial: device.serial }
      })
    } else if (model.presets.length > 1) {
      items.push({
        type: 'submenu',
        label: `Start ${name}`,
        enabled: model.canMirror,
        items: model.presets.map<TrayItem>((preset) => ({
          type: 'item',
          label: text(preset.name),
          enabled: model.canMirror,
          action: { kind: 'start', serial: device.serial, presetId: preset.id }
        }))
      })
    } else {
      items.push({
        type: 'item',
        label: `Start ${name}`,
        enabled: model.canMirror,
        action: { kind: 'start', serial: device.serial }
      })
    }
    items.push({
      type: 'item',
      label: `Screenshot of ${name}`,
      enabled: true,
      action: { kind: 'screenshot', serial: device.serial }
    })
  }

  const running = model.sessions.filter((s) => s.state !== 'exited').length
  items.push(
    { type: 'separator' },
    {
      type: 'item',
      label: running > 0 ? `Stop all (${running})` : 'Stop all',
      enabled: running > 0,
      action: { kind: 'stopAll' }
    },
    { type: 'separator' },
    { type: 'item', label: 'Quit', enabled: true, action: { kind: 'quit' } }
  )
  return items
}

/** Tooltip text for the tray icon. */
export function trayTooltip(sessions: SessionInfo[]): string {
  const running = sessions.filter((s) => s.state !== 'exited').length
  return running > 0 ? `DroidSync: ${running} mirroring` : 'DroidSync'
}

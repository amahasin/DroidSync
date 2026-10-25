import type {
  CaptureEntry,
  DevicesSnapshot,
  SessionInfo,
  SettingsState,
  ToolsState
} from '../shared/models'

export interface DiagnosticsInput {
  app: { name: string; version: string; electron: string; chrome: string; node: string }
  os: { platform: string; release: string; arch: string }
  tools: ToolsState
  devices: DevicesSnapshot
  sessions: SessionInfo[]
  /** Per-serial scrcpy output, most recent last. */
  sessionLogs: Record<string, string[]>
  settings: SettingsState
  autostart: { supported: boolean; enabled: boolean }
  /** Last lines of the app's own log. */
  logTail: string[]
  now: Date
  /** The person's home folder and user name, hidden from the report. */
  home: string
  userName: string
}

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Hides what a bug report should not carry: device serials become "device-1", other IPv4
 * addresses lose their last number, and the home folder and user name are replaced.
 */
export function redact(
  text: string,
  options: { serials: string[]; home: string; userName: string }
): string {
  let out = text
  const unique = [...new Set(options.serials)].filter(Boolean)
  // Longest first so one serial that contains another is replaced whole.
  ;[...unique]
    .sort((a, b) => b.length - a.length)
    .forEach((serial) => {
      out = out.replace(
        new RegExp(escapeRegExp(serial), 'g'),
        `device-${unique.indexOf(serial) + 1}`
      )
    })
  if (options.home) {
    const forward = options.home.replace(/\\/g, '/')
    out = out
      .replace(new RegExp(escapeRegExp(options.home), 'gi'), '%USERPROFILE%')
      .replace(new RegExp(escapeRegExp(forward), 'gi'), '%USERPROFILE%')
  }
  if (options.userName.length >= 3) {
    out = out.replace(new RegExp(`\\b${escapeRegExp(options.userName)}\\b`, 'gi'), '<user>')
  }
  return out.replace(/\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g, '$1.x')
}

const countByKind = (captures: CaptureEntry[], kind: CaptureEntry['kind']): number =>
  captures.filter((c) => c.kind === kind).length

/** A plain-text report that can be pasted into a bug report. */
export function buildReport(input: DiagnosticsInput): string {
  const { app, os, tools, devices, sessions, settings } = input
  const lines: string[] = []
  const add = (text = ''): number => lines.push(text)

  add(`${app.name} ${app.version} diagnostics`)
  add(`Created ${input.now.toISOString()}`)
  add()
  add('## App')
  add(`Electron ${app.electron}, Chrome ${app.chrome}, Node ${app.node}`)
  add(`${os.platform} ${os.release} (${os.arch})`)
  add(
    `Start with Windows: ${input.autostart.supported ? input.autostart.enabled : 'not available'}`
  )
  add()
  add('## Tools')
  const { scrcpy, adb } = tools.status
  add(
    scrcpy
      ? `scrcpy ${scrcpy.version ?? '?'} (${scrcpy.source === 'path' ? 'from PATH' : 'downloaded'}) at ${scrcpy.path}`
      : 'scrcpy: not found'
  )
  add(`  flags read from --help: ${scrcpy?.flags ? scrcpy.flags.length : 'none'}`)
  add(adb ? `adb ${adb.version ?? '?'} at ${adb.path}` : 'adb: not found')
  add(`Downloaded builds folder: ${tools.status.managedRoot}`)
  add()
  add('## Devices')
  add(`adb server: ${devices.adb}${devices.error ? ` (${devices.error})` : ''}`)
  if (devices.devices.length === 0) add('No devices.')
  for (const device of devices.devices) {
    add(
      `${device.serial}: ${device.state}${device.rawState !== device.state ? ` (${device.rawState})` : ''}, ` +
        `${device.connection}, ${device.manufacturer ?? '?'} ${device.model ?? '?'}, ` +
        `Android ${device.androidVersion ?? '?'} (API ${device.sdk ?? '?'})`
    )
  }
  add()
  add('## Settings')
  add(
    `${settings.presets.length} presets, ${Object.keys(settings.devicePresets).length} devices with their own preset`
  )
  add(
    `${settings.wireless.length} remembered Wi-Fi devices, auto-reconnect ${settings.autoReconnect}`
  )
  add(
    `Close to tray: ${settings.closeToTray}, prefer downloaded scrcpy: ${settings.preferManagedScrcpy}`
  )
  add(
    `Hotkeys set: ${
      Object.entries(settings.hotkeys)
        .filter(([, accelerator]) => accelerator)
        .map(([action]) => action)
        .join(', ') || 'none'
    }`
  )
  add(
    `Captures listed: ${countByKind(settings.captures, 'recording')} recordings, ` +
      `${countByKind(settings.captures, 'screenshot')} screenshots`
  )
  add()
  add('## Sessions')
  if (sessions.length === 0) add('None.')
  for (const session of sessions) {
    add(
      `${session.serial}: ${session.state}${session.exitCode !== null ? `, exit code ${session.exitCode}` : ''}` +
        `${session.error ? `, ${session.error}` : ''}`
    )
    add(`  ${session.command}`)
    const log = input.sessionLogs[session.serial] ?? []
    if (log.length > 0) {
      add('  last output:')
      for (const line of log.slice(-30)) add(`    ${line}`)
    }
  }
  add()
  add('## App log (last lines)')
  if (input.logTail.length === 0) add('Empty.')
  for (const line of input.logTail) add(line)

  return redact(lines.join('\n'), {
    serials: devices.devices.map((d) => d.serial).concat(sessions.map((s) => s.serial)),
    home: input.home,
    userName: input.userName
  })
}

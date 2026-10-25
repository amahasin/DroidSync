import { useState } from 'react'
import {
  DEFAULT_PRESET_ID,
  type Device,
  type DevicesSnapshot,
  type SessionInfo,
  type SettingsState,
  type StartAllResult,
  type WirelessResult
} from '../../../shared/models'
import { useDeviceTools, useSessionLog } from '../hooks'
import { androidLabel, connectionLabel, deviceTitle, sessionLabel, stateLabel } from '../labels'
import { AppLauncher } from './AppLauncher'
import { DeviceTools } from './DeviceTools'

interface CardProps {
  device: Device
  session: SessionInfo | undefined
  settings: SettingsState
  canMirror: boolean
  /** This scrcpy can open an app as mirroring starts (--start-app). */
  canMirrorApp: boolean
  /** This scrcpy has keyboard and mouse mode (--otg). */
  canOtg: boolean
}

function DeviceCard({
  device,
  session,
  settings,
  canMirror,
  canMirrorApp,
  canOtg
}: CardProps): React.JSX.Element {
  const state = stateLabel(device.state)
  const android = androidLabel(device)
  const [startError, setStartError] = useState<string | null>(null)
  const [showLog, setShowLog] = useState(false)
  const lines = useSessionLog(device.serial, showLog)
  const tools = useDeviceTools(device.serial)
  const [showApps, setShowApps] = useState(false)
  const [dragging, setDragging] = useState(false)
  const ready = device.state === 'device'

  // Files dropped on a ready device's card are installed (APKs) or copied (everything else).
  const hasFiles = (event: React.DragEvent): boolean => event.dataTransfer.types.includes('Files')
  const dropProps = ready
    ? {
        onDragEnter: (event: React.DragEvent) => {
          if (hasFiles(event)) {
            event.preventDefault()
            setDragging(true)
          }
        },
        onDragOver: (event: React.DragEvent) => {
          if (hasFiles(event)) event.preventDefault()
        },
        onDragLeave: (event: React.DragEvent) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false)
        },
        onDrop: (event: React.DragEvent) => {
          if (!hasFiles(event)) return
          event.preventDefault()
          setDragging(false)
          const paths = window.api.pathsForFiles(Array.from(event.dataTransfer.files))
          if (paths.length > 0 && !tools.sending) void tools.send(paths)
        }
      }
    : {}

  const assigned = settings.devicePresets[device.serial] ?? DEFAULT_PRESET_ID
  const active = !!session && session.state !== 'exited'
  const label = session ? sessionLabel(session) : null
  // An exited session's error explains why the last attempt ended.
  const problem = startError ?? (session?.state === 'exited' ? session.error : null)

  const [wirelessBusy, setWirelessBusy] = useState(false)
  const [wirelessResult, setWirelessResult] = useState<WirelessResult | null>(null)

  const start = async (startApp?: string): Promise<void> => {
    setStartError(null)
    const result = await window.api.startSession(device.serial, startApp ? { startApp } : undefined)
    if (!result.ok) setStartError(result.error)
  }

  const startOtg = async (): Promise<void> => {
    setStartError(null)
    const result = await window.api.startOtg(device.serial)
    if (!result.ok) setStartError(result.error)
  }

  const runWireless = async (action: () => Promise<WirelessResult>): Promise<void> => {
    setWirelessBusy(true)
    setWirelessResult(null)
    try {
      setWirelessResult(await action())
    } finally {
      setWirelessBusy(false)
    }
  }

  return (
    <li className={`device ${dragging ? 'dragging' : ''}`} {...dropProps}>
      <div className="device-top">
        <div className="device-main">
          <h3>{deviceTitle(device)}</h3>
          <p className="muted">
            <code>{device.serial}</code>
            {' · '}
            {connectionLabel(device)}
            {android && ` · ${android}`}
          </p>
          {state.hint && <p className="hint">{state.hint}</p>}
        </div>
        <div className="device-side">
          <span className={`badge ${label?.tone ?? state.tone}`}>{label?.text ?? state.text}</span>
          {device.state === 'device' &&
            (active ? (
              <button
                type="button"
                onClick={() => void window.api.stopSession(device.serial)}
                disabled={session?.state === 'stopping'}
              >
                {session?.state === 'stopping' ? 'Stopping…' : 'Stop'}
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                onClick={() => void start()}
                disabled={!canMirror}
                title={canMirror ? undefined : 'Install scrcpy first'}
              >
                Start mirroring
              </button>
            ))}
        </div>
      </div>

      {device.state === 'device' && (
        <div className="device-preset">
          <label htmlFor={`preset-${device.serial}`}>Preset</label>
          <select
            id={`preset-${device.serial}`}
            value={assigned}
            onChange={(event) =>
              void window.api.setDevicePreset(
                device.serial,
                event.target.value === DEFAULT_PRESET_ID ? null : event.target.value
              )
            }
          >
            {settings.presets.map((preset) => (
              <option key={preset.id} value={preset.id}>
                {preset.name}
              </option>
            ))}
          </select>
          {active && <span className="muted">Applies the next time it starts.</span>}
        </div>
      )}

      {ready && (
        <DeviceTools
          handle={tools}
          appsOpen={showApps}
          onToggleApps={() => setShowApps((open) => !open)}
          dragging={dragging}
          otg={
            device.connection === 'usb'
              ? {
                  disabledReason: active
                    ? 'Stop mirroring first'
                    : !canMirror
                      ? 'Install scrcpy first'
                      : !canOtg
                        ? 'This version of scrcpy has no keyboard and mouse mode'
                        : null,
                  start: () => void startOtg()
                }
              : null
          }
        />
      )}
      {ready && showApps && (
        <AppLauncher
          serial={device.serial}
          canMirrorApp={canMirror && canMirrorApp}
          mirroring={active}
          onMirrorApp={start}
        />
      )}

      {(device.connection === 'tcpip' || device.state === 'device') && (
        <div className="device-wireless">
          {device.connection === 'usb' ? (
            <button
              type="button"
              disabled={wirelessBusy || active}
              title={active ? 'Stop mirroring first: switching restarts the connection' : undefined}
              onClick={() => void runWireless(() => window.api.enableWifi(device.serial))}
            >
              {wirelessBusy ? 'Switching…' : 'Switch to Wi-Fi'}
            </button>
          ) : (
            <button
              type="button"
              disabled={wirelessBusy}
              onClick={() => void runWireless(() => window.api.disconnectWireless(device.serial))}
            >
              Disconnect
            </button>
          )}
          {wirelessResult &&
            (wirelessResult.ok ? (
              <span className="ok-text" role="status">
                {wirelessResult.message}
              </span>
            ) : (
              <span className="error" role="alert">
                {wirelessResult.error}
              </span>
            ))}
        </div>
      )}

      {problem && (
        <p className="error problem" role="alert">
          {problem}
        </p>
      )}

      {session && (
        <div className="log-toggle">
          <button type="button" className="link" onClick={() => setShowLog((v) => !v)}>
            {showLog ? 'Hide log' : 'Show log'}
          </button>
        </div>
      )}
      {session && showLog && <LogView lines={lines} />}
    </li>
  )
}

function LogView({ lines }: { lines: string[] }): React.JSX.Element {
  return (
    <pre
      className="log"
      tabIndex={0}
      aria-label="scrcpy output"
      ref={(element) => {
        if (element) element.scrollTop = element.scrollHeight
      }}
    >
      {lines.length ? lines.join('\n') : 'No output yet.'}
    </pre>
  )
}

interface ListProps {
  snapshot: DevicesSnapshot
  sessions: SessionInfo[]
  settings: SettingsState
  adbInstalled: boolean
  canMirror: boolean
  canMirrorApp: boolean
  canOtg: boolean
}

/** Start or stop every device at once, and say which ones could not start. */
function BulkActions({
  devices,
  sessions,
  canMirror
}: {
  devices: Device[]
  sessions: SessionInfo[]
  canMirror: boolean
}): React.JSX.Element | null {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<StartAllResult | null>(null)

  const isActive = (serial: string): boolean =>
    sessions.some((s) => s.serial === serial && s.state !== 'exited')
  const ready = devices.filter((d) => d.state === 'device')
  const idle = ready.filter((d) => !isActive(d.serial))
  const running = sessions.filter((s) => s.state !== 'exited').length

  // One device needs no bulk buttons: its card has Start and Stop.
  if (ready.length < 2 && running < 2) return null

  const startAll = async (): Promise<void> => {
    setBusy(true)
    setResult(null)
    try {
      setResult(await window.api.startAllSessions())
    } finally {
      setBusy(false)
    }
  }

  const nameOf = (serial: string): string => {
    const device = devices.find((d) => d.serial === serial)
    return device ? deviceTitle(device) : serial
  }

  return (
    <div className="bulk">
      <div className="bulk-buttons">
        <button
          type="button"
          className="primary"
          onClick={() => void startAll()}
          disabled={busy || !canMirror || idle.length === 0}
        >
          Start all ready ({idle.length})
        </button>
        <button
          type="button"
          onClick={() => void window.api.stopAllSessions()}
          disabled={running === 0}
        >
          Stop all ({running})
        </button>
      </div>
      {result && result.failed.length > 0 && (
        <ul className="error bulk-errors" role="alert">
          {result.failed.map((failure) => (
            <li key={failure.serial}>
              {nameOf(failure.serial)}: {failure.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

export function DeviceList({
  snapshot,
  sessions,
  settings,
  adbInstalled,
  canMirror,
  canMirrorApp,
  canOtg
}: ListProps): React.JSX.Element {
  if (!adbInstalled) {
    return (
      <section className="empty">
        <h2>adb is not installed</h2>
        <p className="muted">
          Devices will be listed here once scrcpy (which includes adb) is set up.
        </p>
      </section>
    )
  }

  if (snapshot.adb === 'unavailable') {
    return (
      <section className="empty">
        <h2>Can’t reach adb</h2>
        <p className="muted">{snapshot.error ?? 'The adb server is not responding.'}</p>
        <p className="muted">Retrying automatically…</p>
      </section>
    )
  }

  if (snapshot.adb === 'starting' && snapshot.devices.length === 0) {
    return (
      <section className="empty">
        <p className="muted">Starting adb…</p>
      </section>
    )
  }

  if (snapshot.devices.length === 0) {
    return (
      <section className="empty">
        <h2>No devices</h2>
        <ol className="steps muted">
          <li>On the phone, enable Developer options, then USB debugging.</li>
          <li>Connect it with a USB cable and accept the prompt on the phone.</li>
        </ol>
        <p className="muted">Or set it up over Wi-Fi on the Wireless tab.</p>
        <p className="muted">The list updates by itself when a device appears.</p>
      </section>
    )
  }

  // adb lists devices in connection order; a stable order keeps cards from jumping around.
  const ordered = [...snapshot.devices].sort(
    (a, b) => deviceTitle(a).localeCompare(deviceTitle(b)) || a.serial.localeCompare(b.serial)
  )

  return (
    <>
      <BulkActions devices={ordered} sessions={sessions} canMirror={canMirror} />
      <ul className="devices" aria-label="Devices">
        {ordered.map((device) => (
          <DeviceCard
            key={`${device.serial}-${device.transportId ?? ''}`}
            device={device}
            session={sessions.find((s) => s.serial === device.serial)}
            settings={settings}
            canMirror={canMirror}
            canMirrorApp={canMirrorApp}
            canOtg={canOtg}
          />
        ))}
      </ul>
    </>
  )
}

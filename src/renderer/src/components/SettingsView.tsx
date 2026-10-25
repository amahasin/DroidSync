import { useEffect, useState } from 'react'
import { acceleratorFromKeyPress } from '../../../shared/hotkeys'
import {
  HOTKEY_ACTIONS,
  type ActionResult,
  type HotkeyAction,
  type SettingsState,
  type ToolsState,
  type UpdatesState
} from '../../../shared/models'
import { useAutostart, useUpdates } from '../hooks'
import { downloadFraction, downloadText } from '../labels'

const ACTION_LABELS: Record<HotkeyAction, { label: string; hint: string }> = {
  showWindow: { label: 'Show or hide the window', hint: 'Works from any program.' },
  stopAll: { label: 'Stop all mirroring', hint: 'Closes every scrcpy window this app started.' },
  screenshot: {
    label: 'Take a screenshot',
    hint: 'Of every ready device. A notification tells you where it went.'
  }
}

/** Shows the outcome of the last change, right where it was made. */
function Note({ result }: { result: ActionResult | null }): React.JSX.Element | null {
  if (!result || result.ok) return null
  return (
    <p className="error" role="alert">
      {result.error}
    </p>
  )
}

function GeneralCard({ settings }: { settings: SettingsState }): React.JSX.Element {
  const autostart = useAutostart()
  const [result, setResult] = useState<ActionResult | null>(null)
  return (
    <section className="card">
      <h2>General</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={autostart.state?.enabled ?? false}
          disabled={!autostart.state?.supported}
          onChange={(event) => void autostart.set(event.target.checked).then(setResult)}
        />
        Start with Windows (in the tray, without opening the window)
      </label>
      {autostart.state && !autostart.state.supported && (
        <p className="muted field-note">
          Available in the installed app, not in a development build.
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={settings.closeToTray}
          onChange={(event) => void window.api.setCloseToTray(event.target.checked)}
        />
        Keep running in the tray when the window is closed
      </label>
      <p className="muted field-note">
        The tray icon starts and stops mirroring and takes screenshots without opening the window.
        Quit from its menu.
      </p>
      <Note result={result} />
    </section>
  )
}

function HotkeyRow({
  action,
  value,
  problem
}: {
  action: HotkeyAction
  value: string | null
  problem: string | undefined
}): React.JSX.Element {
  const [capturing, setCapturing] = useState(false)
  const [result, setResult] = useState<ActionResult | null>(null)
  const { label, hint } = ACTION_LABELS[action]

  const save = (accelerator: string | null): void => {
    void window.api.setHotkey(action, accelerator).then(setResult)
  }

  return (
    <li className="row hotkey-row">
      <div>
        <strong>{label}</strong>
        <p className="muted field-note">{hint}</p>
        {problem && value && (
          <p className="error field-note" role="alert">
            {problem}
          </p>
        )}
        <Note result={result} />
      </div>
      <div className="row-actions">
        <input
          type="text"
          readOnly
          className="hotkey-input"
          aria-label={`Shortcut for ${label}`}
          value={capturing ? 'Press the keys…' : (value ?? 'Not set')}
          onFocus={() => {
            setCapturing(true)
            setResult(null)
          }}
          onBlur={() => setCapturing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Tab') return
            event.preventDefault()
            if (event.key === 'Escape') return event.currentTarget.blur()
            const accelerator = acceleratorFromKeyPress(event.nativeEvent)
            // Wait for the real key while only modifiers are down.
            if (!accelerator) return
            event.currentTarget.blur()
            save(accelerator)
          }}
        />
        {value && (
          <button type="button" onClick={() => save(null)}>
            Clear
          </button>
        )}
      </div>
    </li>
  )
}

function ShortcutsCard({ settings }: { settings: SettingsState }): React.JSX.Element {
  const [problems, setProblems] = useState<Partial<Record<HotkeyAction, string>>>({})
  const signature = HOTKEY_ACTIONS.map((a) => settings.hotkeys[a] ?? '').join('|')
  useEffect(() => {
    void window.api.getHotkeyProblems().then(setProblems)
  }, [signature])
  return (
    <section className="card">
      <h2>Keyboard shortcuts</h2>
      <p className="muted">
        Click a box and press the keys, like Ctrl+Alt+S. A shortcut needs Ctrl, Alt or the Windows
        key. Escape cancels.
      </p>
      <ul className="rows" aria-label="Keyboard shortcuts">
        {HOTKEY_ACTIONS.map((action) => (
          <HotkeyRow
            key={action}
            action={action}
            value={settings.hotkeys[action]}
            problem={problems[action]}
          />
        ))}
      </ul>
    </section>
  )
}

function ScrcpyUpdateCard({
  settings,
  tools,
  updates
}: {
  settings: SettingsState
  tools: ToolsState
  updates: UpdatesState
}): React.JSX.Element {
  const { scrcpy } = updates
  const { download, status } = tools
  const busy = ['checking', 'downloading', 'verifying', 'extracting'].includes(download.phase)
  const checking = scrcpy.phase === 'checking'
  const using = status.scrcpy
  const downloaded = scrcpy.managedVersion

  return (
    <section className="card">
      <h2>scrcpy</h2>
      <p>
        {using ? (
          <>
            Using scrcpy <strong>{using.version ?? '?'}</strong>{' '}
            <span className="muted">
              ({using.source === 'path' ? 'found on PATH' : 'downloaded by this app'})
            </span>
          </>
        ) : (
          'scrcpy is not installed.'
        )}
      </p>
      <div className="form-row">
        <button
          type="button"
          onClick={() => void window.api.checkScrcpyUpdate()}
          disabled={checking}
        >
          {checking ? 'Checking…' : 'Check for a newer scrcpy'}
        </button>
        {scrcpy.phase === 'done' && !scrcpy.newer && (
          <span className="ok-text">scrcpy {scrcpy.latest} is the newest. You are up to date.</span>
        )}
        {scrcpy.phase === 'done' && scrcpy.newer && (
          <>
            <span>
              scrcpy <strong>{scrcpy.latest}</strong> is available.
            </span>
            <button
              type="button"
              className="primary"
              disabled={busy}
              onClick={() => void window.api.downloadScrcpy()}
            >
              {busy ? 'Downloading…' : `Download ${scrcpy.latest}`}
            </button>
          </>
        )}
      </div>
      {scrcpy.phase === 'error' && (
        <p className="error" role="alert">
          {scrcpy.error}
        </p>
      )}
      {busy && (
        <>
          <progress
            value={downloadFraction(download) ?? undefined}
            max={1}
            aria-label="Download progress"
          />
          <p className="muted">{downloadText(download)}</p>
        </>
      )}
      {download.phase === 'error' && <p className="error">{downloadText(download)}</p>}
      {download.phase === 'done' && (
        <p className="ok-text" role="status">
          Downloaded. Turn on the option below to use it.
        </p>
      )}
      <label className="check">
        <input
          type="checkbox"
          checked={settings.preferManagedScrcpy}
          disabled={!downloaded && !settings.preferManagedScrcpy}
          onChange={(event) => void window.api.setPreferManagedScrcpy(event.target.checked)}
        />
        Use the downloaded scrcpy{downloaded ? ` (${downloaded})` : ''} instead of the one on PATH
      </label>
      <p className="muted field-note">
        A downloaded scrcpy brings its own adb. If that adb is a different version from the one
        already running, the adb server restarts once and wireless devices reconnect. Stop mirroring
        first.
      </p>
    </section>
  )
}

function AppUpdateCard({ updates }: { updates: UpdatesState }): React.JSX.Element {
  const { app } = updates
  const [result, setResult] = useState<ActionResult | null>(null)
  return (
    <section className="card">
      <h2>This app</h2>
      {app.phase === 'unconfigured' ? (
        <p className="muted">
          This build does not check for updates. Install a newer setup file to update it.
        </p>
      ) : (
        <div className="form-row">
          <button
            type="button"
            onClick={() => void window.api.checkAppUpdate()}
            disabled={app.phase === 'checking' || app.phase === 'downloading'}
          >
            {app.phase === 'checking' ? 'Checking…' : 'Check for updates'}
          </button>
          {app.phase === 'current' && <span className="ok-text">You have the newest version.</span>}
          {app.phase === 'available' && (
            <>
              <span>
                Version <strong>{app.version}</strong> is available.
              </span>
              <button
                type="button"
                className="primary"
                onClick={() => void window.api.downloadAppUpdate().then(setResult)}
              >
                Download
              </button>
            </>
          )}
          {app.phase === 'downloading' && <span>Downloading… {app.percent}%</span>}
          {app.phase === 'ready' && (
            <button
              type="button"
              className="primary"
              onClick={() => void window.api.installAppUpdate().then(setResult)}
            >
              Restart to update
            </button>
          )}
        </div>
      )}
      {app.phase === 'error' && (
        <p className="error" role="alert">
          {app.error}
        </p>
      )}
      <Note result={result} />
    </section>
  )
}

function TroubleshootingCard(): React.JSX.Element {
  const [report, setReport] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [problem, setProblem] = useState<string | null>(null)

  const build = async (): Promise<void> => {
    setBusy(true)
    setCopied(false)
    try {
      setReport(await window.api.getDiagnostics())
    } finally {
      setBusy(false)
    }
  }

  const copy = (): void => {
    if (report === null) return
    void navigator.clipboard
      .writeText(report)
      .then(() => setCopied(true))
      .catch(() => setProblem('Could not copy. Select the text and copy it by hand.'))
  }

  return (
    <section className="card">
      <h2>Troubleshooting</h2>
      <p className="muted">
        The report lists versions, tools, devices and recent output for a bug report. Device
        serials, IP addresses and your user name are hidden. Read it before you share it.
      </p>
      <div className="form-row">
        <button type="button" onClick={() => void build()} disabled={busy}>
          {busy ? 'Collecting…' : report === null ? 'Create diagnostics report' : 'Refresh report'}
        </button>
        {report !== null && (
          <button type="button" className="primary" onClick={copy}>
            {copied ? 'Copied' : 'Copy report'}
          </button>
        )}
        <button
          type="button"
          onClick={() =>
            void window.api.openLogFolder().then((r) => setProblem(r.ok ? null : r.error))
          }
        >
          Open log folder
        </button>
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
      {report !== null && (
        <pre className="report" tabIndex={0} aria-label="Diagnostics report">
          {report}
        </pre>
      )}
    </section>
  )
}

export function SettingsView({
  settings,
  tools
}: {
  settings: SettingsState
  tools: ToolsState
}): React.JSX.Element {
  const updates = useUpdates()
  return (
    <div className="settings-view">
      <GeneralCard settings={settings} />
      <ShortcutsCard settings={settings} />
      {updates && <ScrcpyUpdateCard settings={settings} tools={tools} updates={updates} />}
      {updates && <AppUpdateCard updates={updates} />}
      <TroubleshootingCard />
    </div>
  )
}

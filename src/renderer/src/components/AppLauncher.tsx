import { useEffect, useMemo, useState } from 'react'
import type { AppEntry, AppsResult } from '../../../shared/models'

interface Props {
  serial: string
  /** This scrcpy can open an app as mirroring starts. */
  canMirrorApp: boolean
  /** Mirroring is already running, so an app can only be opened on the device. */
  mirroring: boolean
  onMirrorApp: (packageName: string) => Promise<void>
}

const byName = (a: AppEntry, b: AppEntry): number =>
  (a.label ?? a.packageName).localeCompare(b.label ?? b.packageName, undefined, {
    sensitivity: 'base'
  })

/** Lists the apps on a device and opens one, on the device or as mirroring starts. */
export function AppLauncher({
  serial,
  canMirrorApp,
  mirroring,
  onMirrorApp
}: Props): React.JSX.Element {
  // The answer is kept with the request it belongs to, so a refresh shows "reading" again.
  const [loaded, setLoaded] = useState<{ key: string; result: AppsResult } | null>(null)
  const [query, setQuery] = useState('')
  const [showSystem, setShowSystem] = useState(false)
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null)
  const [reload, setReload] = useState(0)
  const key = `${serial}#${reload}`
  const result = loaded?.key === key ? loaded.result : null

  useEffect(() => {
    let current = true
    void window.api.listApps(serial).then((next) => {
      if (current) setLoaded({ key: `${serial}#${reload}`, result: next })
    })
    return () => {
      current = false
    }
  }, [serial, reload])

  const apps = useMemo(() => (result?.ok ? [...result.apps].sort(byName) : []), [result])
  const hasUserApps = apps.some((app) => app.system === false)
  const needle = query.trim().toLowerCase()
  const shown = apps.filter(
    (app) =>
      (showSystem || !hasUserApps || app.system !== true) &&
      (needle === '' ||
        app.packageName.toLowerCase().includes(needle) ||
        (app.label ?? '').toLowerCase().includes(needle))
  )

  const open = async (packageName: string): Promise<void> => {
    setMessage(null)
    const outcome = await window.api.launchApp(serial, packageName)
    setMessage(
      outcome.ok ? { ok: true, text: 'Opened on the device.' } : { ok: false, text: outcome.error }
    )
  }

  const mirrorWith = async (packageName: string): Promise<void> => {
    setMessage(null)
    await onMirrorApp(packageName)
  }

  return (
    <div className="app-launcher">
      {!result ? (
        <p className="muted">Reading the apps on the device…</p>
      ) : !result.ok ? (
        <p className="error" role="alert">
          {result.error}
        </p>
      ) : (
        <>
          <div className="toolbar">
            <input
              type="search"
              className="search"
              placeholder="Search apps"
              aria-label="Search apps"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {hasUserApps && (
              <label className="check">
                <input
                  type="checkbox"
                  checked={showSystem}
                  onChange={(event) => setShowSystem(event.target.checked)}
                />
                System apps
              </label>
            )}
            <button type="button" onClick={() => setReload((n) => n + 1)}>
              Refresh
            </button>
          </div>
          {result.source === 'adb' && (
            <p className="muted field-note">
              Showing package names. App names need scrcpy 3.0 or newer.
            </p>
          )}
          {!canMirrorApp && (
            <p className="muted field-note">
              This version of scrcpy cannot open an app as mirroring starts, so apps open on the
              device only.
            </p>
          )}
          {shown.length === 0 ? (
            <p className="muted">
              {needle ? `No apps match “${query.trim()}”.` : 'No apps found.'}
            </p>
          ) : (
            <ul className="rows app-list" aria-label="Apps">
              {shown.map((app) => (
                <li key={app.packageName} className="row">
                  <div className="app-name">
                    <strong>{app.label ?? app.packageName}</strong>
                    {app.label && <code> {app.packageName}</code>}
                  </div>
                  <div className="row-actions">
                    <button type="button" onClick={() => void open(app.packageName)}>
                      Open
                    </button>
                    {canMirrorApp && (
                      <button
                        type="button"
                        disabled={mirroring}
                        title={mirroring ? 'Stop mirroring first' : 'Start mirroring with this app'}
                        onClick={() => void mirrorWith(app.packageName)}
                      >
                        Mirror it
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {message && (
        <p className={message.ok ? 'ok-text' : 'error'} role={message.ok ? 'status' : 'alert'}>
          {message.text}
        </p>
      )}
    </div>
  )
}

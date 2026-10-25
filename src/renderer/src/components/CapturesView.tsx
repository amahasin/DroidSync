import { useState } from 'react'
import type { ActionResult, CaptureItem, SettingsState } from '../../../shared/models'
import { fileName, formatBytes } from '../format'
import { useCaptures } from '../hooks'

type Filter = 'all' | 'recording' | 'screenshot'

const kindLabel = (item: CaptureItem): string =>
  item.kind === 'recording' ? 'Recording' : 'Screenshot'

function FolderCard({ settings }: { settings: SettingsState }): React.JSX.Element {
  const [problem, setProblem] = useState<string | null>(null)
  const report = (result: ActionResult): void =>
    setProblem(result.ok || result.error === 'Cancelled.' ? null : result.error)

  return (
    <section className="card">
      <h2>Screenshot folder</h2>
      <p>
        <code>{settings.screenshotFolder ?? 'Pictures\\DroidSync'}</code>
        {settings.screenshotFolder === null && <span className="muted"> (default)</span>}
      </p>
      <div className="form-row">
        <button type="button" onClick={() => void window.api.chooseScreenshotFolder().then(report)}>
          Change…
        </button>
        <button type="button" onClick={() => void window.api.openScreenshotFolder().then(report)}>
          Open folder
        </button>
        {settings.screenshotFolder !== null && (
          <button
            type="button"
            onClick={() => void window.api.resetScreenshotFolder().then(report)}
          >
            Use the default
          </button>
        )}
      </div>
      {problem && (
        <p className="error" role="alert">
          {problem}
        </p>
      )}
    </section>
  )
}

function CaptureRow({
  item,
  onResult
}: {
  item: CaptureItem
  onResult: (result: ActionResult) => void
}): React.JSX.Element {
  const when = new Date(item.at).toLocaleString()
  return (
    <li className="row">
      <div className="capture-main">
        <strong title={item.path}>{fileName(item.path)}</strong>
        <p className="muted capture-meta">
          <span className="badge neutral">{kindLabel(item)}</span> {item.device} · {when}
          {item.exists && item.size !== null && ` · ${formatBytes(item.size)}`}
          {!item.exists && <span className="bad-text"> · file not found</span>}
        </p>
      </div>
      <div className="row-actions">
        {item.exists && (
          <>
            <button
              type="button"
              onClick={() => void window.api.openCapture(item.path).then(onResult)}
            >
              Open
            </button>
            <button
              type="button"
              onClick={() => void window.api.showCapture(item.path).then(onResult)}
            >
              Show in folder
            </button>
          </>
        )}
        <button
          type="button"
          title="Remove from this list. The file stays on disk."
          onClick={() => void window.api.removeCapture(item.path).then(onResult)}
        >
          Remove from list
        </button>
        {item.exists && (
          <button
            type="button"
            title="Move the file to the Recycle Bin"
            onClick={() => void window.api.trashCapture(item.path).then(onResult)}
          >
            Delete…
          </button>
        )}
      </div>
    </li>
  )
}

/** Recordings and screenshots made with this app, and where screenshots are saved. */
export function CapturesView({ settings }: { settings: SettingsState }): React.JSX.Element {
  const { items, refresh } = useCaptures(settings)
  const [filter, setFilter] = useState<Filter>('all')
  const [problem, setProblem] = useState<string | null>(null)

  const shown = (items ?? []).filter((item) => filter === 'all' || item.kind === filter)
  const onResult = (result: ActionResult): void => {
    setProblem(result.ok || result.error === 'Cancelled.' ? null : result.error)
    refresh()
  }

  return (
    <div className="captures-view">
      <FolderCard settings={settings} />
      <section className="card">
        <h2>Recordings and screenshots</h2>
        <div className="toolbar">
          <label htmlFor="capture-filter">Show</label>
          <select
            id="capture-filter"
            value={filter}
            onChange={(event) => setFilter(event.target.value as Filter)}
          >
            <option value="all">Everything</option>
            <option value="recording">Recordings</option>
            <option value="screenshot">Screenshots</option>
          </select>
          <button type="button" onClick={refresh}>
            Refresh
          </button>
        </div>
        {problem && (
          <p className="error" role="alert">
            {problem}
          </p>
        )}
        {items === null ? (
          <p className="muted">Loading…</p>
        ) : shown.length === 0 ? (
          <p className="muted">
            {items.length === 0
              ? 'Nothing yet. Screenshots taken here and recordings started here are listed. Set a recording file in Options & presets.'
              : 'Nothing of that kind yet.'}
          </p>
        ) : (
          <ul className="rows" aria-label="Recordings and screenshots">
            {shown.map((item) => (
              <CaptureRow key={item.path} item={item} onResult={onResult} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

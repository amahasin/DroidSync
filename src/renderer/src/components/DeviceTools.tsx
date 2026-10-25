import type { DeviceToolsHandle } from '../hooks'
import { fileName, formatBytes, percent } from '../format'

interface Props {
  handle: DeviceToolsHandle
  appsOpen: boolean
  onToggleApps: () => void
  /** A file is being dragged over the card. */
  dragging: boolean
  /** Keyboard and mouse mode, for USB devices only (null hides the button). */
  otg: { disabledReason: string | null; start: () => void } | null
}

/** Screenshot, send files, apps: the things to do with a ready device besides mirroring it. */
export function DeviceTools({
  handle,
  appsOpen,
  onToggleApps,
  dragging,
  otg
}: Props): React.JSX.Element {
  const { screenshot, transfer, progress } = handle

  return (
    <div className="device-tools">
      <div className="tool-buttons">
        <button
          type="button"
          onClick={() => void handle.takeScreenshot()}
          disabled={handle.screenshotBusy}
          title="Saves a PNG and copies it to the clipboard"
        >
          {handle.screenshotBusy ? 'Taking…' : 'Screenshot'}
        </button>
        <button
          type="button"
          onClick={() => void handle.choose()}
          disabled={handle.sending}
          title="Installs APKs; other files go to the Download folder. You can also drop files on this card."
        >
          {handle.sending ? 'Sending…' : 'Send files…'}
        </button>
        <button type="button" onClick={onToggleApps} aria-expanded={appsOpen}>
          Apps
        </button>
        {otg && (
          <button
            type="button"
            onClick={otg.start}
            disabled={otg.disabledReason !== null}
            title={
              otg.disabledReason ??
              'Use this computer’s keyboard and mouse on the phone, with no screen shown. Needs the USB cable.'
            }
          >
            Keyboard &amp; mouse only
          </button>
        )}
      </div>

      {dragging && (
        <p className="drop-hint" role="status">
          Drop to install APKs and copy other files to the Download folder.
        </p>
      )}

      {handle.sending && progress && (
        <div className="progress-line" role="status">
          <span>
            {progress.name} · {percent(progress.sent, progress.total)}%
            {progress.total > 0 && ` of ${formatBytes(progress.total)}`}
          </span>
          <progress max={100} value={percent(progress.sent, progress.total)} />
        </div>
      )}

      {screenshot &&
        (screenshot.ok ? (
          <p className="ok-text" role="status">
            Saved {fileName(screenshot.path)}
            {screenshot.copied
              ? ' and copied to the clipboard.'
              : '. Copying to the clipboard failed.'}{' '}
            <button
              type="button"
              className="link"
              onClick={() => void window.api.showCapture(screenshot.path)}
            >
              Show in folder
            </button>
          </p>
        ) : (
          <p className="error" role="alert">
            {screenshot.error}
          </p>
        ))}

      {transfer &&
        (transfer.ok ? (
          <ul className="transfer-results" aria-label="Sent files">
            {transfer.outcomes.map((outcome, index) => (
              <li key={`${outcome.name}-${index}`} className={outcome.ok ? 'ok-text' : 'error'}>
                <strong>{outcome.name}</strong>
                {' · '}
                {outcome.kind === 'install' ? 'Install' : 'Copy'}
                {': '}
                {outcome.message}
              </li>
            ))}
            <li>
              <button type="button" className="link" onClick={handle.dismissTransfer}>
                Dismiss
              </button>
            </li>
          </ul>
        ) : (
          <p className="error" role="alert">
            {transfer.error}
          </p>
        ))}
    </div>
  )
}

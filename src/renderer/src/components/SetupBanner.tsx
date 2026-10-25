import type { ToolsState } from '../../../shared/models'
import { downloadFraction, downloadText } from '../labels'

export function SetupBanner({ tools }: { tools: ToolsState }): React.JSX.Element | null {
  const { status, download } = tools
  const busy = ['checking', 'downloading', 'verifying', 'extracting'].includes(download.phase)
  const fraction = downloadFraction(download)

  if (status.scrcpy && download.phase !== 'error') return null

  return (
    <section className="banner" aria-live="polite">
      <div className="banner-text">
        <strong>{status.scrcpy ? 'Download failed' : 'scrcpy is not installed'}</strong>
        <p className="muted">
          {status.adb
            ? 'adb was found, so devices are listed, but mirroring needs scrcpy itself.'
            : 'The app needs scrcpy (which includes adb) to list and mirror devices.'}{' '}
          It will be downloaded from the official GitHub release, checked against its published
          SHA-256, and stored in your user folder.
        </p>
        {busy && (
          <>
            <progress value={fraction ?? undefined} max={1} aria-label="Download progress" />
            <p className="muted">{downloadText(download)}</p>
          </>
        )}
        {download.phase === 'error' && <p className="error">{downloadText(download)}</p>}
      </div>
      <div className="banner-actions">
        {busy ? (
          <button type="button" onClick={() => void window.api.cancelDownload()}>
            Cancel
          </button>
        ) : (
          <>
            <button
              type="button"
              className="primary"
              onClick={() => void window.api.downloadScrcpy()}
            >
              {download.phase === 'error' ? 'Try again' : 'Download scrcpy'}
            </button>
            <button type="button" onClick={() => void window.api.refreshTools()}>
              I installed it — check again
            </button>
          </>
        )}
      </div>
    </section>
  )
}

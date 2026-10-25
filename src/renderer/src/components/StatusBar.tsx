import type { DevicesSnapshot, ToolsState } from '../../../shared/models'

export function StatusBar({
  tools,
  snapshot
}: {
  tools: ToolsState
  snapshot: DevicesSnapshot | null
}): React.JSX.Element {
  const { scrcpy, adb } = tools.status
  const adbState =
    snapshot?.adb === 'connected'
      ? 'adb connected'
      : snapshot?.adb === 'unavailable'
        ? 'adb unreachable'
        : 'adb starting'
  return (
    <footer className="statusbar muted">
      <span title={scrcpy?.path}>
        {scrcpy
          ? `scrcpy ${scrcpy.version ?? '?'} (${scrcpy.source === 'path' ? 'from PATH' : 'downloaded'})`
          : 'scrcpy missing'}
      </span>
      <span title={adb?.path}>{adb ? `adb ${adb.version ?? '?'}` : 'adb missing'}</span>
      <span>{adbState}</span>
    </footer>
  )
}

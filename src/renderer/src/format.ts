/** Small helpers for showing files and sizes. */

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes / 1024
  let unit = 0
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024
    unit++
  }
  return `${value >= 100 || Number.isInteger(value) ? Math.round(value) : value.toFixed(1)} ${units[unit]}`
}

/** The last part of a Windows or POSIX path. */
export function fileName(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.length > 0 ? parts[parts.length - 1] : path
}

/** Percentage done, 0 to 100. A zero-length file counts as done. */
export function percent(sent: number, total: number): number {
  if (total <= 0) return 100
  return Math.max(0, Math.min(100, Math.round((sent / total) * 100)))
}

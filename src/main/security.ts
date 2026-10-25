/**
 * Decides whether an IPC message or navigation comes from our own renderer.
 * `devUrl` is the electron-vite dev server origin, only set in development.
 */
export function isTrustedUrl(url: string | undefined, devUrl?: string): boolean {
  if (!url) return false
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol === 'file:') return true
  if (devUrl) {
    try {
      return parsed.origin === new URL(devUrl).origin
    } catch {
      return false
    }
  }
  return false
}

/** Only plain https links may be handed to the OS browser. */
export function isSafeExternalUrl(url: string): boolean {
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

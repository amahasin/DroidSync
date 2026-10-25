/** Parsers for the text that adb, pm and scrcpy print. Pure, so they are tested with samples. */
import type { AppEntry, CameraEntry, DisplayEntry } from '../../shared/models'

const PACKAGE = /[A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+/
export const PACKAGE_NAME = new RegExp(`^${PACKAGE.source}$`)

/** What Android prints when an install fails, in words a person can act on. */
const INSTALL_FAILURES: Record<string, string> = {
  INSTALL_FAILED_ALREADY_EXISTS: 'This app is already installed.',
  INSTALL_FAILED_VERSION_DOWNGRADE:
    'The device has a newer version of this app. Uninstall it first to go back.',
  INSTALL_FAILED_UPDATE_INCOMPATIBLE:
    'The installed copy was signed differently. Uninstall it first, then install again.',
  INSTALL_FAILED_INSUFFICIENT_STORAGE: 'The device does not have enough free storage.',
  INSTALL_FAILED_OLDER_SDK: 'This app needs a newer version of Android than the device has.',
  INSTALL_FAILED_NEWER_SDK: 'This app is too old for the device’s Android version.',
  INSTALL_FAILED_NO_MATCHING_ABIS: 'This app does not support the device’s processor.',
  INSTALL_FAILED_INVALID_APK: 'The file is not a valid APK.',
  INSTALL_PARSE_FAILED_NO_CERTIFICATES: 'The APK is not signed.',
  INSTALL_PARSE_FAILED_NOT_APK: 'The file is not a valid APK.',
  INSTALL_FAILED_TEST_ONLY: 'This is a test build that cannot be installed this way.',
  INSTALL_FAILED_USER_RESTRICTED:
    'The device blocked the install. Some phones need “Install via USB” turned on in Developer options.',
  INSTALL_FAILED_ABORTED: 'The install was cancelled on the device.',
  INSTALL_FAILED_VERIFICATION_FAILURE: 'The device refused the app (verification failed).'
}

export interface InstallOutcome {
  ok: boolean
  message: string
}

/** Reads the output of `pm install`: "Success" or "Failure [CODE: details]". */
export function parseInstallOutput(output: string): InstallOutcome {
  const text = output.trim()
  if (/^Success\b/m.test(text)) return { ok: true, message: 'Installed.' }

  const failure = /Failure\s*\[([A-Z0-9_]+)(?::\s*([^\]]*))?\]/.exec(text)
  if (failure) {
    const [, code, detail] = failure
    const known = INSTALL_FAILURES[code]
    if (known) return { ok: false, message: known }
    return {
      ok: false,
      message: `The device refused the install (${code}${detail ? `: ${detail}` : ''}).`
    }
  }
  if (/Failed to parse APK/i.test(text)) {
    return { ok: false, message: 'The file is not a valid APK.' }
  }
  // Take the first line that names the error: a stack trace puts the useful part at the top.
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  const reason = lines.find((line) => /^(error|failure)\b/i.test(line)) ?? lines[0]
  const cleaned = (reason ?? '')
    .replace(/^(error|failure)\s*:?\s*/i, '')
    .replace(/:?\s*\/data\/local\/tmp\/\S+/g, '')
    .replace(/[:.\s]+$/, '')
    .slice(0, 200)
  return { ok: false, message: cleaned ? `Install failed: ${cleaned}` : 'Install failed.' }
}

/**
 * Reads `scrcpy --list-apps`. Each app is a line like ` - Calculator     com.example.calc`,
 * where `*` marks apps that shipped with the device and `-` ones the person installed.
 */
export function parseListApps(output: string): AppEntry[] {
  const apps: AppEntry[] = []
  const seen = new Set<string>()
  const line = new RegExp(`^\\s*([*-])\\s+(.*\\S)\\s+(${PACKAGE.source})\\s*$`)
  for (const raw of output.split(/\r?\n/)) {
    const match = line.exec(raw)
    if (!match) continue
    const [, mark, label, packageName] = match
    if (seen.has(packageName)) continue
    seen.add(packageName)
    apps.push({ packageName, label: label.trim(), system: mark === '*' })
  }
  return apps
}

/** Packages that have a launcher entry, from `cmd package query-activities --brief`. */
export function parseLauncherPackages(output: string): string[] {
  const found = new Set<string>()
  const line = new RegExp(`^\\s+(${PACKAGE.source})/`)
  for (const raw of output.split(/\r?\n/)) {
    const match = line.exec(raw)
    if (match) found.add(match[1])
  }
  return [...found]
}

/** Package names from `pm list packages` (lines like `package:com.example.app`). */
export function parsePackageList(output: string): string[] {
  const names: string[] = []
  for (const raw of output.split(/\r?\n/)) {
    const match = /^package:(\S+)\s*$/.exec(raw.trim())
    if (match && PACKAGE_NAME.test(match[1])) names.push(match[1])
  }
  return names
}

/** Lines such as `    --display-id=0    (1920x1080)` from `scrcpy --list-displays`. */
export function parseDisplays(output: string): DisplayEntry[] {
  const displays: DisplayEntry[] = []
  for (const raw of output.split(/\r?\n/)) {
    const match = /--display-id=(\d+)\s*(?:\((.*)\))?/.exec(raw)
    if (!match) continue
    displays.push({ id: Number(match[1]), size: /\d+x\d+/.exec(match[2] ?? '')?.[0] ?? null })
  }
  return displays
}

/**
 * Lines such as `    --camera-id=0    (back, 4000x3000, fps=[15, 30])` from `scrcpy --list-cameras`.
 * With `--list-camera-sizes`, indented `- WxH` lines under a camera are its supported sizes.
 */
export function parseCameras(output: string): CameraEntry[] {
  const cameras: CameraEntry[] = []
  let current: CameraEntry | null = null
  let collectingSizes = false
  for (const raw of output.split(/\r?\n/)) {
    const camera = /--camera-id=(\S+)\s*(?:\((.*)\))?/.exec(raw)
    if (camera) {
      const detail = camera[2] ?? ''
      current = {
        id: camera[1],
        facing: /\b(front|back|external)\b/.exec(detail)?.[1] ?? null,
        size: /\d+x\d+/.exec(detail)?.[0] ?? null,
        fps: /fps=\[([^\]]*)\]/.exec(detail)?.[1].trim() || null,
        sizes: []
      }
      cameras.push(current)
      collectingSizes = true
      continue
    }
    if (!current) continue
    // High-speed sizes are listed after a heading; they cannot be used for ordinary capture.
    if (/high\s*speed/i.test(raw)) collectingSizes = false
    const size = /^\s*-\s*(\d+x\d+)\b/.exec(raw)
    if (size && collectingSizes && !current.sizes.includes(size[1])) current.sizes.push(size[1])
  }
  return cameras
}

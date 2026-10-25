/** Turns scrcpy's console output into a message a person can act on. */

interface Rule {
  test: RegExp
  message: (match: RegExpExecArray) => string
}

// First match wins, so the most specific rules come first.
const RULES: Rule[] = [
  {
    test: /unauthorized|device is not authorized|authorizing/i,
    message: () =>
      'The phone has not authorized this computer. Unlock it and accept the USB debugging prompt.'
  },
  {
    test: /no devices\/emulators found|could not find any adb device|device '[^']*' not found|device not found/i,
    message: () => 'The device was not found. Check that it is still connected and shown as Ready.'
  },
  {
    test: /device offline|\boffline\b/i,
    message: () => 'The device is offline. Unplug and replug the cable, then try again.'
  },
  {
    test: /server connection failed|could not connect to the server|connection refused/i,
    message: () =>
      'scrcpy could not reach its server on the device. Unplug and replug the device, or restart adb, then try again.'
  },
  {
    test: /could not open video stream|demuxer error|mediacodec|encoder|configure.*failed/i,
    message: () =>
      'The device’s video encoder failed. Try a lower max size or bit rate, or choose another codec.'
  },
  {
    test: /unrecognized option|unknown option|invalid (?:value|option)|usage:/i,
    message: () => 'scrcpy rejected one of the options. See the log for details.'
  },
  {
    test: /adb server version|adb server .*doesn't match/i,
    message: () => 'adb versions do not match. Restart adb and try again.'
  },
  {
    test: /could not (?:find|execute|start).*adb|adb.*not found/i,
    message: () => 'scrcpy could not run adb.'
  }
]

const ERROR_LINE = /^(?:\[server\] )?ERROR:\s*(.+)$/

/**
 * @param lines  recent output lines, oldest first
 * @param exitCode  process exit code, or null when it was killed
 * @returns null when there is nothing to report (clean exit)
 */
export function classifyExit(lines: string[], exitCode: number | null): string | null {
  if (exitCode === 0) return null

  const recent = lines.slice(-80)
  const errorLines = recent.filter((line) => ERROR_LINE.test(line))
  const haystack = (errorLines.length ? errorLines : recent).join('\n')

  for (const rule of RULES) {
    const match = rule.test.exec(haystack)
    if (match) return rule.message(match)
  }

  const last = errorLines[errorLines.length - 1]?.match(ERROR_LINE)?.[1]
  if (last) return last
  return exitCode === null ? 'scrcpy was stopped.' : `scrcpy exited with code ${exitCode}.`
}

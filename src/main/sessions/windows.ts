import { execFile, spawn } from 'child_process'
import { join } from 'path'
import type { SessionDeps } from './manager'

const systemRoot = (): string => process.env['SystemRoot'] ?? 'C:\\Windows'
// Absolute paths, so an entry on PATH cannot stand in for the real tools.
const system32 = (...parts: string[]): string => join(systemRoot(), 'System32', ...parts)

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    execFile(file, args, { windowsHide: true, timeout: 10000 }, (_error, stdout) =>
      resolve(stdout ?? '')
    )
  })
}

/**
 * Quotes one argument for a `cmd.exe /c` line that scrcpy.exe then parses normally.
 * Inside double quotes cmd treats & | < > ^ ( ) literally, so what remains dangerous is the
 * quote itself and %VAR% expansion; both are neutralised rather than escaped. Trailing
 * backslashes are doubled so they cannot swallow the closing quote.
 */
export function quoteForCmd(argument: string): string {
  const safe = argument
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f]/g, ' ')
    .replace(/"/g, "'")
    .replace(/%/g, '\uFF05')
    .replace(/(\\+)$/, '$1$1')
  return `"${safe}"`
}

export function buildCmdLine(file: string, args: string[]): string {
  return [file, ...args].map(quoteForCmd).join(' ')
}

// scrcpy.exe pid behind each cmd.exe wrapper we started.
const scrcpyPids = new Map<number, number>()

/** The scrcpy.exe that a wrapper cmd.exe started, or null if it has not started yet. */
async function findScrcpyPid(wrapperPid: number): Promise<number | null> {
  const cached = scrcpyPids.get(wrapperPid)
  if (cached) return cached
  const script =
    `(Get-CimInstance Win32_Process -Filter 'ParentProcessId=${Math.trunc(wrapperPid)}' | ` +
    `Where-Object { $_.Name -eq 'scrcpy.exe' } | Select-Object -First 1).ProcessId`
  const output = await run(system32('WindowsPowerShell', 'v1.0', 'powershell.exe'), [
    '-NoProfile',
    '-NonInteractive',
    '-Command',
    script
  ])
  const pid = Number.parseInt(output.trim(), 10)
  if (!Number.isInteger(pid) || pid <= 0) return null
  scrcpyPids.set(wrapperPid, pid)
  return pid
}

/**
 * Real process control for Windows.
 *
 * scrcpy.exe is a console program, so how it is started matters:
 * - Plain spawn from a GUI app pops up a console window.
 * - `windowsHide` hides that console, but also starts the process with SW_HIDE, and scrcpy's
 *   mirror window then never shows.
 * - `detached` leaves scrcpy without a console, so each adb.exe it runs opens a visible one.
 * So scrcpy is run by a hidden cmd.exe: the hidden console is shared with adb and scrcpy's own
 * window shows normally. Arguments are quoted by `quoteForCmd`.
 *
 * Stopping: `taskkill /PID` without /F posts WM_CLOSE to the process's windows, which scrcpy
 * treats like the person closing the window: it quits cleanly and removes its tunnel from the
 * device. It has to target scrcpy.exe itself, not the wrapper, because only scrcpy has a window.
 */
export function createWindowsDeps(): SessionDeps {
  return {
    spawn: (file, args, env) =>
      spawn(system32('cmd.exe'), ['/d', '/v:off', '/s', '/c', `"${buildCmdLine(file, args)}"`], {
        env,
        windowsHide: true,
        windowsVerbatimArguments: true,
        stdio: ['ignore', 'pipe', 'pipe']
      }),
    closeGracefully: async (pid) => {
      const target = await findScrcpyPid(pid)
      if (target) await run(system32('taskkill.exe'), ['/PID', String(target)])
    },
    forceKill: async (pid) => {
      scrcpyPids.delete(pid)
      await run(system32('taskkill.exe'), ['/PID', String(pid), '/T', '/F'])
    }
  }
}

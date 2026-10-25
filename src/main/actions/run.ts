import { execFile } from 'child_process'
import type { ScrcpyRun } from './service'

const LIMIT_MS = 30000

/**
 * Runs a scrcpy command that only prints something (--list-apps and friends), and returns what it
 * printed. The arguments go straight to the program, never through a shell. It never opens a window,
 * so it can run hidden.
 */
export function runScrcpy(
  scrcpyPath: string,
  args: string[],
  adbPath: string | null
): Promise<ScrcpyRun> {
  return new Promise((resolve, reject) => {
    execFile(
      scrcpyPath,
      args,
      {
        windowsHide: true,
        timeout: LIMIT_MS,
        maxBuffer: 4 * 1024 * 1024,
        // Use the same adb the app tracks devices with, so a second adb server is not started.
        env: adbPath ? { ...process.env, ADB: adbPath } : process.env
      },
      (error, stdout, stderr) => {
        const output = `${stdout}\n${stderr}`
        if (error && (error as NodeJS.ErrnoException).code === 'ENOENT') {
          reject(new Error('scrcpy could not be started.'))
          return
        }
        if (error && 'killed' in error && error.killed) {
          reject(new Error('scrcpy took too long to answer.'))
          return
        }
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0
        resolve({ code, output })
      }
    )
  })
}

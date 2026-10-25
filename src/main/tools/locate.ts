import { execFile } from 'child_process'
import { existsSync, readdirSync } from 'fs'
import { delimiter, dirname, join } from 'path'
import type { AdbTool, ScrcpyTool, ToolStatus } from '../../shared/models'

export function parseScrcpyVersion(output: string): string | null {
  return /^scrcpy\s+(\d+(?:\.\d+)*)/m.exec(output)?.[1] ?? null
}

export function parseAdbVersion(output: string): string | null {
  return /^Version\s+(\S+)/m.exec(output)?.[1] ?? null
}

/** Every long flag mentioned in `scrcpy --help`, which is how we know what this build supports. */
export function parseHelpFlags(output: string): string[] | null {
  const flags = new Set(output.match(/--[a-z0-9]+(?:-[a-z0-9]+)*/g) ?? [])
  // A real help page lists dozens of flags; fewer means we did not get one.
  return flags.size >= 10 ? [...flags].sort() : null
}

/** Compares dotted numeric versions: negative if a < b. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const diff = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

/** First `exe` found on PATH, the way the shell would resolve it. */
export function findOnPath(
  exe: string,
  pathEnv: string | undefined = process.env['PATH'],
  exists: (path: string) => boolean = existsSync
): string | null {
  for (const entry of (pathEnv ?? '').split(delimiter)) {
    const dir = entry.trim().replace(/^"|"$/g, '')
    if (!dir) continue
    const candidate = join(dir, exe)
    if (exists(candidate)) return candidate
  }
  return null
}

/** Newest managed build that contains both scrcpy.exe and adb.exe. */
export function findManaged(root: string): { dir: string; version: string } | null {
  let names: string[]
  try {
    names = readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && /^\d+(\.\d+)*$/.test(entry.name))
      .map((entry) => entry.name)
  } catch {
    return null
  }
  const usable = names
    .filter(
      (name) =>
        existsSync(join(root, name, 'scrcpy.exe')) && existsSync(join(root, name, 'adb.exe'))
    )
    .sort(compareVersions)
  const newest = usable[usable.length - 1]
  return newest ? { dir: join(root, newest), version: newest } : null
}

function run(file: string, args: string[]): Promise<string> {
  return new Promise((resolve) => {
    try {
      execFile(file, args, { windowsHide: true, timeout: 5000 }, (error, stdout) =>
        resolve(error ? '' : stdout)
      )
    } catch {
      // A file that cannot be started at all (damaged, not a program) throws instead of calling back.
      resolve('')
    }
  })
}

export interface ResolveOptions {
  managedRoot: string
  pathEnv?: string
  /** Use the downloaded build even when scrcpy is on PATH. */
  preferManaged?: boolean
}

/**
 * scrcpy: PATH first (unless the downloaded build is preferred), then the newest managed download.
 * adb: the one next to scrcpy (it is what scrcpy itself will use), else PATH, else managed.
 */
export async function resolveTools(options: ResolveOptions): Promise<ToolStatus> {
  const { managedRoot, pathEnv } = options
  const managed = findManaged(managedRoot)

  const found = findOnPath('scrcpy.exe', pathEnv)
  const onPath = options.preferManaged && managed ? null : found
  const source: ScrcpyTool['source'] = onPath ? 'path' : 'managed'
  const scrcpyPath = onPath ?? (managed ? join(managed.dir, 'scrcpy.exe') : null)

  const sibling = scrcpyPath ? join(dirname(scrcpyPath), 'adb.exe') : null
  const adbPath =
    sibling && existsSync(sibling)
      ? sibling
      : ((options.preferManaged && managed ? null : findOnPath('adb.exe', pathEnv)) ??
        (managed ? join(managed.dir, 'adb.exe') : null))

  const [scrcpyOut, helpOut, adbOut] = await Promise.all([
    scrcpyPath ? run(scrcpyPath, ['--version']) : Promise.resolve(''),
    scrcpyPath ? run(scrcpyPath, ['--help']) : Promise.resolve(''),
    adbPath ? run(adbPath, ['version']) : Promise.resolve('')
  ])

  const scrcpy: ScrcpyTool | null = scrcpyPath
    ? {
        path: scrcpyPath,
        version: parseScrcpyVersion(scrcpyOut),
        source,
        flags: parseHelpFlags(helpOut)
      }
    : null
  const adb: AdbTool | null = adbPath ? { path: adbPath, version: parseAdbVersion(adbOut) } : null
  return { scrcpy, adb, managedRoot }
}

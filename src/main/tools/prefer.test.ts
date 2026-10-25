import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveTools } from './locate'

describe('resolveTools with a downloaded build preferred', () => {
  let root: string
  let pathDir: string
  let managedRoot: string
  const touch = (...parts: string[]): string => {
    const path = join(...parts)
    mkdirSync(join(path, '..'), { recursive: true })
    // Not a real program: running it fails, so no version is read. Only the choice of path matters.
    writeFileSync(path, '')
    return path
  }

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'prefer-test-'))
    pathDir = join(root, 'onpath')
    managedRoot = join(root, 'managed')
    touch(pathDir, 'scrcpy.exe')
    touch(pathDir, 'adb.exe')
    touch(managedRoot, '3.1', 'scrcpy.exe')
    touch(managedRoot, '3.1', 'adb.exe')
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  it('uses the one on PATH by default', async () => {
    const status = await resolveTools({ managedRoot, pathEnv: pathDir })
    expect(status.scrcpy).toMatchObject({ path: join(pathDir, 'scrcpy.exe'), source: 'path' })
    expect(status.adb?.path).toBe(join(pathDir, 'adb.exe'))
  })

  it('uses the downloaded build, with its own adb, when preferred', async () => {
    const status = await resolveTools({ managedRoot, pathEnv: pathDir, preferManaged: true })
    expect(status.scrcpy).toMatchObject({
      path: join(managedRoot, '3.1', 'scrcpy.exe'),
      source: 'managed'
    })
    expect(status.adb?.path).toBe(join(managedRoot, '3.1', 'adb.exe'))
  })

  it('falls back to PATH when preferred but nothing was downloaded', async () => {
    const status = await resolveTools({
      managedRoot: join(root, 'empty'),
      pathEnv: pathDir,
      preferManaged: true
    })
    expect(status.scrcpy).toMatchObject({ path: join(pathDir, 'scrcpy.exe'), source: 'path' })
  })
})

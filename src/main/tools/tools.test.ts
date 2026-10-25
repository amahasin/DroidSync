import { createHash } from 'crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { DownloadState } from '../../shared/models'
import { downloadRelease, findBuildDir } from './download'
import {
  compareVersions,
  findManaged,
  findOnPath,
  parseAdbVersion,
  parseHelpFlags,
  parseScrcpyVersion
} from './locate'
import { isAllowedDownloadUrl, parseRelease, windowsFlavour } from './release'

describe('version parsing', () => {
  it('reads the scrcpy version line', () => {
    expect(
      parseScrcpyVersion('scrcpy 2.6.1 <https://github.com/Genymobile/scrcpy>\n\nDependencies')
    ).toBe('2.6.1')
    expect(parseScrcpyVersion('nonsense')).toBeNull()
  })

  it('reads the adb tool version rather than the protocol version', () => {
    const out =
      'Android Debug Bridge version 1.0.41\nVersion 35.0.2-12147458\nInstalled as C:\\x\\adb.exe\n'
    expect(parseAdbVersion(out)).toBe('35.0.2-12147458')
  })

  it('collects long flags from the help page and ignores short ones', () => {
    const help = [
      'Usage: scrcpy [options]',
      ...Array.from({ length: 12 }, (_, i) => `    --flag-${i}  does a thing, like -m`),
      '    --video-bit-rate=value',
      'See also --video-bit-rate'
    ].join('\n')
    const flags = parseHelpFlags(help)
    expect(flags).toContain('--video-bit-rate')
    expect(flags?.filter((f) => f === '--video-bit-rate')).toHaveLength(1)
    expect(flags).not.toContain('-m')
  })

  it('returns null when the output is not a help page', () => {
    expect(parseHelpFlags('')).toBeNull()
    expect(parseHelpFlags('ERROR: could not run --help')).toBeNull()
  })

  it('compares dotted versions numerically', () => {
    expect(compareVersions('2.10', '2.9')).toBeGreaterThan(0)
    expect(compareVersions('5.0', '5.0.0')).toBe(0)
    expect(compareVersions('2.6.1', '5.0.1')).toBeLessThan(0)
  })
})

describe('findOnPath', () => {
  it('returns the first match in PATH order and ignores blanks and quotes', () => {
    const present = new Set([join('C:\\b', 'scrcpy.exe'), join('C:\\c', 'scrcpy.exe')])
    const pathEnv = ['', 'C:\\a', '"C:\\b"', 'C:\\c'].join(delimiter)
    expect(findOnPath('scrcpy.exe', pathEnv, (p) => present.has(p))).toBe(
      join('C:\\b', 'scrcpy.exe')
    )
  })

  it('returns null when nothing matches', () => {
    expect(findOnPath('scrcpy.exe', 'C:\\a', () => false)).toBeNull()
    expect(findOnPath('scrcpy.exe', undefined, () => false)).toBeNull()
  })
})

describe('filesystem helpers', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'droidsync-test-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const makeBuild = (dir: string): void => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scrcpy.exe'), '')
    writeFileSync(join(dir, 'adb.exe'), '')
  }

  it('findManaged picks the newest complete build', () => {
    makeBuild(join(root, '2.6.1'))
    makeBuild(join(root, '5.0.1'))
    mkdirSync(join(root, '9.9.9')) // incomplete: ignored
    mkdirSync(join(root, '.tmp'))
    expect(findManaged(root)).toEqual({ dir: join(root, '5.0.1'), version: '5.0.1' })
  })

  it('findManaged returns null for a missing root', () => {
    expect(findManaged(join(root, 'missing'))).toBeNull()
  })

  it('findBuildDir handles a top-level folder inside the archive', () => {
    makeBuild(join(root, 'scrcpy-win64-v5.0.1'))
    expect(findBuildDir(root)).toBe(join(root, 'scrcpy-win64-v5.0.1'))
    expect(findBuildDir(join(root, 'scrcpy-win64-v5.0.1'))).toBe(join(root, 'scrcpy-win64-v5.0.1'))
  })

  it('findBuildDir returns null when the files are missing', () => {
    mkdirSync(join(root, 'empty'))
    expect(findBuildDir(root)).toBeNull()
  })
})

describe('release parsing', () => {
  const sha = 'b'.repeat(64)
  const api = (overrides: Record<string, unknown> = {}): unknown => ({
    tag_name: 'v5.0.1',
    assets: [
      {
        name: 'scrcpy-win64-v5.0.1.zip',
        size: 123,
        browser_download_url:
          'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip',
        digest: `sha256:${sha.toUpperCase()}`,
        ...overrides
      },
      {
        name: 'scrcpy-winarm64-v5.0.1.zip',
        size: 99,
        browser_download_url:
          'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-winarm64-v5.0.1.zip',
        digest: `sha256:${'c'.repeat(64)}`
      }
    ]
  })

  it('picks the asset for the CPU and normalises the digest', () => {
    const release = parseRelease(api(), 'x64')
    expect(release.version).toBe('5.0.1')
    expect(release.asset).toMatchObject({ name: 'scrcpy-win64-v5.0.1.zip', size: 123, sha256: sha })
    expect(parseRelease(api(), 'arm64').asset.name).toBe('scrcpy-winarm64-v5.0.1.zip')
  })

  it('maps process.arch to the Windows flavour', () => {
    expect(windowsFlavour('x64')).toBe('win64')
    expect(windowsFlavour('arm64')).toBe('winarm64')
    expect(windowsFlavour('ia32')).toBe('win32')
  })

  it('refuses an asset without a digest', () => {
    expect(() => parseRelease(api({ digest: null }), 'x64')).toThrow('SHA-256')
  })

  it('refuses a download URL outside GitHub', () => {
    expect(() =>
      parseRelease(
        api({ browser_download_url: 'https://evil.example/scrcpy-win64-v5.0.1.zip' }),
        'x64'
      )
    ).toThrow('not on GitHub')
  })

  it('refuses tags that are not plain versions', () => {
    expect(() => parseRelease({ tag_name: 'v1/../../x', assets: [] }, 'x64')).toThrow('tag')
  })

  it('refuses a release without the expected asset', () => {
    expect(() => parseRelease({ tag_name: 'v5.0.1', assets: [] }, 'x64')).toThrow('no scrcpy-win64')
  })

  it('allows only https GitHub hosts', () => {
    expect(isAllowedDownloadUrl('https://github.com/a/b')).toBe(true)
    expect(isAllowedDownloadUrl('https://release-assets.githubusercontent.com/x')).toBe(true)
    expect(isAllowedDownloadUrl('http://github.com/a')).toBe(false)
    expect(isAllowedDownloadUrl('https://github.com.evil.example/a')).toBe(false)
    expect(isAllowedDownloadUrl('https://notgithub.com/a')).toBe(false)
  })
})

describe('downloadRelease', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'droidsync-dl-'))
  })
  afterEach(() => rmSync(root, { recursive: true, force: true }))

  const payload = Buffer.from('pretend this is a zip file '.repeat(1000))
  const release = (sha256: string): Parameters<typeof downloadRelease>[0]['release'] => ({
    tag: 'v5.0.1',
    version: '5.0.1',
    asset: {
      name: 'scrcpy-win64-v5.0.1.zip',
      size: payload.length,
      url: 'https://github.com/Genymobile/scrcpy/releases/download/v5.0.1/scrcpy-win64-v5.0.1.zip',
      sha256
    }
  })
  const okFetch = (async () => {
    const response = new Response(payload, {
      headers: { 'content-length': String(payload.length) }
    })
    Object.defineProperty(response, 'url', { value: release('').asset.url })
    return response
  }) as unknown as typeof fetch
  const fakeExtract = async (_zip: string, dest: string): Promise<void> => {
    const dir = join(dest, 'scrcpy-win64-v5.0.1')
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'scrcpy.exe'), 'S')
    writeFileSync(join(dir, 'adb.exe'), 'A')
  }

  it('verifies, extracts and installs into <root>/<version>', async () => {
    const sha = createHash('sha256').update(payload).digest('hex')
    const phases: string[] = []
    const dir = await downloadRelease({
      release: release(sha),
      managedRoot: root,
      fetchFn: okFetch,
      extract: fakeExtract,
      onProgress: (p: Partial<DownloadState>) => p.phase && phases.push(p.phase)
    })
    expect(dir).toBe(join(root, '5.0.1'))
    expect(readFileSync(join(dir, 'scrcpy.exe'), 'utf8')).toBe('S')
    expect(phases).toEqual(['downloading', 'verifying', 'extracting'])
    expect(existsSync(join(root, '.tmp'))).toBe(false)
  })

  it('rejects a checksum mismatch and installs nothing', async () => {
    await expect(
      downloadRelease({
        release: release('0'.repeat(64)),
        managedRoot: root,
        fetchFn: okFetch,
        extract: fakeExtract,
        onProgress: () => {}
      })
    ).rejects.toThrow('Checksum mismatch')
    expect(existsSync(join(root, '5.0.1'))).toBe(false)
    expect(existsSync(join(root, '.tmp'))).toBe(false)
  })

  it('rejects a redirect away from GitHub', async () => {
    const sha = createHash('sha256').update(payload).digest('hex')
    const redirected = (async () => {
      const response = new Response(payload)
      Object.defineProperty(response, 'url', { value: 'https://evil.example/file.zip' })
      return response
    }) as unknown as typeof fetch
    await expect(
      downloadRelease({
        release: release(sha),
        managedRoot: root,
        fetchFn: redirected,
        extract: fakeExtract,
        onProgress: () => {}
      })
    ).rejects.toThrow('redirected')
  })

  it('rejects an archive without scrcpy.exe and adb.exe', async () => {
    const sha = createHash('sha256').update(payload).digest('hex')
    await expect(
      downloadRelease({
        release: release(sha),
        managedRoot: root,
        fetchFn: okFetch,
        extract: async () => {},
        onProgress: () => {}
      })
    ).rejects.toThrow('does not contain')
  })

  it('replaces an existing install of the same version', async () => {
    const sha = createHash('sha256').update(payload).digest('hex')
    mkdirSync(join(root, '5.0.1'), { recursive: true })
    writeFileSync(join(root, '5.0.1', 'stale.txt'), 'old')
    await downloadRelease({
      release: release(sha),
      managedRoot: root,
      fetchFn: okFetch,
      extract: fakeExtract,
      onProgress: () => {}
    })
    expect(existsSync(join(root, '5.0.1', 'stale.txt'))).toBe(false)
  })
})

import { execFile } from 'child_process'
import { createHash } from 'crypto'
import { createWriteStream, existsSync, readdirSync } from 'fs'
import { mkdir, rename, rm } from 'fs/promises'
import { join } from 'path'
import { Readable, Transform } from 'stream'
import { pipeline } from 'stream/promises'
import type { DownloadState } from '../../shared/models'
import { isAllowedDownloadUrl, type Release } from './release'

export type ProgressListener = (patch: Partial<DownloadState>) => void

export interface DownloadOptions {
  release: Release
  managedRoot: string
  onProgress: ProgressListener
  signal?: AbortSignal
  fetchFn?: typeof fetch
  /** Overridable for tests. */
  extract?: (zipPath: string, destDir: string) => Promise<void>
}

/** Windows ships bsdtar, which reads zip. Absolute path so a PATH entry cannot replace it. */
export function extractWithTar(zipPath: string, destDir: string): Promise<void> {
  const tar = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'tar.exe')
  return new Promise((resolve, reject) => {
    execFile(
      tar,
      ['-xf', zipPath, '-C', destDir],
      { windowsHide: true, timeout: 120000 },
      (error) =>
        error ? reject(new Error(`Extracting the archive failed: ${error.message}`)) : resolve()
    )
  })
}

/** The folder inside an extracted archive that holds scrcpy.exe and adb.exe. */
export function findBuildDir(extracted: string): string | null {
  const isBuild = (dir: string): boolean =>
    existsSync(join(dir, 'scrcpy.exe')) && existsSync(join(dir, 'adb.exe'))
  if (isBuild(extracted)) return extracted
  for (const entry of readdirSync(extracted, { withFileTypes: true })) {
    if (entry.isDirectory() && isBuild(join(extracted, entry.name))) {
      return join(extracted, entry.name)
    }
  }
  return null
}

/**
 * Downloads the release zip, verifies its SHA-256, extracts it and installs it to
 * `<managedRoot>/<version>`. Returns the install directory.
 */
export async function downloadRelease(options: DownloadOptions): Promise<string> {
  const { release, managedRoot, onProgress, signal } = options
  const fetchFn = options.fetchFn ?? fetch
  const extract = options.extract ?? extractWithTar
  const { asset, version } = release

  const workDir = join(managedRoot, '.tmp')
  const zipPath = join(workDir, `${asset.name}.part`)
  const extractDir = join(workDir, 'extracted')
  const installDir = join(managedRoot, version)

  await rm(workDir, { recursive: true, force: true })
  await mkdir(extractDir, { recursive: true })

  try {
    onProgress({ phase: 'downloading', received: 0, total: asset.size, version, error: null })
    const response = await fetchFn(asset.url, { signal, headers: { 'User-Agent': 'DroidSync' } })
    if (!response.ok || !response.body) throw new Error(`Download failed (HTTP ${response.status})`)
    if (!isAllowedDownloadUrl(response.url || asset.url)) {
      throw new Error('Download was redirected away from GitHub')
    }
    const total = Number(response.headers.get('content-length')) || asset.size

    const hash = createHash('sha256')
    let received = 0
    let lastReport = 0
    const meter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        hash.update(chunk)
        received += chunk.length
        const now = Date.now()
        if (now - lastReport > 100) {
          lastReport = now
          onProgress({ received, total })
        }
        callback(null, chunk)
      }
    })
    await pipeline(
      Readable.fromWeb(response.body as import('stream/web').ReadableStream),
      meter,
      createWriteStream(zipPath),
      { signal }
    )
    onProgress({ received, total, phase: 'verifying' })

    if (hash.digest('hex') !== asset.sha256) {
      throw new Error('Checksum mismatch: the downloaded file does not match the published SHA-256')
    }

    onProgress({ phase: 'extracting' })
    await extract(zipPath, extractDir)
    const buildDir = findBuildDir(extractDir)
    if (!buildDir) throw new Error('The archive does not contain scrcpy.exe and adb.exe')

    await rm(installDir, { recursive: true, force: true })
    await rename(buildDir, installDir)
    return installDir
  } finally {
    await rm(workDir, { recursive: true, force: true })
  }
}

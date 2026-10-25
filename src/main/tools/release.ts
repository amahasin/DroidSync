/** GitHub release lookup for scrcpy. Pure parts are kept separate from the network calls. */

export const RELEASES_API = 'https://api.github.com/repos/Genymobile/scrcpy/releases/latest'

export interface ReleaseAsset {
  name: string
  size: number
  url: string
  sha256: string
}

export interface Release {
  tag: string
  /** Tag without the leading "v", validated as dotted digits. */
  version: string
  asset: ReleaseAsset
}

interface ApiAsset {
  name?: unknown
  size?: unknown
  browser_download_url?: unknown
  digest?: unknown
}

export function windowsFlavour(arch: string): 'win64' | 'winarm64' | 'win32' {
  if (arch === 'arm64') return 'winarm64'
  if (arch === 'ia32') return 'win32'
  return 'win64'
}

/** Only https downloads from GitHub's own hosts are accepted. */
export function isAllowedDownloadUrl(url: string): boolean {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname
  return (
    host === 'github.com' || host.endsWith('.github.com') || host.endsWith('.githubusercontent.com')
  )
}

/** Picks the Windows zip for this CPU and requires a SHA-256 digest from the API. */
export function parseRelease(json: unknown, arch: string): Release {
  const data = json as { tag_name?: unknown; assets?: unknown }
  const tag = typeof data?.tag_name === 'string' ? data.tag_name : ''
  const version = tag.replace(/^v/, '')
  if (!/^\d+(\.\d+)*$/.test(version)) throw new Error(`Unexpected release tag "${tag}"`)
  if (!Array.isArray(data.assets)) throw new Error('Release has no assets')

  const wanted = `scrcpy-${windowsFlavour(arch)}-v${version}.zip`
  const asset = (data.assets as ApiAsset[]).find((a) => a.name === wanted)
  if (!asset) throw new Error(`Release ${tag} has no ${wanted}`)

  const url = String(asset.browser_download_url ?? '')
  if (!isAllowedDownloadUrl(url)) throw new Error('Release download URL is not on GitHub')

  const digest = /^sha256:([0-9a-f]{64})$/i.exec(String(asset.digest ?? ''))
  if (!digest) throw new Error(`Release asset ${wanted} has no SHA-256 digest to verify against`)

  const size = typeof asset.size === 'number' ? asset.size : 0
  return { tag, version, asset: { name: wanted, size, url, sha256: digest[1].toLowerCase() } }
}

export async function fetchLatestRelease(
  arch: string,
  signal?: AbortSignal,
  fetchFn: typeof fetch = fetch
): Promise<Release> {
  const response = await fetchFn(RELEASES_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'DroidSync' },
    signal
  })
  if (!response.ok) throw new Error(`GitHub API returned ${response.status}`)
  return parseRelease(await response.json(), arch)
}

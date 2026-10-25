import { describe, expect, it } from 'vitest'
import { friendlyError, UpdateService, type AppUpdater, type UpdateDeps } from './updates'

describe('friendlyError', () => {
  it('reduces a GitHub 404 with all its headers to one sentence', () => {
    const long = new Error(
      '404 \n"method: GET url: https://github.com/o/r/releases.atom"\nHeaders: {\n "set-cookie": ["_gh_sess=secret"]\n}'
    )
    expect(friendlyError(long)).toBe('No release was found on GitHub yet.')
  })

  it('explains network failures and refusals', () => {
    expect(friendlyError(new Error('getaddrinfo ENOTFOUND github.com'))).toMatch(/internet/)
    expect(friendlyError(new Error('net::ERR_INTERNET_DISCONNECTED'))).toMatch(/internet/)
    expect(friendlyError(new Error('HTTP 403 rate limit'))).toMatch(/refused/)
  })

  it('keeps just the first line of anything else, and never too much', () => {
    expect(friendlyError(new Error('\n\nChecksum mismatch\nsecond line'))).toBe('Checksum mismatch')
    expect(friendlyError(new Error('x'.repeat(500))).length).toBe(160)
    expect(friendlyError('plain')).toBe('plain')
  })
})

describe('UpdateService', () => {
  function setup(
    options: {
      current?: string | null
      latest?: string | Error
      managed?: string | null
      updater?: Partial<AppUpdater> | null
    } = {}
  ): { service: UpdateService; seen: string[]; installs: () => number } {
    let installed = 0
    const updater: AppUpdater | null =
      options.updater === null
        ? null
        : {
            check: async () => ({ version: '2.0.0' }),
            download: async (onProgress) => {
              onProgress(40.4)
              onProgress(100)
            },
            quitAndInstall: () => void installed++,
            ...options.updater
          }
    const deps: UpdateDeps = {
      currentScrcpy: () => (options.current === undefined ? '2.6.1' : options.current),
      managedScrcpy: () => options.managed ?? null,
      fetchLatest: async () => {
        if (options.latest instanceof Error) throw options.latest
        return { version: options.latest ?? '3.1' }
      },
      appUpdater: updater
    }
    const service = new UpdateService(deps)
    const seen: string[] = []
    service.onChange((s) => seen.push(`${s.scrcpy.phase}/${s.app.phase}`))
    return { service, seen, installs: () => installed }
  }

  describe('scrcpy', () => {
    it('says a newer release exists', async () => {
      const s = setup()
      const state = await s.service.checkScrcpy()
      expect(state.scrcpy).toMatchObject({
        phase: 'done',
        current: '2.6.1',
        latest: '3.1',
        newer: true
      })
      expect(s.seen).toEqual(['checking/idle', 'done/idle'])
    })

    it('compares numbers, not text, so 2.10 is newer than 2.9', async () => {
      const s = setup({ current: '2.9', latest: '2.10' })
      expect((await s.service.checkScrcpy()).scrcpy.newer).toBe(true)
    })

    it('says nothing is newer when up to date or ahead', async () => {
      expect(
        (await setup({ current: '3.1', latest: '3.1' }).service.checkScrcpy()).scrcpy.newer
      ).toBe(false)
      expect(
        (await setup({ current: '4.0', latest: '3.1' }).service.checkScrcpy()).scrcpy.newer
      ).toBe(false)
    })

    it('counts a missing scrcpy as out of date, and reports the downloaded build', async () => {
      const state = await setup({ current: null, managed: '3.0' }).service.checkScrcpy()
      expect(state.scrcpy).toMatchObject({ newer: true, managedVersion: '3.0' })
    })

    it('reports a failed check without losing what it knew', async () => {
      const state = await setup({
        latest: new Error('GitHub API returned 403')
      }).service.checkScrcpy()
      expect(state.scrcpy.phase).toBe('error')
      expect(state.scrcpy.error).toContain('GitHub refused the request')
      expect(state.scrcpy.current).toBe('2.6.1')
    })
  })

  describe('app', () => {
    it('is unconfigured when the build has no update feed', async () => {
      const s = setup({ updater: null })
      expect(s.service.state.app.phase).toBe('unconfigured')
      expect((await s.service.checkApp()).app.phase).toBe('unconfigured')
      expect(await s.service.downloadApp()).toMatchObject({ ok: false })
      expect(s.service.installApp()).toMatchObject({ ok: false })
    })

    it('goes from check to download to ready to install', async () => {
      const s = setup()
      expect((await s.service.checkApp()).app).toMatchObject({
        phase: 'available',
        version: '2.0.0'
      })
      expect(await s.service.downloadApp()).toEqual({ ok: true })
      expect(s.service.state.app).toMatchObject({ phase: 'ready', percent: 100 })
      expect(s.service.installApp()).toEqual({ ok: true })
      expect(s.installs()).toBe(1)
    })

    it('reports progress as whole percentages', async () => {
      const s = setup()
      const percents: number[] = []
      s.service.onChange((state) => percents.push(state.app.percent))
      await s.service.checkApp()
      await s.service.downloadApp()
      expect(percents).toContain(40)
    })

    it('says when the current version is the newest', async () => {
      const s = setup({ updater: { check: async () => null } })
      expect((await s.service.checkApp()).app.phase).toBe('current')
    })

    it('reports errors from the check and from the download', async () => {
      const failing = setup({
        updater: {
          check: async () => {
            throw new Error('offline')
          }
        }
      })
      expect((await failing.service.checkApp()).app).toMatchObject({ phase: 'error' })

      const download = setup({
        updater: {
          download: async () => {
            throw new Error('disk full')
          }
        }
      })
      await download.service.checkApp()
      expect(await download.service.downloadApp()).toMatchObject({ ok: false })
      expect(download.service.state.app.error).toContain('disk full')
    })

    it('only downloads or installs at the right time', async () => {
      const s = setup()
      expect(await s.service.downloadApp()).toMatchObject({ ok: false })
      expect(s.service.installApp()).toMatchObject({ ok: false })
      expect(s.installs()).toBe(0)
    })
  })
})

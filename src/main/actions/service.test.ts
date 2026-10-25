import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureEntry, Device, TransferProgress } from '../../shared/models'
import { DeviceActions, type ActionsDeps, type ScrcpyRun } from './service'

const SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
// A signature, some bytes, and an IEND chunk with its 4-byte checksum.
const PNG = Buffer.concat([
  SIGNATURE,
  Buffer.from('fake image data'),
  Buffer.from('IEND'),
  Buffer.from([0xae, 0x42, 0x60, 0x82])
])

const device = (serial: string, overrides: Partial<Device> = {}): Device => ({
  serial,
  state: 'device',
  rawState: 'device',
  connection: 'usb',
  transportId: '1',
  model: 'Pixel 7',
  manufacturer: null,
  androidVersion: '14',
  sdk: 34,
  ...overrides
})

interface Setup {
  actions: DeviceActions
  shells: string[]
  pushes: Array<{ serial: string; local: string; remote: string }>
  runs: string[][]
  captures: CaptureEntry[]
  copied: Buffer[]
  progress: TransferProgress[]
}

describe('DeviceActions', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'actions-test-'))
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  function setup(
    options: {
      devices?: Device[]
      flags?: string[] | null
      scrcpy?: boolean
      shell?: (command: string) => string | Promise<string>
      bytes?: () => Buffer | Promise<Buffer>
      push?: (remote: string) => void | Promise<void>
      run?: (args: string[]) => ScrcpyRun | Promise<ScrcpyRun>
      copy?: boolean
    } = {}
  ): Setup {
    const shells: string[] = []
    const pushes: Setup['pushes'] = []
    const runs: string[][] = []
    const captures: CaptureEntry[] = []
    const copied: Buffer[] = []
    const progress: TransferProgress[] = []
    const deps: ActionsDeps = {
      tools: {
        state: {
          status: {
            scrcpy:
              options.scrcpy === false
                ? null
                : {
                    path: 'C:\\scrcpy.exe',
                    version: '3.1',
                    source: 'path',
                    flags: options.flags === undefined ? null : options.flags
                  },
            adb: { path: 'C:\\adb.exe', version: '35' },
            managedRoot: 'C:\\managed'
          },
          download: { phase: 'idle', received: 0, total: 0, version: null, error: null }
        }
      },
      devices: {
        snapshot: { adb: 'connected', error: null, devices: options.devices ?? [device('A')] }
      },
      adb: {
        shell: async (_serial, command) => {
          shells.push(command)
          return options.shell ? options.shell(command) : ''
        },
        bytes: async () => (options.bytes ? options.bytes() : PNG),
        push: async (serial, local, remote, onProgress) => {
          pushes.push({ serial, local, remote })
          await options.push?.(remote)
          onProgress(10, 10)
        }
      },
      runScrcpy: async (_path, args) => {
        runs.push(args)
        return options.run ? options.run(args) : { code: 0, output: '' }
      },
      settings: {
        screenshotFolder: () => join(dir, 'shots'),
        addCapture: (entry) => void captures.push(entry)
      },
      copyImage: async (png) => {
        copied.push(png)
        return options.copy ?? true
      },
      now: () => new Date(2026, 9, 25, 14, 5, 9),
      randomId: () => 'abc123'
    }
    const actions = new DeviceActions(deps)
    actions.onProgress((p) => progress.push(p))
    return { actions, shells, pushes, runs, captures, copied, progress }
  }

  describe('screenshot', () => {
    it('saves a PNG named after the device and time, copies it and records it', async () => {
      const s = setup()
      const result = await s.actions.screenshot('A')
      const path = join(dir, 'shots', 'Pixel_7-2026-10-25-14-05-09.png')
      expect(result).toEqual({ ok: true, path, copied: true })
      expect(readFileSync(path).equals(PNG)).toBe(true)
      expect(s.copied).toEqual([PNG])
      expect(s.captures).toEqual([
        {
          path,
          kind: 'screenshot',
          device: 'Pixel 7',
          at: new Date(2026, 9, 25, 14, 5, 9).toISOString()
        }
      ])
    })

    it('finds the image after log lines a device prints first (as a Xiaomi TV does)', async () => {
      const noisy = Buffer.concat([
        Buffer.from('Init wrapper sys mutex successful. Pid:27502\nopen mma dev failed\n'),
        PNG,
        Buffer.from('trailing text')
      ])
      const s = setup({ bytes: () => noisy })
      const result = await s.actions.screenshot('A')
      expect(result.ok).toBe(true)
      if (result.ok) expect(readFileSync(result.path).equals(PNG)).toBe(true)
      expect(s.copied).toEqual([PNG])
    })

    it('rejects an image that was cut off', async () => {
      const s = setup({ bytes: () => Buffer.concat([SIGNATURE, Buffer.from('half')]) })
      expect(await s.actions.screenshot('A')).toMatchObject({ ok: false })
    })

    it('never overwrites a screenshot taken in the same second', async () => {
      const s = setup()
      const first = await s.actions.screenshot('A')
      const second = await s.actions.screenshot('A')
      expect(first.ok && second.ok).toBe(true)
      if (first.ok && second.ok) {
        expect(second.path).toBe(first.path.replace('.png', '-2.png'))
      }
    })

    it('still succeeds when the clipboard is not available', async () => {
      const s = setup({ copy: false })
      const result = await s.actions.screenshot('A')
      expect(result).toMatchObject({ ok: true, copied: false })
    })

    it('explains output that is not an image', async () => {
      const s = setup({ bytes: () => Buffer.from('Failed to take screenshot\nmore') })
      const result = await s.actions.screenshot('A')
      expect(result).toEqual({
        ok: false,
        error:
          'The device did not return an image. The screen may be off or protected. It said: “Failed to take screenshot”'
      })
      expect(s.captures).toEqual([])
    })

    it('reports adb errors and unusable devices', async () => {
      const failing = setup({
        bytes: () => {
          throw new Error('adb: device offline')
        }
      })
      expect(await failing.actions.screenshot('A')).toMatchObject({ ok: false })
      const none = setup({ devices: [device('A', { state: 'unauthorized' })] })
      expect(await none.actions.screenshot('A')).toMatchObject({ ok: false })
      expect(await none.actions.screenshot('missing')).toMatchObject({ ok: false })
      expect(await none.actions.screenshot(5)).toMatchObject({
        ok: false,
        error: 'Invalid device.'
      })
    })

    it('reports a folder that cannot be created', async () => {
      const blocker = join(dir, 'shots')
      writeFileSync(blocker, 'a file where the folder should be')
      const s = setup()
      const result = await s.actions.screenshot('A')
      expect(result.ok).toBe(false)
    })
  })

  describe('sendFiles', () => {
    const file = (name: string, content = 'data'): string => {
      const path = join(dir, name)
      writeFileSync(path, content)
      return path
    }

    it('copies ordinary files to the Download folder', async () => {
      const s = setup()
      const path = file('notes.txt')
      const result = await s.actions.sendFiles('A', [path])
      expect(result).toEqual({
        ok: true,
        outcomes: [
          { name: 'notes.txt', kind: 'push', ok: true, message: 'Copied to /sdcard/Download.' }
        ]
      })
      expect(s.pushes).toEqual([{ serial: 'A', local: path, remote: '/sdcard/Download/notes.txt' }])
      expect(s.shells).toEqual([])
    })

    it('installs an APK through a temporary file and removes it afterwards', async () => {
      const s = setup({ shell: (c) => (c.startsWith('pm install') ? 'Success' : '') })
      const result = await s.actions.sendFiles('A', [file('app.APK')])
      expect(result).toMatchObject({
        ok: true,
        outcomes: [{ name: 'app.APK', kind: 'install', ok: true, message: 'Installed.' }]
      })
      expect(s.pushes[0].remote).toBe('/data/local/tmp/droidsync-abc123.apk')
      expect(s.shells).toEqual([
        'pm install -r /data/local/tmp/droidsync-abc123.apk',
        'rm -f /data/local/tmp/droidsync-abc123.apk'
      ])
    })

    it('reports a failed install and still cleans up', async () => {
      const s = setup({
        shell: (c) =>
          c.startsWith('pm install') ? 'Failure [INSTALL_FAILED_INSUFFICIENT_STORAGE]' : ''
      })
      const result = await s.actions.sendFiles('A', [file('app.apk')])
      expect(result).toMatchObject({
        ok: true,
        outcomes: [{ ok: false, message: 'The device does not have enough free storage.' }]
      })
      expect(s.shells.at(-1)).toBe('rm -f /data/local/tmp/droidsync-abc123.apk')
    })

    it('carries on after one file fails', async () => {
      const s = setup({
        push: (remote) => {
          if (remote.endsWith('/bad.txt')) throw new Error('The device refused the file: Read-only')
        }
      })
      const result = await s.actions.sendFiles('A', [file('bad.txt'), file('good.txt')])
      expect(result.ok && result.outcomes.map((o) => o.ok)).toEqual([false, true])
    })

    it('rejects bundles, network paths, relative paths and non-strings per file', async () => {
      const s = setup()
      const result = await s.actions.sendFiles('A', [
        join(dir, 'x.xapk'),
        '\\\\server\\share\\a.txt',
        'relative.txt',
        42
      ])
      expect(result.ok && result.outcomes.every((o) => !o.ok)).toBe(true)
      expect(s.pushes).toEqual([])
    })

    it('sends names with spaces and symbols as they are (no shell is involved)', async () => {
      const s = setup()
      await s.actions.sendFiles('A', [file("we ird & 'name' (1) é.txt")])
      expect(s.pushes[0].remote).toBe("/sdcard/Download/we ird & 'name' (1) é.txt")
    })

    it('limits the number of files and needs a ready device', async () => {
      const s = setup()
      expect(await s.actions.sendFiles('A', [])).toMatchObject({ ok: false })
      expect(await s.actions.sendFiles('A', 'nope')).toMatchObject({ ok: false })
      expect(
        await s.actions.sendFiles(
          'A',
          Array.from({ length: 21 }, (_, i) => `C:\\f${i}`)
        )
      ).toMatchObject({ ok: false })
      expect(await s.actions.sendFiles('Z', [file('a.txt')])).toMatchObject({ ok: false })
    })

    it('allows one transfer per device at a time', async () => {
      let release: () => void = () => {}
      const gate = new Promise<void>((resolve) => (release = resolve))
      const s = setup({ push: () => gate })
      const first = s.actions.sendFiles('A', [file('a.txt')])
      await new Promise((r) => setTimeout(r, 5))
      expect(await s.actions.sendFiles('A', [file('b.txt')])).toMatchObject({
        ok: false,
        error: 'Another transfer to this device is still running.'
      })
      release()
      expect(await first).toMatchObject({ ok: true })
      expect(await s.actions.sendFiles('A', [file('c.txt')])).toMatchObject({ ok: true })
    })

    it('reports progress with the file name', async () => {
      const s = setup()
      await s.actions.sendFiles('A', [file('a.txt')])
      expect(s.progress).toEqual([{ serial: 'A', name: 'a.txt', sent: 10, total: 10 }])
    })

    it('says what a timeout means', async () => {
      const s = setup({
        push: () => {
          throw new Error('adb timed out')
        }
      })
      const result = await s.actions.sendFiles('A', [file('a.txt')])
      expect(result.ok && result.outcomes[0].message).toMatch(/stopped responding/)
    })

    it('refuses folders', async () => {
      const folder = join(dir, 'folder')
      mkdirSync(folder)
      const s = setup({
        push: () => {
          throw new Error('Not a regular file')
        }
      })
      const result = await s.actions.sendFiles('A', [folder])
      expect(result.ok && result.outcomes[0].message).toMatch(/Folders cannot be sent/)
    })
  })

  describe('apps', () => {
    it('uses scrcpy for names when it supports --list-apps', async () => {
      const s = setup({
        flags: ['--list-apps'],
        run: () => ({
          code: 0,
          output: ' - Chrome        com.android.chrome\n * Settings      com.android.settings'
        })
      })
      const result = await s.actions.listApps('A')
      expect(result).toMatchObject({ ok: true, source: 'scrcpy' })
      expect(result.ok && result.apps.map((a) => a.label)).toEqual(['Chrome', 'Settings'])
      expect(s.runs).toEqual([['--serial', 'A', '--list-apps']])
    })

    it('falls back to adb when this scrcpy cannot list apps', async () => {
      const s = setup({
        flags: ['--no-audio'],
        shell: (c) =>
          c.startsWith('cmd package')
            ? '    com.android.deskclock/.DeskClock\n    com.tailscale.ipn/.Main'
            : 'package:com.tailscale.ipn'
      })
      const result = await s.actions.listApps('A')
      expect(result).toEqual({
        ok: true,
        source: 'adb',
        apps: [
          { packageName: 'com.android.deskclock', label: null, system: true },
          { packageName: 'com.tailscale.ipn', label: null, system: false }
        ]
      })
      expect(s.runs).toEqual([])
    })

    it('falls back to adb when scrcpy fails or lists nothing', async () => {
      const s = setup({
        flags: ['--list-apps'],
        run: () => ({ code: 1, output: 'ERROR: Could not list apps' }),
        shell: (c) => (c.startsWith('cmd package') ? '' : 'package:com.only.user')
      })
      const result = await s.actions.listApps('A')
      expect(result).toMatchObject({ ok: true, source: 'adb' })
      expect(result.ok && result.apps.map((a) => a.packageName)).toEqual(['com.only.user'])
    })

    it('reports adb failures', async () => {
      const s = setup({
        shell: () => {
          throw new Error('adb: device offline')
        }
      })
      expect(await s.actions.listApps('A')).toMatchObject({ ok: false })
    })

    it('opens an app with monkey, only for valid package names', async () => {
      const s = setup({ shell: () => 'Events injected: 1' })
      expect(await s.actions.launchApp('A', 'com.android.chrome')).toEqual({ ok: true })
      expect(s.shells).toEqual([
        'monkey -p com.android.chrome -c android.intent.category.LAUNCHER 1'
      ])
      for (const bad of ['calc', 'com.x; reboot', 'com.x\n', 5, '']) {
        expect((await s.actions.launchApp('A', bad)).ok).toBe(false)
      }
      expect(s.shells).toHaveLength(1)
    })

    it('says when an app has no launcher screen', async () => {
      const s = setup({ shell: () => '** No activities found to run, monkey aborted.' })
      expect(await s.actions.launchApp('A', 'com.x.y')).toEqual({
        ok: false,
        error: 'This app has no screen to open.'
      })
    })
  })

  describe('listSources', () => {
    it('lists displays', async () => {
      const s = setup({
        flags: ['--list-displays'],
        run: () => ({
          code: 0,
          output: '[server] INFO: List of displays:\n    --display-id=0    (1920x1080)'
        })
      })
      expect(await s.actions.listSources('A', 'displays')).toEqual({
        ok: true,
        displays: [{ id: 0, size: '1920x1080' }],
        cameras: []
      })
      expect(s.runs).toEqual([['--serial', 'A', '--list-displays']])
    })

    it('lists cameras and merges their sizes', async () => {
      const s = setup({
        flags: ['--list-cameras', '--list-camera-sizes'],
        run: (args) =>
          args.includes('--list-camera-sizes')
            ? {
                code: 0,
                output: '    --camera-id=0    (back, 4000x3000, fps=[30])\n        - 1920x1080'
              }
            : { code: 0, output: '    --camera-id=0    (back, 4000x3000, fps=[30])' }
      })
      const result = await s.actions.listSources('A', 'cameras')
      expect(result.ok && result.cameras).toEqual([
        { id: '0', facing: 'back', size: '4000x3000', fps: '30', sizes: ['1920x1080'] }
      ])
    })

    it('returns an empty list when the device has no cameras', async () => {
      const s = setup({
        flags: ['--list-cameras'],
        run: () => ({ code: 0, output: '[server] INFO: List of cameras:\n    (none)' })
      })
      expect(await s.actions.listSources('A', 'cameras')).toEqual({
        ok: true,
        displays: [],
        cameras: []
      })
    })

    it('reports scrcpy errors with the useful line', async () => {
      const s = setup({
        flags: ['--list-cameras'],
        run: () => ({
          code: 1,
          output: 'scrcpy 3.1\n[server] ERROR: Camera mirroring requires Android 12\nINFO: bye'
        })
      })
      expect(await s.actions.listSources('A', 'cameras')).toEqual({
        ok: false,
        error: 'scrcpy said: ERROR: Camera mirroring requires Android 12'
      })
    })

    it('explains when scrcpy is missing or too old, and rejects unknown kinds', async () => {
      expect(await setup({ scrcpy: false }).actions.listSources('A', 'displays')).toMatchObject({
        ok: false
      })
      const old = setup({ flags: ['--no-audio'] })
      const result = await old.actions.listSources('A', 'cameras')
      expect(result).toMatchObject({ ok: false })
      expect(old.runs).toEqual([])
      expect(await old.actions.listSources('A', 'microphones')).toMatchObject({ ok: false })
    })
  })
})

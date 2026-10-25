import { describe, expect, it } from 'vitest'
import {
  OPTIONS,
  OPTION_GROUPS,
  buildArgs,
  defaultWindowTitle,
  expandPlaceholders,
  formatCommand,
  matchesQuery,
  resolveFlag,
  sanitizeConfig,
  optionById,
  splitArgs,
  type BuildContext
} from './options'

const all = new Set(OPTIONS.flatMap((o) => o.flags))
const ctx = (overrides: Partial<BuildContext> = {}): BuildContext => ({
  serial: 'R5CT1234ABC',
  flags: all,
  ...overrides
})

describe('schema', () => {
  it('has unique ids and long flags only', () => {
    expect(new Set(OPTIONS.map((o) => o.id)).size).toBe(OPTIONS.length)
    for (const option of OPTIONS) {
      for (const flag of option.flags) expect(flag).toMatch(/^--[a-z0-9-]+$/)
    }
  })

  it('has no two options writing the same flag', () => {
    const flags = OPTIONS.flatMap((o) => o.flags)
    expect(new Set(flags).size).toBe(flags.length)
  })

  it('describes every option and puts it in a known group', () => {
    const groups = new Set(OPTION_GROUPS.map((g) => g.id))
    for (const option of OPTIONS) {
      expect(option.label.length, option.id).toBeGreaterThan(2)
      expect(option.description.length, option.id).toBeGreaterThan(10)
      expect(groups.has(option.group), option.id).toBe(true)
    }
    for (const group of OPTION_GROUPS) {
      expect(
        OPTIONS.some((o) => o.group === group.id),
        group.id
      ).toBe(true)
    }
  })

  it('gives every non-args option a flag, and keeps the original fifteen ids', () => {
    for (const option of OPTIONS) {
      if (option.kind !== 'args') expect(option.flags.length, option.id).toBeGreaterThan(0)
    }
    for (const id of ['maxSize', 'videoBitRate', 'noAudio', 'noControl', 'windowTitle']) {
      expect(optionById(id), id).toBeDefined()
    }
    expect(OPTIONS.length).toBeGreaterThan(80)
  })

  it('keeps reserved flags out of the schema', () => {
    const flags = new Set(OPTIONS.flatMap((o) => o.flags))
    for (const reserved of [
      '--serial',
      '--select-usb',
      '--select-tcpip',
      '--otg',
      '--tcpip',
      '--kill-adb-on-close'
    ]) {
      expect(flags.has(reserved), reserved).toBe(false)
    }
  })

  it('has valid regexes and enum choices', () => {
    for (const option of OPTIONS) {
      if ('pattern' in option && option.pattern)
        expect(() => new RegExp(option.pattern!.regex)).not.toThrow()
      if (option.kind === 'enum') {
        expect(option.choices.length, option.id).toBeGreaterThan(1)
        expect(new Set(option.choices.map((c) => c.value)).size, option.id).toBe(
          option.choices.length
        )
      }
      if (option.kind === 'int') expect(option.min, option.id).toBeLessThanOrEqual(option.max)
    }
  })

  it('accepts a sample valid value for every pattern-checked option', () => {
    const samples: Record<string, string> = {
      videoCodecOptions: 'profile=1,level=2',
      captureOrientation: '@90',
      crop: '1224:1440:0:0',
      backgroundColor: '#202020',
      cameraSize: '1920x1080',
      cameraAr: '4:3',
      cameraZoom: '1.5',
      mouseBind: 'bhsn:++++',
      shortcutMod: 'lctrl+lalt,lsuper',
      newDisplay: '1920x1080/420',
      port: '27183:27199',
      tunnelHost: '127.0.0.1',
      videoBitRate: '8M',
      audioBitRate: '128K',
      audioCodecOptions: 'key=value',
      angle: '15.5',
      cameraId: '0'
    }
    for (const [id, value] of Object.entries(samples)) {
      expect(buildArgs({ [id]: value }, ctx()).errors, id).toEqual({})
    }
  })
})

describe('matchesQuery', () => {
  const find = (query: string): string[] =>
    OPTIONS.filter((o) => matchesQuery(o, query)).map((o) => o.id)

  it('matches everything for an empty query', () => {
    expect(find('  ')).toHaveLength(OPTIONS.length)
  })

  it('matches names, descriptions and flags, all words required', () => {
    expect(find('bit rate')).toEqual(expect.arrayContaining(['videoBitRate', 'audioBitRate']))
    expect(find('--stay-awake')).toEqual(['stayAwake'])
    expect(find('TORCH')).toContain('cameraTorch')
    expect(find('torch screen')).not.toContain('cameraTorch')
    expect(find('zzzz')).toEqual([])
  })
})

describe('new option kinds', () => {
  it('optional: bare flag when true, flag=value when text', () => {
    expect(buildArgs({ newDisplay: true }, ctx()).args).toContain('--new-display')
    expect(buildArgs({ newDisplay: '1280x720/320' }, ctx()).args).toContain(
      '--new-display=1280x720/320'
    )
    expect(buildArgs({ newDisplay: '12 monkeys' }, ctx()).errors['newDisplay']).toBeDefined()
  })

  it('path: needs a known extension or a format, rejects characters Windows forbids', () => {
    expect(buildArgs({ record: 'C:\\V\\a.mp4' }, ctx()).args).toContain('--record=C:\\V\\a.mp4')
    expect(buildArgs({ record: 'C:\\V\\{device}.MKV' }, ctx()).errors).toEqual({})
    expect(buildArgs({ record: 'C:\\V\\a.txt' }, ctx()).errors['record']).toContain('.mp4')
    expect(buildArgs({ record: 'C:\\V\\a.txt', recordFormat: 'mkv' }, ctx()).errors).toEqual({})
    expect(buildArgs({ record: 'C:\\V\\a?.mp4' }, ctx()).errors['record']).toContain('characters')
  })

  it('int without a default is emitted even when 0 is allowed', () => {
    expect(buildArgs({ windowX: 0 }, ctx()).args).toContain('--window-x=0')
    expect(buildArgs({ windowX: -200 }, ctx()).args).toContain('--window-x=-200')
    expect(buildArgs({ windowWidth: 0 }, ctx()).args).not.toContain('--window-width=0')
  })

  it('args: appended as separate tokens after the other options', () => {
    const { args, errors } = buildArgs(
      { extraArgs: `--foo --bar="two words" 'single'`, noAudio: true },
      ctx()
    )
    expect(errors).toEqual({})
    // Extra arguments come last, after every schema option.
    expect(args.slice(-4)).toEqual(['--no-audio', '--foo', '--bar=two words', 'single'])
  })

  it('args: rejects device-selection flags and unbalanced quotes', () => {
    for (const bad of [
      '--serial=other',
      '-s abc',
      '--select-usb',
      '-d',
      '--otg',
      '--tcpip=1.2.3.4',
      '--kill-adb-on-close'
    ]) {
      expect(buildArgs({ extraArgs: bad }, ctx()).errors['extraArgs'], bad).toContain(
        'managed by the app'
      )
    }
    expect(buildArgs({ extraArgs: '--x "oops' }, ctx()).errors['extraArgs']).toContain('closing')
    // Not a reserved flag: only the exact names are blocked.
    expect(buildArgs({ extraArgs: '--select-usbx' }, ctx()).errors).toEqual({})
  })

  it('args: always available, even when scrcpy flags are limited', () => {
    const result = buildArgs({ extraArgs: '--future-flag' }, ctx({ flags: new Set(['--serial']) }))
    expect(result.args).toContain('--future-flag')
    expect(result.unsupported).toEqual([])
  })
})

describe('splitArgs', () => {
  it('splits on whitespace and honours both quote styles', () => {
    expect(splitArgs(`a  b\t"c d" 'e f' g"h i"j`).tokens).toEqual(['a', 'b', 'c d', 'e f', 'gh ij'])
  })

  it('keeps empty quoted tokens and backslashes', () => {
    expect(splitArgs(`"" C:\\x\\y`).tokens).toEqual(['', 'C:\\x\\y'])
    expect(splitArgs('   ').tokens).toEqual([])
  })

  it('reports an unclosed quote', () => {
    expect(splitArgs(`a 'b`).error).toContain("'")
  })
})

describe('expandPlaceholders', () => {
  const now = new Date(2026, 0, 5, 3, 4, 5)
  it('fills in device, date and time', () => {
    expect(expandPlaceholders('{device}_{date}_{time}.mp4', 'Pixel 7', now)).toBe(
      'Pixel_7_2026-01-05_03-04-05.mp4'
    )
  })

  it('makes the device name safe for a file name', () => {
    expect(expandPlaceholders('{device}', '192.168.1.5:5555', now)).toBe('192.168.1.5_5555')
    expect(expandPlaceholders('{device}', '???', now)).toBe('device')
  })

  it('leaves other braces alone and replaces every occurrence', () => {
    expect(expandPlaceholders('{date}-{date}-{other}', 'x', now)).toBe(
      '2026-01-05-2026-01-05-{other}'
    )
  })
})

describe('buildArgs', () => {
  it('always selects the device and nothing else for an empty config', () => {
    expect(buildArgs({}, ctx())).toEqual({
      args: ['--serial=R5CT1234ABC'],
      errors: {},
      unsupported: []
    })
  })

  it('emits flags in schema order using --name=value', () => {
    const result = buildArgs(
      { stayAwake: true, maxSize: 1024, videoBitRate: '4M', videoCodec: 'h265', fullscreen: true },
      ctx()
    )
    expect(result.args).toEqual([
      '--serial=R5CT1234ABC',
      '--max-size=1024',
      '--video-bit-rate=4M',
      '--video-codec=h265',
      '--fullscreen',
      '--stay-awake'
    ])
    expect(result.errors).toEqual({})
  })

  it('omits an int that equals the scrcpy default', () => {
    expect(buildArgs({ maxSize: 0, maxFps: 0 }, ctx()).args).toEqual(['--serial=R5CT1234ABC'])
  })

  it('ignores a bool that is false', () => {
    expect(buildArgs({ noAudio: false }, ctx()).args).toEqual(['--serial=R5CT1234ABC'])
  })

  it('uses the default window title unless one is set', () => {
    expect(buildArgs({}, ctx({ defaultTitle: 'Pixel 7 (ABC)' })).args).toContain(
      '--window-title=Pixel 7 (ABC)'
    )
    const custom = buildArgs({ windowTitle: 'Demo' }, ctx({ defaultTitle: 'Pixel 7 (ABC)' }))
    expect(custom.args).toContain('--window-title=Demo')
    expect(custom.args.filter((a) => a.startsWith('--window-title'))).toHaveLength(1)
  })

  it('keeps hostile text inside a single argument', () => {
    const { args } = buildArgs({ windowTitle: 'a" --no-control & calc' }, ctx())
    expect(args).toContain('--window-title=a" --no-control & calc')
    expect(args.some((a) => a === '--no-control')).toBe(false)
  })

  it('falls back to an older flag name', () => {
    const old = new Set(['--bit-rate'])
    expect(buildArgs({ videoBitRate: '2M' }, ctx({ flags: old })).args).toContain('--bit-rate=2M')
  })

  it('reports options the installed scrcpy does not know and leaves them out', () => {
    const result = buildArgs(
      { orientation: '90', stayAwake: true },
      ctx({ flags: new Set(['--stay-awake']) })
    )
    expect(result.unsupported).toEqual(['orientation'])
    expect(result.args).toEqual(['--serial=R5CT1234ABC', '--stay-awake'])
  })

  it('assumes everything exists when flags are unknown', () => {
    expect(buildArgs({ noAudio: true }, ctx({ flags: null })).args).toContain('--no-audio')
  })

  it('reports invalid values per option and does not emit them', () => {
    const result = buildArgs(
      {
        maxSize: -5,
        maxFps: 1.5,
        videoBitRate: '8 Mbit',
        windowTitle: 'x'.repeat(101),
        videoCodec: 'mpeg4'
      },
      ctx()
    )
    expect(Object.keys(result.errors).sort()).toEqual([
      'maxFps',
      'maxSize',
      'videoBitRate',
      'videoCodec',
      'windowTitle'
    ])
    expect(result.args).toEqual(['--serial=R5CT1234ABC'])
  })

  it('rejects control characters in text', () => {
    expect(buildArgs({ windowTitle: 'a\nb' }, ctx()).errors['windowTitle']).toContain('control')
  })

  it('accepts bit rates with and without a suffix', () => {
    for (const rate of ['8M', '500K', '2000000', '4m']) {
      expect(buildArgs({ videoBitRate: rate }, ctx()).errors).toEqual({})
    }
  })
})

describe('resolveFlag', () => {
  it('prefers the first candidate the scrcpy knows', () => {
    const option = optionById('videoBitRate')!
    expect(resolveFlag(option, new Set(['--video-bit-rate', '--bit-rate']))).toBe(
      '--video-bit-rate'
    )
    expect(resolveFlag(option, new Set())).toBeNull()
    expect(resolveFlag(option, null)).toBe('--video-bit-rate')
  })
})

describe('sanitizeConfig', () => {
  it('drops unknown ids and wrongly typed values', () => {
    expect(
      sanitizeConfig({
        maxSize: '1024',
        maxFps: 60,
        fullscreen: 'yes',
        stayAwake: true,
        videoCodec: 'h264',
        orientation: 'sideways',
        bogus: 1,
        windowTitle: '  Demo  '
      })
    ).toEqual({ maxFps: 60, stayAwake: true, videoCodec: 'h264', windowTitle: 'Demo' })
  })

  it('drops false bools and empty strings, and tolerates non-objects', () => {
    expect(sanitizeConfig({ stayAwake: false, windowTitle: '   ' })).toEqual({})
    expect(sanitizeConfig(null)).toEqual({})
    expect(sanitizeConfig([1, 2])).toEqual({})
    expect(sanitizeConfig('x')).toEqual({})
  })

  it('keeps out-of-range numbers so they can be shown as errors', () => {
    expect(sanitizeConfig({ maxSize: -1 })).toEqual({ maxSize: -1 })
  })
})

describe('defaultWindowTitle', () => {
  it('names the model and serial, and strips control characters and excess length', () => {
    expect(defaultWindowTitle('Pixel 7', 'ABC')).toBe('Pixel 7 (ABC)')
    expect(defaultWindowTitle(null, 'ABC')).toBe('Android device (ABC)')
    expect(defaultWindowTitle('a\nb', 'x')).toBe('a b (x)')
    expect(defaultWindowTitle('m'.repeat(300), 'x')).toHaveLength(100)
  })
})

describe('formatCommand', () => {
  it('quotes arguments that contain spaces or quotes', () => {
    expect(
      formatCommand('C:\\Tools\\scrcpy.exe', ['--serial=A', '--window-title=My "phone"'])
    ).toBe('C:\\Tools\\scrcpy.exe --serial=A "--window-title=My \\"phone\\""')
    expect(formatCommand('scrcpy', ['--fullscreen'])).toBe('scrcpy --fullscreen')
  })
})

import { spawnSync } from 'child_process'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { buildCmdLine, quoteForCmd } from './windows'

describe('quoteForCmd', () => {
  it('wraps in quotes and neutralises quotes and percent signs', () => {
    expect(quoteForCmd('--window-title=My "phone"')).toBe(`"--window-title=My 'phone'"`)
    expect(quoteForCmd('%PATH%')).toBe('"\uFF05PATH\uFF05"')
  })

  it('doubles trailing backslashes and strips control characters', () => {
    expect(quoteForCmd('C:\\dir\\')).toBe('"C:\\dir\\\\"')
    expect(quoteForCmd('a\nb')).toBe('"a b"')
  })

  it('leaves metacharacters inside the quotes', () => {
    expect(quoteForCmd('a & b | c > d')).toBe('"a & b | c > d"')
  })
})

describe('buildCmdLine', () => {
  it('quotes every token including the executable', () => {
    expect(buildCmdLine('C:\\Program Files\\scrcpy.exe', ['--serial=A', '--fullscreen'])).toBe(
      '"C:\\Program Files\\scrcpy.exe" "--serial=A" "--fullscreen"'
    )
  })
})

// The real thing: run a program through cmd.exe the way the app does and see what it receives.
describe.skipIf(process.platform !== 'win32')('through cmd.exe', () => {
  const cmd = join(process.env['SystemRoot'] ?? 'C:\\Windows', 'System32', 'cmd.exe')
  const received = (args: string[]): string[] => {
    const script = 'process.stdout.write(JSON.stringify(process.argv.slice(1)))'
    const line = buildCmdLine(process.execPath, ['-e', script, '--', ...args])
    const result = spawnSync(cmd, ['/d', '/v:off', '/s', '/c', `"${line}"`], {
      windowsVerbatimArguments: true,
      encoding: 'utf8',
      env: { ...process.env, SECRET_VAR: 'LEAKED' }
    })
    if (result.status !== 0) throw new Error(`cmd failed: ${result.stderr}`)
    return JSON.parse(result.stdout)
  }

  it('delivers ordinary arguments unchanged', () => {
    expect(
      received(['--serial=192.168.1.5:5555', '--max-size=1024', '--window-title=Pixel 7 (ABC)'])
    ).toEqual(['--serial=192.168.1.5:5555', '--max-size=1024', '--window-title=Pixel 7 (ABC)'])
  })

  it('does not run injected commands or expand variables', () => {
    const args = received([
      '--window-title=x" & echo INJECTED & "y',
      '--window-title=%SECRET_VAR%',
      '--window-title=a | b > c ^ d & e',
      '--window-title=trailing\\'
    ])
    expect(args).toHaveLength(4)
    expect(args[0]).toBe(`--window-title=x' & echo INJECTED & 'y`)
    expect(args[1]).not.toContain('LEAKED')
    expect(args[2]).toBe('--window-title=a | b > c ^ d & e')
    expect(args[3]).toBe('--window-title=trailing\\')
  })
})

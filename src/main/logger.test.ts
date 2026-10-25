import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Logger } from './logger'

describe('Logger', () => {
  let dir: string
  let file: string
  const fixed = (): Date => new Date('2026-10-25T10:00:00.000Z')
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'logger-test-'))
    file = join(dir, 'logs', 'app.log')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates the folder and writes timestamped lines', () => {
    const log = new Logger(file, 1024, fixed)
    log.info('hello', 42)
    log.warn('careful')
    log.error('bad')
    expect(readFileSync(file, 'utf8')).toBe(
      [
        '2026-10-25T10:00:00.000Z INFO  hello 42',
        '2026-10-25T10:00:00.000Z WARN  careful',
        '2026-10-25T10:00:00.000Z ERROR bad',
        ''
      ].join('\n')
    )
  })

  it('writes errors with their stack and objects as JSON', () => {
    const log = new Logger(file, 4096, fixed)
    log.error('failed:', new Error('boom'), { code: 5 })
    const text = readFileSync(file, 'utf8')
    expect(text).toContain('Error: boom')
    expect(text).toContain('{"code":5}')
  })

  it('keeps a multi-line message under its first line', () => {
    const log = new Logger(file, 4096, fixed)
    log.info('line one\nline two')
    expect(readFileSync(file, 'utf8')).toContain('line one\n    line two\n')
  })

  it('moves a full log aside and starts a new one, keeping only one old copy', () => {
    const log = new Logger(file, 200, fixed)
    for (let i = 0; i < 30; i++) log.info(`message number ${i}`)
    expect(existsSync(`${file}.1`)).toBe(true)
    expect(existsSync(`${file}.2`)).toBe(false)
    expect(readFileSync(file, 'utf8').length).toBeLessThanOrEqual(200)
    expect(readFileSync(file, 'utf8')).toContain('message number 29')
  })

  it('returns the last lines, and nothing when there is no log', () => {
    const log = new Logger(file, 4096, fixed)
    expect(log.tail(5)).toEqual([])
    for (let i = 0; i < 10; i++) log.info(`n${i}`)
    expect(log.tail(3).map((l) => l.split(' ').pop())).toEqual(['n7', 'n8', 'n9'])
  })

  it('never throws, even when the file cannot be written', () => {
    // A file where the log folder should be makes every write fail.
    writeFileSync(join(dir, 'logs'), 'not a folder')
    const log = new Logger(file, 4096, fixed)
    expect(() => log.error('still fine')).not.toThrow()
    expect(log.tail(5)).toEqual([])
  })
})

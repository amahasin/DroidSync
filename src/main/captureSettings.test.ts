import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureEntry } from '../shared/models'
import { SettingsStore } from './settings'

describe('SettingsStore captures and screenshot folder', () => {
  let dir: string
  let file: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'droidsync-captures-'))
    file = join(dir, 'nested', 'settings.json')
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  const shot = (path: string, at = '2026-10-25T10:00:00.000Z'): CaptureEntry => ({
    path,
    kind: 'screenshot',
    device: 'Pixel',
    at
  })

  it('lists the newest first and keeps each file once, ignoring case', () => {
    const store = new SettingsStore(file)
    store.addCapture(shot('C:\\Pics\\a.png'))
    store.addCapture(shot('C:\\Pics\\b.png'))
    store.addCapture(shot('c:\\pics\\A.png'))
    expect(store.snapshot.captures.map((c) => c.path)).toEqual([
      'c:\\pics\\A.png',
      'C:\\Pics\\b.png'
    ])
  })

  it('keeps only the latest 200', () => {
    const store = new SettingsStore(file)
    for (let i = 0; i < 205; i++) store.addCapture(shot(`C:\\Pics\\${i}.png`))
    expect(store.snapshot.captures).toHaveLength(200)
    expect(store.snapshot.captures[0].path).toBe('C:\\Pics\\204.png')
  })

  it('rejects entries that are not absolute paths or have a bad kind or time', () => {
    const store = new SettingsStore(file)
    expect(store.addCapture(shot('relative.png')).ok).toBe(false)
    expect(store.addCapture({ ...shot('C:\\a.png'), kind: 'other' as never }).ok).toBe(false)
    expect(store.addCapture(shot('C:\\a.png', 'yesterday')).ok).toBe(false)
    expect(store.snapshot.captures).toEqual([])
  })

  it('removes an entry and knows what it holds', () => {
    const store = new SettingsStore(file)
    store.addCapture(shot('C:\\Pics\\a.png'))
    expect(store.hasCapture('c:\\pics\\a.png')).toBe(true)
    expect(store.hasCapture('C:\\Other\\a.png')).toBe(false)
    expect(store.hasCapture(5)).toBe(false)
    expect(store.removeCapture('C:\\Pics\\a.png').ok).toBe(true)
    expect(store.removeCapture('C:\\Pics\\a.png').ok).toBe(false)
    expect(store.snapshot.captures).toEqual([])
  })

  it('saves and reloads them, dropping damaged entries', () => {
    const first = new SettingsStore(file)
    first.addCapture(shot('C:\\Pics\\a.png'))
    first.setScreenshotFolder('D:\\Shots')
    const raw = JSON.parse(readFileSync(file, 'utf8'))
    raw.captures.push({ path: 5 }, { path: 'rel', kind: 'screenshot' }, null)
    writeFileSync(file, JSON.stringify(raw))
    const second = new SettingsStore(file).snapshot
    expect(second.captures.map((c) => c.path)).toEqual(['C:\\Pics\\a.png'])
    expect(second.screenshotFolder).toBe('D:\\Shots')
  })

  it('sets, resets and validates the screenshot folder', () => {
    const store = new SettingsStore(file)
    expect(store.snapshot.screenshotFolder).toBeNull()
    expect(store.setScreenshotFolder('D:\\Shots').ok).toBe(true)
    expect(store.setScreenshotFolder('shots').ok).toBe(false)
    expect(store.setScreenshotFolder(5).ok).toBe(false)
    expect(store.snapshot.screenshotFolder).toBe('D:\\Shots')
    expect(store.setScreenshotFolder(null).ok).toBe(true)
    expect(store.snapshot.screenshotFolder).toBeNull()
  })

  it('loads an older file that has neither', () => {
    mkdirSync(dirname(file), { recursive: true })
    writeFileSync(file, JSON.stringify({ version: 2, presets: [], autoReconnect: false }))
    const state = new SettingsStore(file).snapshot
    expect(state.captures).toEqual([])
    expect(state.screenshotFolder).toBeNull()
    expect(state.autoReconnect).toBe(false)
  })
})

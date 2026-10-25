import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { CaptureEntry } from '../shared/models'
import { Captures, resolveScreenshotFolder } from './captures'

describe('resolveScreenshotFolder', () => {
  it('uses the chosen folder, else a folder inside Pictures', () => {
    expect(resolveScreenshotFolder('D:\\Shots', 'C:\\Pictures')).toBe('D:\\Shots')
    expect(resolveScreenshotFolder(null, 'C:\\Pictures')).toBe(join('C:\\Pictures', 'DroidSync'))
  })
})

describe('Captures', () => {
  let dir: string
  let entries: CaptureEntry[]
  let opened: string[]
  let shown: string[]
  let trashed: string[]
  let confirm: boolean
  let captures: Captures

  const entry = (name: string, kind: CaptureEntry['kind'] = 'recording'): CaptureEntry => ({
    path: join(dir, name),
    kind,
    device: 'Pixel',
    at: '2026-10-25T10:00:00.000Z'
  })

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'captures-test-'))
    entries = []
    opened = []
    shown = []
    trashed = []
    confirm = true
    captures = new Captures({
      settings: {
        get snapshot() {
          return { captures: entries }
        },
        removeCapture: (path) => {
          const before = entries.length
          entries = entries.filter((e) => e.path !== path)
          return entries.length < before ? { ok: true } : { ok: false, error: 'not listed' }
        },
        hasCapture: (path) => entries.some((e) => e.path === path)
      },
      shell: {
        openPath: async (path) => {
          opened.push(path)
          return ''
        },
        showItemInFolder: (path) => void shown.push(path),
        trashItem: async (path) => void trashed.push(path)
      },
      confirmTrash: async () => confirm
    })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('lists entries with size, and marks files that are gone', async () => {
    writeFileSync(join(dir, 'a.mp4'), '12345')
    entries = [entry('a.mp4'), entry('gone.mp4')]
    expect(await captures.list()).toEqual([
      { ...entries[0], exists: true, size: 5 },
      { ...entries[1], exists: false, size: null }
    ])
  })

  it('opens media with the default app', async () => {
    writeFileSync(join(dir, 'a.mp4'), 'x')
    entries = [entry('a.mp4')]
    expect(await captures.open(entries[0].path)).toEqual({ ok: true })
    expect(opened).toEqual([entries[0].path])
  })

  it('only shows other file types in Explorer instead of running them', async () => {
    writeFileSync(join(dir, 'run.bat'), 'x')
    entries = [entry('run.bat')]
    expect(await captures.open(entries[0].path)).toEqual({ ok: true })
    expect(opened).toEqual([])
    expect(shown).toEqual([entries[0].path])
  })

  it('refuses paths that are not in the list, whatever they are', async () => {
    writeFileSync(join(dir, 'secret.mp4'), 'x')
    entries = [entry('a.mp4')]
    for (const action of ['open', 'show', 'trash'] as const) {
      expect(await captures[action](join(dir, 'secret.mp4'))).toMatchObject({ ok: false })
      expect(await captures[action](42)).toMatchObject({ ok: false })
    }
    expect(opened).toEqual([])
    expect(shown).toEqual([])
    expect(trashed).toEqual([])
  })

  it('says when the file is gone', async () => {
    entries = [entry('gone.mp4')]
    expect(await captures.open(entries[0].path)).toEqual({ ok: false, error: 'The file is gone.' })
    expect(await captures.show(entries[0].path)).toEqual({ ok: false, error: 'The file is gone.' })
  })

  it('shows a file in its folder', async () => {
    writeFileSync(join(dir, 'a.png'), 'x')
    entries = [entry('a.png', 'screenshot')]
    expect(await captures.show(entries[0].path)).toEqual({ ok: true })
    expect(shown).toEqual([entries[0].path])
  })

  it('removes an entry without touching the file', () => {
    entries = [entry('a.mp4')]
    expect(captures.remove(entries[0].path)).toEqual({ ok: true })
    expect(entries).toEqual([])
    expect(trashed).toEqual([])
  })

  it('moves a file to the Recycle Bin only after the person agrees', async () => {
    writeFileSync(join(dir, 'a.mp4'), 'x')
    entries = [entry('a.mp4')]
    confirm = false
    expect(await captures.trash(entries[0].path)).toEqual({ ok: false, error: 'Cancelled.' })
    expect(trashed).toEqual([])
    expect(entries).toHaveLength(1)

    confirm = true
    expect(await captures.trash(entries[0].path)).toEqual({ ok: true })
    expect(trashed).toHaveLength(1)
    expect(entries).toEqual([])
  })

  it('just drops the entry when asked to trash a file that is already gone', async () => {
    entries = [entry('gone.mp4')]
    expect(await captures.trash(entries[0].path)).toEqual({ ok: true })
    expect(entries).toEqual([])
    expect(trashed).toEqual([])
  })
})

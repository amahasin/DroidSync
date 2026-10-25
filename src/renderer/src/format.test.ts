import { describe, expect, it } from 'vitest'
import { fileName, formatBytes, percent } from './format'

describe('formatBytes', () => {
  it('uses the largest sensible unit', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(1023)).toBe('1023 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(5 * 1024 * 1024)).toBe('5 MB')
    expect(formatBytes(250 * 1024 * 1024)).toBe('250 MB')
    expect(formatBytes(3.2 * 1024 ** 3)).toBe('3.2 GB')
  })
})

describe('fileName', () => {
  it('handles both kinds of separator and trailing ones', () => {
    expect(fileName('C:\\Users\\me\\Videos\\clip.mp4')).toBe('clip.mp4')
    expect(fileName('/sdcard/Download/a.apk')).toBe('a.apk')
    expect(fileName('C:\\folder\\')).toBe('folder')
    expect(fileName('plain.txt')).toBe('plain.txt')
  })
})

describe('percent', () => {
  it('stays within 0 to 100', () => {
    expect(percent(50, 200)).toBe(25)
    expect(percent(300, 200)).toBe(100)
    expect(percent(0, 0)).toBe(100)
    expect(percent(-5, 10)).toBe(0)
  })
})

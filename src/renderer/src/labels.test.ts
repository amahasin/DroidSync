import { describe, expect, it } from 'vitest'
import type { Device, DownloadState } from '../../shared/models'
import {
  androidLabel,
  deviceTitle,
  downloadFraction,
  downloadText,
  formatBytes,
  stateLabel
} from './labels'

const device = (overrides: Partial<Device> = {}): Device => ({
  serial: 'R5CT1234ABC',
  state: 'device',
  rawState: 'device',
  connection: 'usb',
  transportId: '1',
  model: null,
  manufacturer: null,
  androidVersion: null,
  sdk: null,
  ...overrides
})

const dl = (overrides: Partial<DownloadState> = {}): DownloadState => ({
  phase: 'idle',
  received: 0,
  total: 0,
  version: null,
  error: null,
  ...overrides
})

describe('deviceTitle', () => {
  it('falls back to the serial', () => {
    expect(deviceTitle(device())).toBe('R5CT1234ABC')
  })

  it('combines manufacturer and model', () => {
    expect(deviceTitle(device({ manufacturer: 'samsung', model: 'SM-G991B' }))).toBe(
      'samsung SM-G991B'
    )
  })

  it('does not repeat the manufacturer when the model already starts with it', () => {
    expect(deviceTitle(device({ manufacturer: 'OnePlus', model: 'OnePlus 9' }))).toBe('OnePlus 9')
  })

  it('uses the model alone when the manufacturer is unknown', () => {
    expect(deviceTitle(device({ model: 'Pixel 7' }))).toBe('Pixel 7')
  })
})

describe('state labels', () => {
  it('tells the person what to do for an unauthorized phone', () => {
    const label = stateLabel('unauthorized')
    expect(label.tone).toBe('warn')
    expect(label.hint).toContain('USB debugging')
  })

  it('has no hint for a ready device', () => {
    expect(stateLabel('device')).toMatchObject({ text: 'Ready', hint: null })
  })
})

describe('androidLabel', () => {
  it('shows version and API level when known', () => {
    expect(androidLabel(device({ androidVersion: '14', sdk: 34 }))).toBe('Android 14 (API 34)')
    expect(androidLabel(device({ androidVersion: '14' }))).toBe('Android 14')
    expect(androidLabel(device())).toBeNull()
  })
})

describe('download helpers', () => {
  it('formats sizes', () => {
    expect(formatBytes(500)).toBe('1 KB')
    expect(formatBytes(2048)).toBe('2 KB')
    expect(formatBytes(11264634)).toBe('10.7 MB')
  })

  it('reports a fraction only when the total is known', () => {
    expect(downloadFraction(dl({ received: 5, total: 10 }))).toBe(0.5)
    expect(downloadFraction(dl({ received: 5, total: 0 }))).toBeNull()
    expect(downloadFraction(dl({ received: 20, total: 10 }))).toBe(1)
  })

  it('describes each phase', () => {
    expect(
      downloadText(
        dl({ phase: 'downloading', version: '5.0.1', received: 1048576, total: 2097152 })
      )
    ).toBe('Downloading scrcpy 5.0.1 — 1.0 MB of 2.0 MB')
    expect(downloadText(dl({ phase: 'error', error: 'Checksum mismatch' }))).toBe(
      'Checksum mismatch'
    )
    expect(downloadText(dl())).toBe('')
  })
})

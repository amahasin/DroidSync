import { describe, expect, it } from 'vitest'
import { isSafeExternalUrl, isTrustedUrl } from './security'

describe('isTrustedUrl', () => {
  it('trusts packaged file: pages', () => {
    expect(isTrustedUrl('file:///C:/app/out/renderer/index.html')).toBe(true)
  })

  it('trusts only the dev server origin in development', () => {
    const dev = 'http://localhost:5173/'
    expect(isTrustedUrl('http://localhost:5173/index.html', dev)).toBe(true)
    expect(isTrustedUrl('http://localhost:9999/', dev)).toBe(false)
    expect(isTrustedUrl('https://evil.example/', dev)).toBe(false)
  })

  it('rejects http origins when no dev server is configured', () => {
    expect(isTrustedUrl('http://localhost:5173/')).toBe(false)
  })

  it('rejects missing and malformed urls', () => {
    expect(isTrustedUrl(undefined)).toBe(false)
    expect(isTrustedUrl('')).toBe(false)
    expect(isTrustedUrl('not a url')).toBe(false)
  })
})

describe('isSafeExternalUrl', () => {
  it('allows https only', () => {
    expect(isSafeExternalUrl('https://github.com/Genymobile/scrcpy')).toBe(true)
    expect(isSafeExternalUrl('http://example.com')).toBe(false)
    expect(isSafeExternalUrl('file:///C:/Windows/System32/cmd.exe')).toBe(false)
    expect(isSafeExternalUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeExternalUrl('nonsense')).toBe(false)
  })
})

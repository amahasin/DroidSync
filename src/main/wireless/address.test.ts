import { describe, expect, it } from 'vitest'
import { isPairingCode, parseAddress } from './address'

describe('parseAddress', () => {
  it('accepts IPv4 with a port, and defaults the port to 5555', () => {
    expect(parseAddress('192.168.1.5:37045')).toEqual({
      host: '192.168.1.5',
      port: 37045,
      address: '192.168.1.5:37045'
    })
    expect(parseAddress(' 192.168.1.5 ')).toEqual({
      host: '192.168.1.5',
      port: 5555,
      address: '192.168.1.5:5555'
    })
  })

  it('accepts host names', () => {
    expect(parseAddress('pixel.local:5555')?.address).toBe('pixel.local:5555')
    expect(parseAddress('my-phone')?.address).toBe('my-phone:5555')
  })

  it('requires a port when asked', () => {
    expect(parseAddress('192.168.1.5', true)).toBeNull()
    expect(parseAddress('192.168.1.5:41234', true)?.port).toBe(41234)
  })

  it.each([
    '',
    '   ',
    '999.1.1.1',
    '1.2.3',
    '1.2.3.4:0',
    '1.2.3.4:65536',
    '1.2.3.4:abc',
    '1.2.3.4:5:6',
    '::1',
    'bad host:5555',
    'a/b:5555',
    '-bad.example:5555',
    '1.2.3.4\n:5555',
    'host:5555;rm',
    42,
    null,
    undefined
  ])('rejects %j', (input) => {
    expect(parseAddress(input)).toBeNull()
  })
})

describe('isPairingCode', () => {
  it('needs exactly six digits', () => {
    expect(isPairingCode('123456')).toBe(true)
    expect(isPairingCode('000000')).toBe(true)
    for (const bad of ['12345', '1234567', '12345a', ' 123456', '', 123456, null]) {
      expect(isPairingCode(bad), String(bad)).toBe(false)
    }
  })
})

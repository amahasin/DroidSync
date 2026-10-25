import { describe, expect, it } from 'vitest'
import {
  AdbProtocolError,
  decodeFrames,
  encodeRequest,
  parseDeviceList,
  parseGetprop,
  readStatus
} from './protocol'

const frame = (text: string): Buffer => encodeRequest(text)

describe('encodeRequest', () => {
  it('prefixes a 4-digit hex length', () => {
    expect(encodeRequest('host:version').toString()).toBe('000chost:version')
  })

  it('counts bytes, not characters', () => {
    expect(encodeRequest('é').toString('utf8').startsWith('0002')).toBe(true)
  })
})

describe('decodeFrames', () => {
  it('decodes several frames in one chunk', () => {
    const { payloads, rest } = decodeFrames(Buffer.concat([frame('abc'), frame(''), frame('de')]))
    expect(payloads).toEqual(['abc', '', 'de'])
    expect(rest.length).toBe(0)
  })

  it('keeps an incomplete trailing frame as rest', () => {
    const full = frame('hello world')
    const { payloads, rest } = decodeFrames(Buffer.concat([frame('one'), full.subarray(0, 8)]))
    expect(payloads).toEqual(['one'])
    expect(rest.length).toBe(8)
  })

  it('keeps a partial length header', () => {
    expect(decodeFrames(Buffer.from('00')).rest.toString()).toBe('00')
  })

  it('throws on a non-hex length', () => {
    expect(() => decodeFrames(Buffer.from('zzzzabc'))).toThrow(AdbProtocolError)
  })
})

describe('readStatus', () => {
  it('waits for four bytes', () => {
    expect(readStatus(Buffer.from('OK')).status).toBe('incomplete')
  })

  it('reads OKAY and returns the remaining bytes', () => {
    const result = readStatus(Buffer.concat([Buffer.from('OKAY'), frame('x')]))
    expect(result.status).toBe('OKAY')
    if (result.status === 'OKAY') expect(result.rest.toString()).toBe('0001x')
  })

  it('reads the message of a FAIL', () => {
    const result = readStatus(Buffer.concat([Buffer.from('FAIL'), frame('device offline')]))
    expect(result).toMatchObject({ status: 'FAIL', message: 'device offline' })
  })

  it('waits for the full FAIL message', () => {
    expect(readStatus(Buffer.concat([Buffer.from('FAIL'), Buffer.from('000')])).status).toBe(
      'incomplete'
    )
  })

  it('rejects an unknown status word', () => {
    expect(() => readStatus(Buffer.from('WHAT'))).toThrow(AdbProtocolError)
  })
})

describe('parseDeviceList', () => {
  it('parses a USB device with fields', () => {
    const text =
      'R5CT1234ABC            device usb:1-2 product:o1sxeea model:SM_G991B device:o1s transport_id:3\n'
    expect(parseDeviceList(text)).toEqual([
      {
        serial: 'R5CT1234ABC',
        state: 'device',
        fields: {
          usb: '1-2',
          product: 'o1sxeea',
          model: 'SM_G991B',
          device: 'o1s',
          transport_id: '3'
        }
      }
    ])
  })

  it('parses several lines, CRLF endings and a TCP device', () => {
    const text =
      '192.168.1.5:5555       device product:a model:Pixel_7 device:b transport_id:1\r\nABC unauthorized transport_id:2\r\n'
    const devices = parseDeviceList(text)
    expect(devices.map((d) => [d.serial, d.state])).toEqual([
      ['192.168.1.5:5555', 'device'],
      ['ABC', 'unauthorized']
    ])
    expect(devices[1].fields['transport_id']).toBe('2')
  })

  it('handles the two-word "no permissions" state', () => {
    const text =
      'XYZ                    no permissions (user is in the plugdev group); see [http://developer.android.com/tools/device.html] usb:1-1 transport_id:4\n'
    const [device] = parseDeviceList(text)
    expect(device.state).toBe('no permissions')
    expect(device.fields['transport_id']).toBe('4')
  })

  it('returns nothing for an empty list', () => {
    expect(parseDeviceList('')).toEqual([])
    expect(parseDeviceList('\n')).toEqual([])
  })
})

describe('parseGetprop', () => {
  it('extracts bracketed pairs and ignores other lines', () => {
    const text =
      '[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]\nnoise\n[empty]: []\n'
    expect(parseGetprop(text)).toEqual({
      'ro.product.model': 'Pixel 7',
      'ro.build.version.release': '14',
      empty: ''
    })
  })
})

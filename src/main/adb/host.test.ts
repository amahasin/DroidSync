import { afterEach, describe, expect, it } from 'vitest'
import { framed, listen, onRequests } from './fakeServer'
import {
  adbHost,
  parseConnectReply,
  parseMdnsServices,
  parsePairReply,
  parseWifiAddress,
  readHostReply
} from './host'

const buf = (text: string): Buffer => Buffer.from(text)

describe('readHostReply', () => {
  it('reads OKAY + message', () => {
    expect(readHostReply(buf('OKAY' + framed('already connected to 1.2.3.4:5555')), false)).toEqual(
      {
        done: true,
        ok: true,
        message: 'already connected to 1.2.3.4:5555'
      }
    )
  })

  it('reads the nested FAIL that host:pair sends after OKAY', () => {
    expect(
      readHostReply(buf('OKAYFAIL' + framed('Failed: Unable to start pairing client.')), false)
    ).toEqual({
      done: true,
      ok: false,
      message: 'Failed: Unable to start pairing client.'
    })
  })

  it('reads a nested OKAY', () => {
    expect(
      readHostReply(buf('OKAYOKAY' + framed('Successfully paired to x')), false)
    ).toMatchObject({
      done: true,
      ok: true,
      message: 'Successfully paired to x'
    })
  })

  it('reads a plain FAIL', () => {
    expect(readHostReply(buf('FAIL' + framed("no such device 'x'")), false)).toEqual({
      done: true,
      ok: false,
      message: "no such device 'x'"
    })
  })

  it('reads an empty message', () => {
    expect(readHostReply(buf('OKAY0000'), false)).toEqual({ done: true, ok: true, message: '' })
  })

  it('waits for more data, but ends an empty reply once the socket closed', () => {
    expect(readHostReply(buf('OKAY'), false)).toEqual({ done: false })
    expect(readHostReply(buf('OKAY00'), false)).toEqual({ done: false })
    expect(readHostReply(buf('OKAY0010abc'), false)).toEqual({ done: false })
    expect(readHostReply(buf('OKAY'), true)).toEqual({ done: true, ok: true, message: '' })
    expect(readHostReply(buf(''), true)).toMatchObject({ done: true, ok: false })
  })
})

describe('parseConnectReply', () => {
  it('recognises both success messages', () => {
    expect(parseConnectReply('connected to 192.168.1.5:5555')).toEqual({
      ok: true,
      address: '192.168.1.5:5555'
    })
    expect(parseConnectReply('already connected to 192.168.1.5:5555\n')).toEqual({
      ok: true,
      address: '192.168.1.5:5555'
    })
  })

  it('treats everything else as a failure with adb’s reason', () => {
    expect(parseConnectReply('cannot connect to 1.2.3.4:5555: No route to host (10065)')).toEqual({
      ok: false,
      error: 'cannot connect to 1.2.3.4:5555: No route to host (10065)'
    })
    expect(parseConnectReply('')).toMatchObject({ ok: false })
  })
})

describe('parsePairReply', () => {
  it('recognises success', () => {
    expect(
      parsePairReply({
        ok: true,
        message: 'Successfully paired to 192.168.1.5:41234 [guid=adb-ABC-xyz]'
      })
    ).toMatchObject({ ok: true })
  })

  it('strips "Failed:" from failures', () => {
    expect(
      parsePairReply({ ok: false, message: 'Failed: Wrong password or connection was dropped.' })
    ).toEqual({
      ok: false,
      error: 'Wrong password or connection was dropped.'
    })
    expect(parsePairReply({ ok: true, message: 'something unexpected' })).toMatchObject({
      ok: false
    })
  })
})

describe('parseMdnsServices', () => {
  it('parses tab-separated services and drops the trailing dot of the type', () => {
    const text =
      'adb-R5CT1234-abcdef\t_adb-tls-connect._tcp.\t192.168.1.5:37045\n' +
      'adb-R5CT1234-abcdef\t_adb-tls-pairing._tcp\t192.168.1.5:41234\r\n'
    expect(parseMdnsServices(text)).toEqual([
      { name: 'adb-R5CT1234-abcdef', type: '_adb-tls-connect._tcp', address: '192.168.1.5:37045' },
      { name: 'adb-R5CT1234-abcdef', type: '_adb-tls-pairing._tcp', address: '192.168.1.5:41234' }
    ])
  })

  it('skips junk lines', () => {
    expect(
      parseMdnsServices('List of discovered mdns services\n\nnot a service\na\tb\tc\n')
    ).toEqual([])
    expect(parseMdnsServices('')).toEqual([])
  })
})

describe('parseWifiAddress', () => {
  it('reads inet from `ip addr show`', () => {
    const out =
      '23: wlan0: <UP> mtu 1500\n    inet 192.168.1.30/24 brd 192.168.1.255 scope global wlan0\n'
    expect(parseWifiAddress(out)).toBe('192.168.1.30')
  })

  it('falls back to a wlan route', () => {
    const out =
      '10.0.2.0/24 dev eth0 src 10.0.2.15\n192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.77\n'
    expect(parseWifiAddress(out)).toBe('192.168.1.77')
  })

  it('ignores loopback and returns null when there is no Wi-Fi address', () => {
    expect(parseWifiAddress('    inet 127.0.0.1/8 scope host lo\n')).toBeNull()
    expect(parseWifiAddress('')).toBeNull()
  })
})

describe('adbHost', () => {
  const cleanup: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn()
  })

  it('sends the service and returns the reply, even when it arrives in pieces', async () => {
    const server = await listen((socket, requests) => {
      onRequests(socket, (payload) => {
        requests.push(payload)
        const reply = 'OKAY' + framed('connected to 192.168.1.5:5555')
        socket.write(reply.slice(0, 6))
        setTimeout(() => socket.end(reply.slice(6)), 10)
      })
    })
    cleanup.push(() => server.close())
    const reply = await adbHost(
      { host: '127.0.0.1', port: server.port },
      'host:connect:192.168.1.5:5555'
    )
    expect(server.requests).toEqual(['host:connect:192.168.1.5:5555'])
    expect(reply).toEqual({ ok: true, message: 'connected to 192.168.1.5:5555' })
  })

  it('times out when the server never answers', async () => {
    const server = await listen(() => {})
    cleanup.push(() => server.close())
    await expect(
      adbHost({ host: '127.0.0.1', port: server.port }, 'host:mdns:services', 50)
    ).rejects.toThrow('did not answer')
  })

  it('refuses services with control characters', async () => {
    await expect(adbHost({ host: '127.0.0.1', port: 1 }, 'host:connect:a\nb')).rejects.toThrow(
      'Invalid'
    )
  })
})

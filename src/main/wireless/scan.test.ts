import net from 'net'
import { afterEach, describe, expect, it } from 'vitest'
import { findAdbPorts, findOpenPorts, speaksAdb } from './scan'

describe('findOpenPorts', () => {
  const servers: net.Server[] = []
  const listen = (): Promise<number> =>
    new Promise((resolve) => {
      const server = net.createServer((socket) => socket.destroy())
      servers.push(server)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
    })
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))))
  })

  it('finds the ports that accept a connection, lowest first', async () => {
    const a = await listen()
    const b = await listen()
    const low = Math.min(a, b) - 20
    const high = Math.max(a, b) + 20
    const found = await findOpenPorts('127.0.0.1', low, high, { timeoutMs: 300 })
    // Other programs on the machine may own ports in this range too; ours must be there, in order.
    expect(found).toEqual(expect.arrayContaining([a, b]))
    expect(found).toEqual([...found].sort((x, y) => x - y))
  })

  it('returns nothing when no port in the range is open', async () => {
    const port = await listen()
    await new Promise((done) => servers.pop()?.close(done))
    expect(await findOpenPorts('127.0.0.1', port, port, { timeoutMs: 300 })).toEqual([])
  })

  it('works with a range smaller than the number of workers', async () => {
    const port = await listen()
    expect(await findOpenPorts('127.0.0.1', port, port, { concurrency: 500 })).toEqual([port])
  })
})

describe('finding adb', () => {
  const servers: net.Server[] = []
  const sockets = new Set<net.Socket>()
  const serve = (onConnection: (socket: net.Socket) => void): Promise<number> =>
    new Promise((resolve) => {
      const server = net.createServer((socket) => {
        sockets.add(socket)
        onConnection(socket)
      })
      servers.push(server)
      server.listen(0, '127.0.0.1', () => resolve((server.address() as net.AddressInfo).port))
    })
  afterEach(async () => {
    for (const socket of sockets) socket.destroy()
    sockets.clear()
    await Promise.all(servers.splice(0).map((s) => new Promise((done) => s.close(done))))
  })

  it('recognises a daemon that answers with STLS, CNXN or AUTH', async () => {
    for (const word of ['STLS', 'CNXN', 'AUTH']) {
      const port = await serve((socket) => {
        socket.once('data', () =>
          socket.write(Buffer.concat([Buffer.from(word), Buffer.alloc(20)]))
        )
      })
      expect(await speaksAdb('127.0.0.1', port, 800)).toBe(true)
    }
  })

  it('sends a well-formed connection request', async () => {
    let received = Buffer.alloc(0)
    const port = await serve((socket) => {
      socket.once('data', (data) => {
        received = data
        socket.destroy()
      })
    })
    await speaksAdb('127.0.0.1', port, 500)
    expect(received.toString('ascii', 0, 4)).toBe('CNXN')
    expect(received.readUInt32LE(12)).toBe(received.length - 24)
    expect(received.readUInt32LE(20)).toBe((received.readUInt32LE(0) ^ 0xffffffff) >>> 0)
  })

  it('rejects ports that are silent, answer with something else, or hang up', async () => {
    const silent = await serve(() => {})
    const web = await serve((socket) => {
      socket.once('data', () => socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'))
    })
    const rude = await serve((socket) => socket.destroy())
    expect(await speaksAdb('127.0.0.1', silent, 400)).toBe(false)
    expect(await speaksAdb('127.0.0.1', web, 400)).toBe(false)
    expect(await speaksAdb('127.0.0.1', rude, 400)).toBe(false)
  })

  it('keeps only the adb ports from the open ones', async () => {
    const adb = await serve((socket) => {
      socket.once('data', () =>
        socket.write(Buffer.concat([Buffer.from('STLS'), Buffer.alloc(20)]))
      )
    })
    const other = await serve((socket) => socket.destroy())
    const low = Math.min(adb, other)
    const high = Math.max(adb, other)
    const found = await findAdbPorts('127.0.0.1', low, high, { timeoutMs: 300 })
    expect(found).toContain(adb)
    expect(found).not.toContain(other)
  })
})

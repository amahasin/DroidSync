import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type net from 'net'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { adbDeviceBytes } from './client'
import { framed, listen, type FakeAdbServer } from './fakeServer'
import { adbPush, syncFrame, syncSend } from './sync'

interface Received {
  transport: string | null
  path: string | null
  data: Buffer
  mtime: number | null
}

/** A fake adb server + device speaking just enough of the sync protocol to receive one file. */
function fakeDevice(
  received: Received,
  options: { failTransport?: string; failSync?: string; refuse?: string } = {}
) {
  return (socket: net.Socket): void => {
    let buffer: Buffer = Buffer.alloc(0)
    let mode: 'host' | 'sync' = 'host'
    const chunks: Buffer[] = []
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      for (;;) {
        if (mode === 'host') {
          if (buffer.length < 4) return
          const length = parseInt(buffer.toString('ascii', 0, 4), 16)
          if (buffer.length < 4 + length) return
          const request = buffer.toString('utf8', 4, 4 + length)
          buffer = buffer.subarray(4 + length)
          if (request.startsWith('host:transport:')) {
            received.transport = request.slice('host:transport:'.length)
            if (options.failTransport) socket.write(`FAIL${framed(options.failTransport)}`)
            else socket.write('OKAY')
          } else if (request === 'sync:') {
            if (options.failSync) socket.write(`FAIL${framed(options.failSync)}`)
            else {
              socket.write('OKAY')
              mode = 'sync'
            }
          }
        } else {
          if (buffer.length < 8) return
          const id = buffer.toString('ascii', 0, 4)
          const length = buffer.readUInt32LE(4)
          if (id === 'DONE') {
            received.mtime = length
            received.data = Buffer.concat(chunks)
            buffer = buffer.subarray(8)
            if (options.refuse) {
              const message = Buffer.from(options.refuse)
              const head = Buffer.alloc(8)
              head.write('FAIL', 0, 'ascii')
              head.writeUInt32LE(message.length, 4)
              socket.write(Buffer.concat([head, message]))
            } else {
              socket.write(Buffer.concat([Buffer.from('OKAY'), Buffer.alloc(4)]))
            }
            continue
          }
          if (id === 'QUIT') {
            buffer = buffer.subarray(8)
            continue
          }
          if (buffer.length < 8 + length) return
          const payload = buffer.subarray(8, 8 + length)
          buffer = buffer.subarray(8 + length)
          if (id === 'SEND') received.path = payload.toString('utf8')
          else if (id === 'DATA') chunks.push(Buffer.from(payload))
        }
      }
    })
  }
}

describe('sync frames', () => {
  it('encodes SEND with a decimal mode', () => {
    const frame = syncSend('/sdcard/a.txt')
    expect(frame.toString('ascii', 0, 4)).toBe('SEND')
    expect(frame.readUInt32LE(4)).toBe(frame.length - 8)
    expect(frame.toString('utf8', 8)).toBe('/sdcard/a.txt,33188')
  })

  it('encodes DONE with the time in the length field', () => {
    const frame = syncFrame('DONE', 1700000000)
    expect(frame.length).toBe(8)
    expect(frame.readUInt32LE(4)).toBe(1700000000)
  })
})

describe('adbPush', () => {
  let server: FakeAdbServer
  let dir: string
  const received: Received = { transport: null, path: null, data: Buffer.alloc(0), mtime: null }

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'sync-test-'))
    Object.assign(received, { transport: null, path: null, data: Buffer.alloc(0), mtime: null })
  })
  afterEach(async () => {
    await server?.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('sends a file larger than one chunk intact and reports progress', async () => {
    const payload = Buffer.alloc(150_000)
    for (let i = 0; i < payload.length; i++) payload[i] = i % 251
    const file = join(dir, 'big.bin')
    writeFileSync(file, payload)
    server = await listen(fakeDevice(received))
    const progress: number[] = []

    await adbPush({
      host: '127.0.0.1',
      port: server.port,
      serial: 'ABC123',
      localPath: file,
      remotePath: '/sdcard/Download/big.bin',
      onProgress: (sent, total) => {
        expect(total).toBe(payload.length)
        progress.push(sent)
      }
    })

    expect(received.transport).toBe('ABC123')
    expect(received.path).toBe('/sdcard/Download/big.bin,33188')
    expect(received.data.equals(payload)).toBe(true)
    expect(received.mtime).toBeGreaterThan(1_600_000_000)
    expect(progress.at(-1)).toBe(payload.length)
  })

  it('sends an empty file', async () => {
    const file = join(dir, 'empty.txt')
    writeFileSync(file, '')
    server = await listen(fakeDevice(received))
    await adbPush({
      host: '127.0.0.1',
      port: server.port,
      serial: 's',
      localPath: file,
      remotePath: '/sdcard/empty.txt'
    })
    expect(received.data.length).toBe(0)
  })

  it('reports the adb server refusing the device', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    server = await listen(fakeDevice(received, { failTransport: "device 'ABC' not found" }))
    await expect(
      adbPush({
        host: '127.0.0.1',
        port: server.port,
        serial: 'ABC',
        localPath: file,
        remotePath: '/sdcard/a.txt'
      })
    ).rejects.toThrow("adb: device 'ABC' not found")
  })

  it('reports the device refusing the file', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    server = await listen(fakeDevice(received, { refuse: 'Read-only file system' }))
    await expect(
      adbPush({
        host: '127.0.0.1',
        port: server.port,
        serial: 's',
        localPath: file,
        remotePath: '/system/a.txt'
      })
    ).rejects.toThrow('The device refused the file: Read-only file system')
  })

  it('rejects directories, missing files and unsafe paths before connecting', async () => {
    const base = { host: '127.0.0.1', port: 1, serial: 's' }
    await expect(adbPush({ ...base, localPath: dir, remotePath: '/sdcard/x' })).rejects.toThrow(
      'Not a regular file'
    )
    await expect(
      adbPush({ ...base, localPath: join(dir, 'nope'), remotePath: '/sdcard/x' })
    ).rejects.toThrow()
    await expect(
      adbPush({ ...base, localPath: join(dir, 'a'), remotePath: '/sdcard/x\ny' })
    ).rejects.toThrow('Invalid device or path')
  })

  it('fails when the connection drops mid-transfer', async () => {
    const file = join(dir, 'a.txt')
    writeFileSync(file, 'x')
    server = await listen((socket) => {
      socket.once('data', () => socket.destroy())
    })
    await expect(
      adbPush({
        host: '127.0.0.1',
        port: server.port,
        serial: 's',
        localPath: file,
        remotePath: '/sdcard/a.txt'
      })
    ).rejects.toThrow()
  })
})

describe('adbDeviceBytes', () => {
  it('returns binary output untouched', async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe])
    const server = await listen((socket) => {
      let stage = 0
      socket.on('data', () => {
        stage++
        if (stage === 1) socket.write('OKAY')
        else {
          socket.write(Buffer.concat([Buffer.from('OKAY'), png]))
          socket.end()
        }
      })
    })
    const out = await adbDeviceBytes({
      host: '127.0.0.1',
      port: server.port,
      serial: 's',
      service: 'exec:screencap -p'
    })
    expect(out.equals(png)).toBe(true)
    await server.close()
  })
})

import net from 'net'
import { createReadStream } from 'fs'
import { stat } from 'fs/promises'
import { AdbProtocolError, encodeRequest } from './protocol'
import type { AdbEndpoint } from './client'

/** Largest piece of a file the sync protocol accepts in one DATA message. */
const CHUNK = 64 * 1024
/** Regular file, rw-r--r--: the mode `adb push` gives a new file. */
const FILE_MODE = 0o100644

export interface PushOptions extends AdbEndpoint {
  serial: string
  localPath: string
  remotePath: string
  /** Called as data goes out, with bytes sent so far and the file size. */
  onProgress?: (sent: number, total: number) => void
  /** The connection fails when nothing moves for this long. Default 30 s. */
  idleTimeoutMs?: number
}

/** Reads from a socket by byte count, rejecting when the connection fails or closes early. */
class Reader {
  private buffer: Buffer = Buffer.alloc(0)
  private wake: (() => void) | null = null
  private failure: Error | null = null
  private closed = false

  constructor(socket: net.Socket) {
    const notify = (): void => {
      const wake = this.wake
      this.wake = null
      wake?.()
    }
    socket.on('data', (data) => {
      this.buffer = Buffer.concat([this.buffer, data])
      notify()
    })
    socket.on('error', (error) => {
      this.failure = error
      notify()
    })
    socket.on('close', () => {
      this.closed = true
      notify()
    })
  }

  async take(count: number): Promise<Buffer> {
    while (this.buffer.length < count) {
      if (this.failure) throw this.failure
      if (this.closed) throw new Error('adb connection closed early')
      await new Promise<void>((resolve) => {
        this.wake = resolve
      })
    }
    const out = this.buffer.subarray(0, count)
    this.buffer = this.buffer.subarray(count)
    return out
  }

  /** The OKAY or FAIL that answers a host request such as `host:transport:` or `sync:`. */
  async hostStatus(): Promise<void> {
    const word = (await this.take(4)).toString('ascii')
    if (word === 'OKAY') return
    if (word !== 'FAIL') throw new AdbProtocolError(`Unexpected adb reply "${word}"`)
    const header = (await this.take(4)).toString('ascii')
    if (!/^[0-9a-fA-F]{4}$/.test(header)) throw new AdbProtocolError('Invalid adb error length')
    const message = (await this.take(parseInt(header, 16))).toString('utf8')
    throw new Error(`adb: ${message}`)
  }
}

const u32 = (value: number): Buffer => {
  const out = Buffer.alloc(4)
  out.writeUInt32LE(value >>> 0)
  return out
}

/** One sync message: a 4-letter id followed by a little-endian length and the payload. */
export function syncFrame(id: 'SEND' | 'DATA' | 'DONE' | 'QUIT', payload: Buffer | number): Buffer {
  if (typeof payload === 'number') return Buffer.concat([Buffer.from(id, 'ascii'), u32(payload)])
  return Buffer.concat([Buffer.from(id, 'ascii'), u32(payload.length), payload])
}

/** The SEND message that starts a file transfer: "path,mode" with the mode in decimal. */
export function syncSend(remotePath: string, mode = FILE_MODE): Buffer {
  return syncFrame('SEND', Buffer.from(`${remotePath},${mode}`, 'utf8'))
}

/**
 * Copies a local file to the device with adb's sync protocol, straight over the adb server socket
 * (no adb.exe). The remote path is written exactly as given; the caller picks a safe one.
 */
export async function adbPush(options: PushOptions): Promise<void> {
  const { host, port, serial, localPath, remotePath, onProgress, idleTimeoutMs = 30000 } = options
  if (/[\r\n\0]/.test(serial) || /[\r\n\0]/.test(remotePath)) {
    throw new AdbProtocolError('Invalid device or path')
  }
  if (Buffer.byteLength(remotePath) > 1024)
    throw new AdbProtocolError('The device path is too long')
  const info = await stat(localPath)
  if (!info.isFile()) throw new Error('Not a regular file')
  if (info.size > 0xffffffff) throw new Error('Files over 4 GB cannot be sent')

  const socket = net.createConnection({ host, port })
  socket.setNoDelay(true)
  socket.setTimeout(idleTimeoutMs, () => socket.destroy(new Error('adb timed out')))
  const reader = new Reader(socket)
  try {
    socket.write(encodeRequest(`host:transport:${serial}`))
    await reader.hostStatus()
    socket.write(encodeRequest('sync:'))
    await reader.hostStatus()

    socket.write(syncSend(remotePath))
    let sent = 0
    for await (const chunk of createReadStream(localPath, { highWaterMark: CHUNK })) {
      if (!socket.write(syncFrame('DATA', chunk as Buffer))) {
        await new Promise<void>((resolve, reject) => {
          const fail = (error: Error): void => reject(error)
          socket.once('error', fail)
          socket.once('drain', () => {
            socket.removeListener('error', fail)
            resolve()
          })
        })
      }
      sent += (chunk as Buffer).length
      onProgress?.(sent, info.size)
    }
    socket.write(syncFrame('DONE', Math.floor(info.mtimeMs / 1000)))

    const reply = await reader.take(8)
    const id = reply.toString('ascii', 0, 4)
    if (id === 'FAIL') {
      const message = (await reader.take(reply.readUInt32LE(4))).toString('utf8')
      throw new Error(`The device refused the file: ${message}`)
    }
    if (id !== 'OKAY') throw new AdbProtocolError(`Unexpected sync reply "${id}"`)
    socket.write(syncFrame('QUIT', 0))
  } finally {
    socket.destroy()
  }
}

import net from 'net'

export interface ScanOptions {
  /** How long to wait for one port before giving up on it. */
  timeoutMs?: number
  /** How many ports are tried at the same time. */
  concurrency?: number
}

/** Tries to open a TCP connection to one port. Resolves true when something accepts it. */
function isOpen(host: string, port: number, timeoutMs: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (open: boolean): void => {
      socket.destroy()
      resolve(open)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('connect', () => done(true))
    socket.once('error', () => done(false))
  })
}

/**
 * Ports in `from..to` on `host` that accept a connection, lowest first.
 *
 * Android's Wireless debugging listens on a random high port that changes every time it is turned
 * on. When mDNS does not work on the network the port cannot be discovered, so this looks for it.
 * It only ever probes the one host a person typed, on a LAN, and the caller then asks adb to
 * connect to what it found.
 */
export async function findOpenPorts(
  host: string,
  from: number,
  to: number,
  options: ScanOptions = {}
): Promise<number[]> {
  const { timeoutMs = 300, concurrency = 1200 } = options
  const found: number[] = []
  let next = from
  const worker = async (): Promise<void> => {
    while (next <= to) {
      const port = next++
      if (await isOpen(host, port, timeoutMs)) found.push(port)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, to - from + 1) }, worker))
  return found.sort((a, b) => a - b)
}

/** The four letters an adb daemon answers a connection request with (TLS pairing, plain, or asking to authenticate). */
const ADB_REPLIES = ['CNXN', 'STLS', 'AUTH']

/** An adb CNXN message: six little-endian words, then the banner. */
function connectionRequest(): Buffer {
  const banner = Buffer.from('host::\0', 'ascii')
  const header = Buffer.alloc(24)
  const command = 0x4e584e43 // "CNXN"
  header.writeUInt32LE(command, 0)
  header.writeUInt32LE(0x01000001, 4) // protocol version
  header.writeUInt32LE(1024 * 1024, 8) // largest message accepted
  header.writeUInt32LE(banner.length, 12)
  header.writeUInt32LE(banner.reduce((sum, byte) => sum + byte, 0) >>> 0, 16)
  header.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20)
  return Buffer.concat([header, banner])
}

/** Does whatever listens on this port answer like an adb daemon? */
export function speaksAdb(host: string, port: number, timeoutMs = 1500): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port })
    const done = (yes: boolean): void => {
      socket.destroy()
      resolve(yes)
    }
    socket.setTimeout(timeoutMs, () => done(false))
    socket.once('error', () => done(false))
    socket.once('close', () => done(false))
    socket.once('connect', () => socket.write(connectionRequest()))
    socket.once('data', (data) => done(ADB_REPLIES.includes(data.toString('ascii', 0, 4))))
  })
}

/** Open ports in the range that answer like adb: the Wireless debugging port, not the pairing port or anything else. */
export async function findAdbPorts(
  host: string,
  from: number,
  to: number,
  options: ScanOptions = {}
): Promise<number[]> {
  const open = await findOpenPorts(host, from, to, options)
  const checks = await Promise.all(open.map((port) => speaksAdb(host, port)))
  return open.filter((_, index) => checks[index])
}

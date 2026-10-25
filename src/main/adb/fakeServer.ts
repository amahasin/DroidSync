import net from 'net'

/** Test helper: a tiny stand-in for the adb server. */
export interface FakeAdbServer {
  port: number
  sockets: Set<net.Socket>
  requests: string[]
  close(): Promise<void>
}

export function listen(
  onConnection: (socket: net.Socket, requests: string[]) => void,
  port = 0
): Promise<FakeAdbServer> {
  return new Promise((resolve, reject) => {
    const sockets = new Set<net.Socket>()
    const requests: string[] = []
    const server = net.createServer((socket) => {
      sockets.add(socket)
      socket.on('close', () => sockets.delete(socket))
      socket.on('error', () => {})
      onConnection(socket, requests)
    })
    server.once('error', reject)
    server.listen(port, '127.0.0.1', () => {
      resolve({
        port: (server.address() as net.AddressInfo).port,
        sockets,
        requests,
        close: () =>
          new Promise<void>((done) => {
            for (const socket of sockets) socket.destroy()
            server.close(() => done())
          })
      })
    })
  })
}

/** Reads length-prefixed requests from a socket and passes each payload to `handler`. */
export function onRequests(socket: net.Socket, handler: (payload: string) => void): void {
  let buffer = Buffer.alloc(0)
  socket.on('data', (data) => {
    buffer = Buffer.concat([buffer, data])
    while (buffer.length >= 4) {
      const length = parseInt(buffer.toString('ascii', 0, 4), 16)
      if (buffer.length < 4 + length) return
      const payload = buffer.toString('utf8', 4, 4 + length)
      buffer = buffer.subarray(4 + length)
      handler(payload)
    }
  })
}

export const framed = (text: string): string => text.length.toString(16).padStart(4, '0') + text

export async function freePort(): Promise<number> {
  const server = await listen(() => {})
  const { port } = server
  await server.close()
  return port
}

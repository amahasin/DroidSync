import net from 'net'
import { AdbProtocolError, encodeRequest, readStatus } from './protocol'

export interface AdbEndpoint {
  host: string
  port: number
}

/** adb server address, honouring ANDROID_ADB_SERVER_PORT like the adb client does. */
export function defaultEndpoint(env: NodeJS.ProcessEnv = process.env): AdbEndpoint {
  const port = Number(env['ANDROID_ADB_SERVER_PORT'])
  return { host: '127.0.0.1', port: Number.isInteger(port) && port > 0 ? port : 5037 }
}

export interface AdbShellOptions extends AdbEndpoint {
  serial: string
  command: string
  timeoutMs?: number
}

export interface AdbDeviceServiceOptions extends AdbEndpoint {
  serial: string
  /** A device service such as `shell:getprop` or `tcpip:5555`. */
  service: string
  timeoutMs?: number
}

/**
 * Runs one shell command on a device by talking to the adb server directly.
 * This avoids spawning adb.exe, so a client/server version mismatch can never make
 * adb kill and restart a server that other tools (Android Studio, scrcpy) are using.
 */
export function adbShell(options: AdbShellOptions): Promise<string> {
  const { command, ...rest } = options
  return adbDeviceService({ ...rest, service: `shell:${command}` })
}

/** Selects a device, starts one service on it and returns everything it sends until it closes. */
export async function adbDeviceService(options: AdbDeviceServiceOptions): Promise<string> {
  return (await adbDeviceBytes(options)).toString('utf8')
}

/** Like adbDeviceService, for services that send binary data such as `exec:screencap -p`. */
export function adbDeviceBytes(options: AdbDeviceServiceOptions): Promise<Buffer> {
  const { host, port, serial, service, timeoutMs = 8000 } = options
  return new Promise((resolve, reject) => {
    if (/[\r\n\0]/.test(service)) {
      reject(new AdbProtocolError('Invalid device service'))
      return
    }
    if (/[\r\n\0]/.test(serial)) {
      reject(new AdbProtocolError('Invalid device serial'))
      return
    }
    const socket = net.createConnection({ host, port })
    const chunks: Buffer[] = []
    let stage: 'transport' | 'shell' | 'output' = 'transport'
    let pending: Buffer = Buffer.alloc(0)
    let settled = false

    const finish = (error: Error | null, output?: Buffer): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(output ?? Buffer.alloc(0))
    }
    const timer = setTimeout(() => finish(new Error('adb shell timed out')), timeoutMs)

    const advance = (): void => {
      while (stage !== 'output') {
        const result = readStatus(pending)
        if (result.status === 'incomplete') return
        if (result.status === 'FAIL') {
          finish(new Error(`adb: ${result.message}`))
          return
        }
        pending = result.rest
        if (stage === 'transport') {
          stage = 'shell'
          socket.write(encodeRequest(service))
        } else {
          stage = 'output'
          chunks.push(pending)
          pending = Buffer.alloc(0)
        }
      }
    }

    socket.on('connect', () => socket.write(encodeRequest(`host:transport:${serial}`)))
    socket.on('data', (data) => {
      try {
        if (stage === 'output') {
          chunks.push(data)
        } else {
          pending = Buffer.concat([pending, data])
          advance()
        }
      } catch (error) {
        finish(error as Error)
      }
    })
    socket.on('error', (error) => finish(error))
    socket.on('close', () => {
      if (stage === 'output') finish(null, Buffer.concat(chunks))
      else finish(new Error('adb connection closed early'))
    })
  })
}

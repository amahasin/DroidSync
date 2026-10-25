import net from 'net'
import type { AdbStatus } from '../../shared/models'
import type { AdbEndpoint } from './client'
import {
  AdbProtocolError,
  decodeFrames,
  encodeRequest,
  parseDeviceList,
  readStatus,
  type RawDevice
} from './protocol'

export interface TrackerOptions extends AdbEndpoint {
  /** Called once when the adb server refuses connections, then the connection is retried. */
  startServer?: () => Promise<void>
  /** Delays between reconnect attempts; the last value repeats. */
  retryDelaysMs?: number[]
}

export interface TrackerListener {
  onDevices(devices: RawDevice[]): void
  onStatus(status: AdbStatus, error: string | null): void
}

/**
 * Keeps a `host:track-devices-l` connection open and reports every device list adb pushes.
 * Reconnects with backoff, and starts the adb server if nothing is listening.
 */
export class DeviceTracker {
  private socket: net.Socket | null = null
  private timer: NodeJS.Timeout | null = null
  private stopped = true
  private attempt = 0
  private serverStartTried = false

  constructor(
    private readonly options: TrackerOptions,
    private readonly listener: TrackerListener
  ) {}

  start(): void {
    if (!this.stopped) return
    this.stopped = false
    this.attempt = 0
    this.serverStartTried = false
    this.listener.onStatus('starting', null)
    this.connect()
  }

  stop(): void {
    this.stopped = true
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.socket?.destroy()
    this.socket = null
  }

  private connect(): void {
    if (this.stopped) return
    const socket = net.createConnection({ host: this.options.host, port: this.options.port })
    this.socket = socket
    let buffer: Buffer = Buffer.alloc(0)
    let handshaken = false
    let lastError: NodeJS.ErrnoException | Error | null = null

    socket.on('connect', () => socket.write(encodeRequest('host:track-devices-l')))

    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      try {
        if (!handshaken) {
          const status = readStatus(buffer)
          if (status.status === 'incomplete') return
          if (status.status === 'FAIL') {
            lastError = new AdbProtocolError(status.message)
            socket.destroy()
            return
          }
          handshaken = true
          this.attempt = 0
          this.serverStartTried = false
          buffer = status.rest
          this.listener.onStatus('connected', null)
        }
        const { payloads, rest } = decodeFrames(buffer)
        buffer = rest
        for (const payload of payloads) this.listener.onDevices(parseDeviceList(payload))
      } catch (error) {
        lastError = error as Error
        socket.destroy()
      }
    })

    socket.on('error', (error) => {
      lastError = error
    })

    socket.on('close', () => {
      if (this.socket === socket) this.socket = null
      if (this.stopped) return
      void this.handleClosed(lastError)
    })
  }

  private async handleClosed(error: NodeJS.ErrnoException | Error | null): Promise<void> {
    const refused = (error as NodeJS.ErrnoException | null)?.code === 'ECONNREFUSED'
    if (refused && this.options.startServer && !this.serverStartTried) {
      this.serverStartTried = true
      this.listener.onStatus('starting', null)
      try {
        await this.options.startServer()
      } catch (startError) {
        if (this.stopped) return
        this.listener.onStatus(
          'unavailable',
          `Could not start adb: ${(startError as Error).message}`
        )
        this.scheduleRetry()
        return
      }
      if (!this.stopped) this.connect()
      return
    }
    this.listener.onStatus(
      'unavailable',
      error ? `adb server not reachable: ${error.message}` : 'adb server closed the connection'
    )
    this.scheduleRetry()
  }

  private scheduleRetry(): void {
    if (this.stopped) return
    const delays = this.options.retryDelaysMs ?? [500, 1000, 2000, 5000]
    const delay = delays[Math.min(this.attempt, delays.length - 1)]
    this.attempt += 1
    this.timer = setTimeout(() => {
      this.timer = null
      this.connect()
    }, delay)
  }
}

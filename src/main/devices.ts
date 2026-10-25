import { execFile } from 'child_process'
import type { Device, DeviceState, DevicesSnapshot, ToolsState } from '../shared/models'
import { adbShell, defaultEndpoint, type AdbEndpoint } from './adb/client'
import { parseGetprop, type RawDevice } from './adb/protocol'
import { DeviceTracker } from './adb/tracker'
import type { ToolManager } from './tools/manager'

const KNOWN_STATES: Record<string, DeviceState> = {
  device: 'device',
  unauthorized: 'unauthorized',
  offline: 'offline',
  authorizing: 'authorizing',
  connecting: 'connecting',
  'no permissions': 'no-permissions',
  recovery: 'recovery',
  sideload: 'sideload',
  bootloader: 'bootloader'
}

interface Props {
  model: string | null
  manufacturer: string | null
  androidVersion: string | null
  sdk: number | null
}

export function toDevice(raw: RawDevice, props: Props | null): Device {
  const model = props?.model || raw.fields['model']?.replace(/_/g, ' ') || null
  return {
    serial: raw.serial,
    state: KNOWN_STATES[raw.state] ?? 'unknown',
    rawState: raw.state,
    connection: raw.fields['usb'] !== undefined ? 'usb' : 'tcpip',
    transportId: raw.fields['transport_id'] ?? null,
    model,
    manufacturer: props?.manufacturer ?? null,
    androidVersion: props?.androidVersion ?? null,
    sdk: props?.sdk ?? null
  }
}

export function propsFromGetprop(output: string): Props {
  const p = parseGetprop(output)
  const sdk = Number(p['ro.build.version.sdk'])
  return {
    model: p['ro.product.model'] || null,
    manufacturer: p['ro.product.manufacturer'] || null,
    androidVersion: p['ro.build.version.release'] || null,
    sdk: Number.isInteger(sdk) && sdk > 0 ? sdk : null
  }
}

function startAdbServer(adbPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      adbPath,
      ['start-server'],
      { windowsHide: true, timeout: 20000 },
      (error, _out, stderr) =>
        error ? reject(new Error(stderr.trim() || error.message)) : resolve()
    )
  })
}

/**
 * Live device list: follows the adb server's device tracking and adds model and
 * Android version for ready devices by asking the device directly.
 */
export class DeviceService {
  private tracker: DeviceTracker | null = null
  /** undefined until the first tool resolution, so "no adb" is still reported once. */
  private adbPath: string | null | undefined = undefined
  private raw: RawDevice[] = []
  private props = new Map<string, Props | null>()
  private inflight = new Set<string>()
  private snapshotValue: DevicesSnapshot = { adb: 'starting', error: null, devices: [] }
  private listeners = new Set<(snapshot: DevicesSnapshot) => void>()
  private unsubscribeTools: (() => void) | null = null

  constructor(
    private readonly tools: ToolManager,
    private readonly endpoint: AdbEndpoint = defaultEndpoint()
  ) {}

  get snapshot(): DevicesSnapshot {
    return this.snapshotValue
  }

  onChange(listener: (snapshot: DevicesSnapshot) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): void {
    this.unsubscribeTools = this.tools.onChange((state) => this.applyTools(state))
    this.applyTools(this.tools.state)
  }

  stop(): void {
    this.unsubscribeTools?.()
    this.unsubscribeTools = null
    this.tracker?.stop()
    this.tracker = null
  }

  private applyTools(state: ToolsState): void {
    const adbPath = state.status.adb?.path ?? null
    if (adbPath === this.adbPath) return
    this.adbPath = adbPath
    this.tracker?.stop()
    this.tracker = null
    this.raw = []
    this.props.clear()

    if (!adbPath) {
      this.publish({ adb: 'unavailable', error: 'adb was not found.', devices: [] })
      return
    }
    this.tracker = new DeviceTracker(
      { ...this.endpoint, startServer: () => startAdbServer(adbPath) },
      {
        onDevices: (devices) => {
          this.raw = devices
          this.rebuild()
          this.enrich()
        },
        onStatus: (adb, error) => {
          // A lost server means any list we hold is stale.
          if (adb !== 'connected') this.raw = []
          this.publish({ adb, error, devices: this.build() })
        }
      }
    )
    this.tracker.start()
  }

  private keyOf(raw: RawDevice): string {
    return `${raw.serial}|${raw.state}|${raw.fields['transport_id'] ?? ''}`
  }

  private build(): Device[] {
    return this.raw.map((raw) => toDevice(raw, this.props.get(this.keyOf(raw)) ?? null))
  }

  private rebuild(): void {
    const current = new Set(this.raw.map((raw) => this.keyOf(raw)))
    for (const key of this.props.keys()) if (!current.has(key)) this.props.delete(key)
    this.publish({ ...this.snapshotValue, devices: this.build() })
  }

  private enrich(): void {
    for (const raw of this.raw) {
      const key = this.keyOf(raw)
      if (raw.state !== 'device' || this.props.has(key) || this.inflight.has(key)) continue
      this.inflight.add(key)
      adbShell({ ...this.endpoint, serial: raw.serial, command: 'getprop' })
        .then((output) => propsFromGetprop(output))
        .catch(() => null)
        .then((props) => {
          this.inflight.delete(key)
          // Ignore results for devices that are gone or changed state meanwhile.
          if (!this.raw.some((r) => this.keyOf(r) === key)) return
          this.props.set(key, props)
          this.publish({ ...this.snapshotValue, devices: this.build() })
        })
    }
  }

  private publish(snapshot: DevicesSnapshot): void {
    this.snapshotValue = snapshot
    for (const listener of this.listeners) listener(snapshot)
  }
}

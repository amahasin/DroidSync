import type {
  ActionResult,
  DevicesSnapshot,
  MdnsService,
  SettingsState,
  WirelessResult,
  WirelessState
} from '../../shared/models'
import type { MdnsEntry } from '../adb/host'
import { parseWifiAddress } from '../adb/host'
import { DEFAULT_ADB_PORT, isPairingCode, parseAddress } from './address'
import type { WirelessAdb } from './ops'
import { AutoReconnector } from './reconnect'

export interface WirelessDeps {
  adb: WirelessAdb
  settings: {
    snapshot: SettingsState
    rememberDevice(address: string, name?: string): ActionResult
    forgetDevice(address: string): ActionResult
    moveRememberedDevice(from: string, to: string): ActionResult
    setAutoReconnect(enabled: boolean): ActionResult
  }
  devices: { snapshot: DevicesSnapshot }
  delay?: (ms: number) => Promise<void>
  now?: () => number
  /** Pause between mDNS polls while the Wireless tab is open. */
  pollGapMs?: number
  /** Time for adbd to restart after `tcpip`, between connection attempts. */
  restartWaitMs?: number
}

const TLS_PAIRING = '_adb-tls-pairing._tcp'
const TLS_CONNECT = '_adb-tls-connect._tcp'
/** Older, unauthenticated service some devices still announce. */
const PLAIN_ADB = '_adb._tcp'

/** Wireless debugging listens on a random port from Linux’s ephemeral range, new each time it is turned on. */
const WD_PORT_FROM = 32768
const WD_PORT_TO = 60999
/** Open ports tried with adb connect when looking for the Wireless debugging port. */
const MAX_CANDIDATES = 6

const ipOf = (address: string): string => address.slice(0, address.lastIndexOf(':'))

/**
 * Wireless features: connect by address, pair with a code, switch a USB device to Wi-Fi, find
 * devices on the network, and keep remembered devices connected.
 */
export class WirelessService {
  private mdns: WirelessState['mdns'] = 'unknown'
  private mdnsError: string | null = null
  private entries: MdnsEntry[] = []
  private paused = new Set<string>()
  private attempting = new Set<string>()
  private watchers = 0
  private polling = false
  private lastEmitted = ''
  private listeners = new Set<(state: WirelessState) => void>()
  private reconnector: AutoReconnector

  constructor(private readonly deps: WirelessDeps) {
    this.reconnector = new AutoReconnector({
      enabled: () => deps.settings.snapshot.autoReconnect,
      adbReady: () => deps.devices.snapshot.adb === 'connected',
      candidates: () => deps.settings.snapshot.wireless.map((d) => d.address),
      isConnected: (address) => this.isConnected(address),
      isPaused: (address) => this.paused.has(address),
      attempt: (address) => this.reconnect(address),
      now: deps.now ?? Date.now
    })
  }

  start(): void {
    this.reconnector.start()
  }

  stop(): void {
    this.reconnector.stop()
    this.watchers = 0
  }

  get state(): WirelessState {
    return {
      mdns: this.mdns,
      mdnsError: this.mdnsError,
      pairing: this.services('pairing'),
      connectable: this.services('connect').filter((s) => !this.isListed(s)),
      paused: [...this.paused],
      attempting: [...this.attempting]
    }
  }

  onChange(listener: (state: WirelessState) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  /** Called whenever the device list changes: refreshes the state and remembered names. */
  devicesChanged(): void {
    for (const remembered of this.deps.settings.snapshot.wireless) {
      const model = this.deps.devices.snapshot.devices.find(
        (d) => d.serial === remembered.address && d.state === 'device'
      )?.model
      if (model && model !== remembered.name)
        this.deps.settings.rememberDevice(remembered.address, model)
    }
    this.emit()
  }

  /** The Wireless tab is open: poll for nearby devices until the returned function is called. */
  watch(): () => void {
    this.watchers += 1
    void this.poll()
    let released = false
    return () => {
      if (released) return
      released = true
      this.watchers = Math.max(0, this.watchers - 1)
    }
  }

  // ── actions ─────────────────────────────────────────────────────────────

  async connect(input: unknown): Promise<WirelessResult> {
    const parsed = parseAddress(input)
    if (!parsed)
      return { ok: false, error: 'Enter an IP address, like 192.168.1.20 or 192.168.1.20:5555.' }
    const first = await this.connectAndRemember(parsed.host, parsed.port)
    // Just an IP address, refused on 5555: the phone may be using Wireless debugging instead.
    // A timeout means nothing is there to answer (off, or another network), so do not search.
    const typedPort = typeof input === 'string' && input.includes(':')
    if (first.ok || typedPort || !/refused|10061/i.test(first.error)) return first
    const found = await this.findAndConnect(parsed.host)
    if (found.ok) return found
    return {
      ok: false,
      error: `${first.error.replace(/[.s]+$/, '')}. If the phone uses Wireless debugging, type the IP address and port shown on its Wireless debugging screen.`
    }
  }

  /**
   * Looks for the port Wireless debugging listens on and connects to it. Used when mDNS cannot
   * announce it: the phone's address is known, the port is not. Only already-paired computers can
   * connect, so a wrong guess just fails.
   */
  private async findAndConnect(host: string, remember = true): Promise<WirelessResult> {
    let ports: number[]
    try {
      ports = await this.deps.adb.findAdbPorts(host, WD_PORT_FROM, WD_PORT_TO)
    } catch (error) {
      return { ok: false, error: errorText(error) }
    }
    let last = 'No adb port was found on that device.'
    for (const port of ports.slice(0, MAX_CANDIDATES)) {
      // A device that is already remembered under its old port is moved, not added again.
      const outcome = remember ? undefined : await this.deps.adb.connect(host, port)
      const connected: WirelessResult = outcome
        ? outcome.ok
          ? { ok: true, message: `Connected to ${outcome.address}.`, address: outcome.address }
          : { ok: false, error: outcome.error }
        : await this.connectAndRemember(host, port)
      if (connected.ok) return connected
      last = connected.error
    }
    return { ok: false, error: last }
  }

  async pair(addressInput: unknown, code: unknown): Promise<WirelessResult> {
    const parsed = parseAddress(addressInput, true)
    if (!parsed) {
      return {
        ok: false,
        error: 'Enter the pairing address with its port, like 192.168.1.20:41234.'
      }
    }
    if (!isPairingCode(code)) return { ok: false, error: 'The pairing code is six digits.' }

    const paired = await this.deps.adb.pair(parsed.address, code)
    if (!paired.ok) return { ok: false, error: paired.error }

    // The device now announces a separate connect port. Find it and connect, so one step finishes the job.
    await (this.deps.delay ?? sleep)(1500)
    const listed = await this.deps.adb.mdnsServices()
    const entry = listed.ok
      ? listed.entries.find(
          (e) => (e.type === TLS_CONNECT || e.type === PLAIN_ADB) && ipOf(e.address) === parsed.host
        )
      : undefined
    if (!entry) {
      // No mDNS on this network: look for the connect port directly.
      const found = await this.findAndConnect(parsed.host)
      if (found.ok) {
        return {
          ok: true,
          message: `Paired and connected to ${found.address}.`,
          address: found.address
        }
      }
      return {
        ok: true,
        warning: true,
        message:
          'Paired, but not connected yet. Type the phone’s IP address and the port shown on its main Wireless debugging screen (not the pairing one) into Connect by address.'
      }
    }
    const connected = await this.connectAndRemember(
      parsed.host,
      Number(entry.address.split(':').pop())
    )
    return connected.ok
      ? {
          ok: true,
          message: `Paired and connected to ${connected.address}.`,
          address: connected.address
        }
      : {
          ok: true,
          warning: true,
          message: `Paired, but connecting failed: ${connected.error}`
        }
  }

  async disconnect(serial: unknown): Promise<WirelessResult> {
    if (typeof serial !== 'string' || serial === '') return { ok: false, error: 'Invalid device.' }
    const device = this.deps.devices.snapshot.devices.find((d) => d.serial === serial)
    if (device?.connection === 'usb') {
      return { ok: false, error: 'This device is connected by cable. Unplug it instead.' }
    }
    const result = await this.deps.adb.disconnect(serial)
    // Do not let auto-reconnect fight a deliberate disconnect.
    if (this.deps.settings.snapshot.wireless.some((d) => d.address === serial)) {
      this.paused.add(serial)
    }
    this.emit()
    return result.ok
      ? { ok: true, message: `Disconnected ${serial}.` }
      : { ok: false, error: result.message || 'Could not disconnect.' }
  }

  /**
   * Switches a USB device to wireless: reads its Wi-Fi address, restarts adbd in TCP mode on
   * port 5555, then connects to it. The cable can be unplugged afterwards.
   */
  async enableWifi(serial: unknown): Promise<WirelessResult> {
    if (typeof serial !== 'string' || serial === '') return { ok: false, error: 'Invalid device.' }
    const device = this.deps.devices.snapshot.devices.find((d) => d.serial === serial)
    if (!device) return { ok: false, error: 'That device is not connected any more.' }
    if (device.state !== 'device') return { ok: false, error: 'The device is not ready.' }
    if (device.connection !== 'usb') return { ok: false, error: 'This device is already wireless.' }

    const { adb } = this.deps
    let ip: string | null
    try {
      ip = parseWifiAddress(await adb.shell(serial, 'ip -f inet addr show wlan0'))
      ip ??= parseWifiAddress(await adb.shell(serial, 'ip route'))
    } catch (error) {
      return { ok: false, error: `Could not read the device’s Wi-Fi address: ${errorText(error)}` }
    }
    if (!ip) {
      return {
        ok: false,
        error:
          'The device has no Wi-Fi address. Connect it to the same Wi-Fi network as this computer first.'
      }
    }

    try {
      const said = await adb.tcpip(serial, DEFAULT_ADB_PORT)
      if (!/restarting in TCP mode/i.test(said)) {
        return { ok: false, error: said.trim() || 'The device did not switch to wireless mode.' }
      }
    } catch (error) {
      return { ok: false, error: `Could not switch to wireless mode: ${errorText(error)}` }
    }

    // adbd needs a moment to restart before it accepts connections.
    const wait = this.deps.restartWaitMs ?? 1000
    let last = 'The device did not accept the connection.'
    for (let attempt = 0; attempt < 8; attempt++) {
      await (this.deps.delay ?? sleep)(wait)
      const connected = await this.connectAndRemember(ip, DEFAULT_ADB_PORT, device.model)
      if (connected.ok) {
        return {
          ok: true,
          message: `Connected to ${connected.address}. You can unplug the cable.`,
          address: connected.address
        }
      }
      last = connected.error
    }
    return {
      ok: false,
      error: `${last} Make sure this computer and the device are on the same Wi-Fi network.`
    }
  }

  forget(address: unknown): ActionResult {
    if (typeof address !== 'string') return { ok: false, error: 'Invalid address.' }
    this.paused.delete(address)
    this.reconnector.reset(address)
    const result = this.deps.settings.forgetDevice(address)
    this.emit()
    return result
  }

  /** "Reconnect now": also lifts a pause from an earlier deliberate disconnect. */
  async reconnectNow(address: unknown): Promise<WirelessResult> {
    if (typeof address !== 'string') return { ok: false, error: 'Invalid address.' }
    const remembered = this.deps.settings.snapshot.wireless.some((d) => d.address === address)
    if (!remembered) return { ok: false, error: 'That device is not remembered.' }
    this.paused.delete(address)
    this.reconnector.reset(address)
    const connected = await this.reconnect(address, true)
    return connected
      ? { ok: true, message: `Connected to ${address}.`, address }
      : { ok: false, error: 'Could not reach the device. Check that it is on and on this network.' }
  }

  setAutoReconnect(enabled: unknown): ActionResult {
    return this.deps.settings.setAutoReconnect(enabled === true)
  }

  // ── internals ───────────────────────────────────────────────────────────

  private isConnected(address: string): boolean {
    return this.deps.devices.snapshot.devices.some(
      (d) => d.serial === address && d.state !== 'offline' && d.state !== 'connecting'
    )
  }

  private isListed(service: MdnsService): boolean {
    return this.deps.devices.snapshot.devices.some(
      (d) => d.serial === service.address || d.serial.startsWith(service.name)
    )
  }

  private services(kind: MdnsService['kind']): MdnsService[] {
    const types = kind === 'pairing' ? [TLS_PAIRING] : [TLS_CONNECT, PLAIN_ADB]
    return this.entries
      .filter((e) => types.includes(e.type))
      .map((e) => ({ name: e.name, address: e.address, kind }))
  }

  private async connectAndRemember(
    host: string,
    port: number,
    knownName?: string | null
  ): Promise<WirelessResult> {
    const outcome = await this.deps.adb.connect(host, port)
    if (!outcome.ok) return { ok: false, error: outcome.error }
    const address = outcome.address
    this.paused.delete(address)
    const name =
      knownName ??
      this.deps.devices.snapshot.devices.find((d) => d.serial === address)?.model ??
      undefined
    this.deps.settings.rememberDevice(address, name)
    this.emit()
    return { ok: true, message: `Connected to ${address}.`, address }
  }

  /**
   * One reconnect attempt for a remembered device. If its port has changed (Wireless debugging
   * picks a new one each time) and the device announces itself, follow it to the new address.
   */
  private async reconnect(address: string, scan = false): Promise<boolean> {
    this.attempting.add(address)
    this.emit()
    try {
      const parsed = parseAddress(address, true)
      if (!parsed) return false
      let outcome = await this.deps.adb.connect(parsed.host, parsed.port)
      if (!outcome.ok) {
        const moved = await this.findMovedPort(parsed.host, address)
        if (moved) {
          outcome = await this.deps.adb.connect(parsed.host, moved)
          if (outcome.ok) this.deps.settings.moveRememberedDevice(address, outcome.address)
        } else if (scan) {
          // Only when the person asked for it: scanning is too heavy for the background retries.
          const found = await this.findAndConnect(parsed.host, false)
          if (found.ok && found.address) {
            this.deps.settings.moveRememberedDevice(address, found.address)
            outcome = { ok: true, address: found.address }
          }
        }
      }
      return outcome.ok
    } finally {
      this.attempting.delete(address)
      this.emit()
    }
  }

  private async findMovedPort(host: string, current: string): Promise<number | null> {
    const listed = await this.deps.adb.mdnsServices()
    if (!listed.ok) return null
    const match = listed.entries.find(
      (e) =>
        (e.type === TLS_CONNECT || e.type === PLAIN_ADB) &&
        ipOf(e.address) === host &&
        e.address !== current
    )
    return match ? Number(match.address.split(':').pop()) : null
  }

  /** Polls mDNS one request at a time while someone is looking at the Wireless tab. */
  private async poll(): Promise<void> {
    if (this.polling) return
    this.polling = true
    try {
      while (this.watchers > 0) {
        const result = await this.deps.adb.mdnsServices()
        if (result.ok) {
          this.mdns = 'available'
          this.mdnsError = null
          this.entries = result.entries
        } else {
          // "unavailable" only when adb said so; a slow or silent answer proves nothing.
          this.mdns = /did not answer/i.test(result.error) ? 'unknown' : 'unavailable'
          this.mdnsError = result.error
          this.entries = []
        }
        this.emit()
        await (this.deps.delay ?? sleep)(this.deps.pollGapMs ?? 2000)
      }
    } finally {
      this.polling = false
    }
  }

  private emit(): void {
    const state = this.state
    const key = JSON.stringify(state)
    if (key === this.lastEmitted) return
    this.lastEmitted = key
    for (const listener of this.listeners) listener(state)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

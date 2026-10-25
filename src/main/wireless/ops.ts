import { adbDeviceService, adbShell, type AdbEndpoint } from '../adb/client'
import {
  adbHost,
  parseConnectReply,
  parseMdnsServices,
  parsePairReply,
  type ConnectOutcome,
  type MdnsEntry,
  type PairOutcome
} from '../adb/host'

import { findAdbPorts } from './scan'

/** The adb operations wireless features need, so the logic on top can be tested with a fake. */
export interface WirelessAdb {
  connect(host: string, port: number): Promise<ConnectOutcome>
  pair(address: string, code: string): Promise<PairOutcome>
  disconnect(serial: string): Promise<{ ok: boolean; message: string }>
  mdnsServices(): Promise<{ ok: true; entries: MdnsEntry[] } | { ok: false; error: string }>
  shell(serial: string, command: string): Promise<string>
  /** Restart the device's adbd listening on a TCP port. Resolves with what the device said. */
  tcpip(serial: string, port: number): Promise<string>
  /** Ports on a host that accept connections, for finding Wireless debugging's random port. */
  findAdbPorts(host: string, from: number, to: number): Promise<number[]>
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Wireless operations over the adb server's own protocol (no adb.exe is started). */
export function createWirelessAdb(endpoint: AdbEndpoint): WirelessAdb {
  return {
    async connect(host, port) {
      try {
        // adb waits for the TCP connection itself, which can take a while for an unreachable host.
        const reply = await adbHost(endpoint, `host:connect:${host}:${port}`, 15000)
        return reply.ok
          ? parseConnectReply(reply.message)
          : { ok: false, error: reply.message || 'adb did not connect.' }
      } catch (error) {
        return { ok: false, error: message(error) }
      }
    },

    async pair(address, code) {
      try {
        return parsePairReply(await adbHost(endpoint, `host:pair:${code}:${address}`, 20000))
      } catch (error) {
        return { ok: false, error: message(error) }
      }
    },

    async disconnect(serial) {
      try {
        const reply = await adbHost(endpoint, `host:disconnect:${serial}`, 8000)
        return { ok: reply.ok, message: reply.message }
      } catch (error) {
        return { ok: false, message: message(error) }
      }
    },

    async mdnsServices() {
      try {
        const reply = await adbHost(endpoint, 'host:mdns:services', 10000)
        if (!reply.ok) return { ok: false, error: reply.message || 'mDNS is not available.' }
        return { ok: true, entries: parseMdnsServices(reply.message) }
      } catch (error) {
        return { ok: false, error: message(error) }
      }
    },

    shell: (serial, command) => adbShell({ ...endpoint, serial, command }),

    tcpip: (serial, port) =>
      adbDeviceService({ ...endpoint, serial, service: `tcpip:${port}`, timeoutMs: 8000 }),

    findAdbPorts: (host, from, to) => findAdbPorts(host, from, to)
  }
}

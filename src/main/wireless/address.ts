/** Validation for addresses and codes typed by a person, before they go into an adb service string. */

export interface ParsedAddress {
  host: string
  port: number
  /** host:port */
  address: string
}

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/
const HOSTNAME =
  /^(?=.{1,253}$)[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)*$/

export const DEFAULT_ADB_PORT = 5555

function validHost(host: string): boolean {
  const ip = IPV4.exec(host)
  if (ip) return ip.slice(1).every((part) => Number(part) <= 255)
  // A host name that looks like an IP with a bad octet (999.1.1.1) is not a valid name either.
  return !/^[\d.]+$/.test(host) && HOSTNAME.test(host)
}

/**
 * Accepts `host` or `host:port` where host is an IPv4 address or a host name.
 * The port defaults to 5555 unless `requirePort` is set (pairing always needs one).
 */
export function parseAddress(text: unknown, requirePort = false): ParsedAddress | null {
  if (typeof text !== 'string') return null
  const trimmed = text.trim()
  const parts = trimmed.split(':')
  if (parts.length > 2) return null
  const [host, portText] = parts
  if (!validHost(host)) return null
  if (portText === undefined) {
    if (requirePort) return null
    return { host, port: DEFAULT_ADB_PORT, address: `${host}:${DEFAULT_ADB_PORT}` }
  }
  if (!/^\d{1,5}$/.test(portText)) return null
  const port = Number(portText)
  if (port < 1 || port > 65535) return null
  return { host, port, address: `${host}:${port}` }
}

/** The six digits shown on the phone's pairing screen. */
export function isPairingCode(text: unknown): text is string {
  return typeof text === 'string' && /^\d{6}$/.test(text)
}

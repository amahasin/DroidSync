import net from 'net'
import type { AdbEndpoint } from './client'
import { AdbProtocolError, decodeFrames, encodeRequest, readStatus } from './protocol'

export interface HostReply {
  /** False when the server answered FAIL. A connect that did not connect is still ok: read `message`. */
  ok: boolean
  message: string
}

export type HostRead = { done: false } | ({ done: true } & HostReply)

/**
 * Reads the answer to a `host:` service.
 *
 * Most answer `OKAY` + a length-prefixed message. `host:pair` answers `OKAY` and then a second
 * `OKAY`/`FAIL` before the message, so a status word right after the first one is treated as
 * the real outcome. `closed` tells us nothing more is coming, which ends an empty answer.
 */
export function readHostReply(buffer: Buffer, closed: boolean): HostRead {
  const first = readStatus(buffer)
  if (first.status === 'incomplete')
    return closed ? { done: true, ok: false, message: '' } : { done: false }
  if (first.status === 'FAIL') return { done: true, ok: false, message: first.message }

  let ok = true
  let rest = first.rest
  const word = rest.length >= 4 ? rest.toString('ascii', 0, 4) : ''
  if (word === 'OKAY' || word === 'FAIL') {
    const nested = readStatus(rest)
    if (nested.status === 'incomplete')
      return closed ? { done: true, ok: false, message: '' } : { done: false }
    if (nested.status === 'FAIL') return { done: true, ok: false, message: nested.message }
    ok = true
    rest = nested.rest
  }

  const { payloads } = decodeFrames(rest)
  if (payloads.length > 0) return { done: true, ok, message: payloads[0] }
  return closed ? { done: true, ok, message: '' } : { done: false }
}

const SAFE_SERVICE = /^[\x20-\x7e]+$/

/**
 * Sends one `host:` service to the adb server and returns its answer.
 * Talking to the server directly avoids spawning adb.exe, so a client/server version mismatch
 * can never make adb kill and restart a server other tools are using.
 */
export function adbHost(
  endpoint: AdbEndpoint,
  service: string,
  timeoutMs = 10000
): Promise<HostReply> {
  return new Promise((resolve, reject) => {
    if (!SAFE_SERVICE.test(service)) {
      reject(new AdbProtocolError('Invalid adb service'))
      return
    }
    const socket = net.createConnection(endpoint)
    let buffer: Buffer = Buffer.alloc(0)
    let settled = false

    const finish = (error: Error | null, reply?: HostReply): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.destroy()
      if (error) reject(error)
      else resolve(reply as HostReply)
    }
    const timer = setTimeout(() => finish(new Error('adb did not answer in time')), timeoutMs)

    const check = (closed: boolean): void => {
      try {
        const result = readHostReply(buffer, closed)
        if (result.done) finish(null, { ok: result.ok, message: result.message })
      } catch (error) {
        finish(error as Error)
      }
    }

    socket.on('connect', () => socket.write(encodeRequest(service)))
    socket.on('data', (data) => {
      buffer = Buffer.concat([buffer, data])
      check(false)
    })
    socket.on('error', (error) => finish(error))
    socket.on('close', () => check(true))
  })
}

// ── Parsers ───────────────────────────────────────────────────────────────

export type ConnectOutcome = { ok: true; address: string } | { ok: false; error: string }

/** `connected to 1.2.3.4:5555`, `already connected to …`, or `cannot connect to …: reason`. */
export function parseConnectReply(message: string): ConnectOutcome {
  const text = message.trim()
  const match = /^(?:already connected|connected) to (\S+)$/i.exec(text)
  if (match) return { ok: true, address: match[1] }
  return { ok: false, error: text || 'adb did not connect.' }
}

export type PairOutcome = { ok: true; message: string } | { ok: false; error: string }

export function parsePairReply(reply: HostReply): PairOutcome {
  const text = reply.message.trim()
  if (reply.ok && /^successfully paired/i.test(text)) return { ok: true, message: text }
  return { ok: false, error: text.replace(/^failed:\s*/i, '') || 'Pairing failed.' }
}

export interface MdnsEntry {
  /** Service instance name, like adb-ABC123-xyz. */
  name: string
  /** Service type without the trailing dot, like _adb-tls-connect._tcp. */
  type: string
  /** ip:port */
  address: string
}

/** `host:mdns:services` lines: `<instance>\t<type>\t<ip>:<port>`. Unrecognised lines are skipped. */
export function parseMdnsServices(text: string): MdnsEntry[] {
  const entries: MdnsEntry[] = []
  for (const line of text.split(/\r?\n/)) {
    const parts = line.trim().split(/\t+|\s{2,}/)
    if (parts.length < 3) continue
    const [name, type, address] = parts
    if (!/^[\w.-]+$/.test(name) || !type.startsWith('_')) continue
    if (!/^[\w.:[\]-]+:\d{1,5}$/.test(address)) continue
    entries.push({ name, type: type.replace(/\.$/, ''), address })
  }
  return entries
}

/** The device's Wi-Fi IPv4 address from `ip -f inet addr show wlan0` or `ip route` output. */
export function parseWifiAddress(output: string): string | null {
  const inet = /inet (\d{1,3}(?:\.\d{1,3}){3})\/\d+/.exec(output)
  if (inet && !inet[1].startsWith('127.')) return inet[1]
  for (const line of output.split(/\r?\n/)) {
    if (!/\bwlan\d/.test(line)) continue
    const src = /\bsrc (\d{1,3}(?:\.\d{1,3}){3})/.exec(line)
    if (src) return src[1]
  }
  return null
}

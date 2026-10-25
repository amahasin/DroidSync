/**
 * Pure helpers for the adb server wire protocol and its text outputs.
 * Requests are a 4-digit hex length followed by the payload; replies start with OKAY or FAIL.
 */

export interface RawDevice {
  serial: string
  /** State as adb printed it, e.g. "device" or "no permissions". */
  state: string
  /** key:value fields from `devices -l`, e.g. usb, product, model, device, transport_id. */
  fields: Record<string, string>
}

export function encodeRequest(payload: string): Buffer {
  const body = Buffer.from(payload, 'utf8')
  if (body.length > 0xffff) throw new Error('adb request too long')
  return Buffer.concat([Buffer.from(body.length.toString(16).padStart(4, '0'), 'ascii'), body])
}

export class AdbProtocolError extends Error {}

export interface DecodedFrames {
  payloads: string[]
  /** Bytes of an incomplete trailing frame, to prepend to the next chunk. */
  rest: Buffer
}

/** Splits a buffer into length-prefixed frames. Throws AdbProtocolError on a bad length. */
export function decodeFrames(buffer: Buffer): DecodedFrames {
  const payloads: string[] = []
  let offset = 0
  while (buffer.length - offset >= 4) {
    const header = buffer.toString('ascii', offset, offset + 4)
    if (!/^[0-9a-fA-F]{4}$/.test(header)) {
      throw new AdbProtocolError(`Invalid frame length "${header}"`)
    }
    const length = parseInt(header, 16)
    if (buffer.length - offset - 4 < length) break
    payloads.push(buffer.toString('utf8', offset + 4, offset + 4 + length))
    offset += 4 + length
  }
  return { payloads, rest: buffer.subarray(offset) }
}

export type StatusRead =
  | { status: 'incomplete' }
  | { status: 'OKAY'; rest: Buffer }
  | { status: 'FAIL'; message: string; rest: Buffer }

/** Reads the OKAY/FAIL prefix of a reply. A FAIL carries a framed error message. */
export function readStatus(buffer: Buffer): StatusRead {
  if (buffer.length < 4) return { status: 'incomplete' }
  const word = buffer.toString('ascii', 0, 4)
  if (word === 'OKAY') return { status: 'OKAY', rest: buffer.subarray(4) }
  if (word === 'FAIL') {
    const { payloads, rest } = decodeFrames(buffer.subarray(4))
    if (payloads.length === 0) return { status: 'incomplete' }
    return { status: 'FAIL', message: payloads[0], rest }
  }
  throw new AdbProtocolError(`Unexpected adb reply "${word}"`)
}

/**
 * Parses `host:devices-l` / `host:track-devices-l` output.
 * Lines look like: `R5CT1234ABC    device usb:1-2 product:x model:SM_G991B device:y transport_id:3`
 */
export function parseDeviceList(text: string): RawDevice[] {
  const devices: RawDevice[] = []
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed) continue
    const match = /^(\S+)\s+(no permissions|\S+)(.*)$/.exec(trimmed)
    if (!match) continue
    const [, serial, state, rest] = match
    const fields: Record<string, string> = {}
    for (const token of rest.trim().split(/\s+/)) {
      const colon = token.indexOf(':')
      if (colon > 0) fields[token.slice(0, colon)] = token.slice(colon + 1)
    }
    devices.push({ serial, state, fields })
  }
  return devices
}

/** Parses `getprop` output: `[ro.product.model]: [Pixel 7]`. */
export function parseGetprop(text: string): Record<string, string> {
  const props: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const match = /^\[([^\]]+)\]: \[(.*)\]$/.exec(line.trim())
    if (match) props[match[1]] = match[2]
  }
  return props
}

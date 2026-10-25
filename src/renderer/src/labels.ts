import type { Device, DeviceState, DownloadState, SessionInfo } from '../../shared/models'

export type Tone = 'ok' | 'warn' | 'bad' | 'neutral'

export interface StateLabel {
  text: string
  tone: Tone
  /** What the person should do, when there is something to do. */
  hint: string | null
}

const STATES: Record<DeviceState, StateLabel> = {
  device: { text: 'Ready', tone: 'ok', hint: null },
  unauthorized: {
    text: 'Unauthorized',
    tone: 'warn',
    hint: 'Unlock the phone and accept the “Allow USB debugging?” prompt.'
  },
  authorizing: { text: 'Authorizing', tone: 'warn', hint: 'Waiting for the phone to confirm.' },
  connecting: { text: 'Connecting', tone: 'neutral', hint: null },
  offline: {
    text: 'Offline',
    tone: 'bad',
    hint: 'Unplug and replug the cable, or toggle USB debugging off and on.'
  },
  'no-permissions': {
    text: 'No permissions',
    tone: 'bad',
    hint: 'Windows cannot access this device. Install the phone maker’s USB driver.'
  },
  recovery: {
    text: 'Recovery mode',
    tone: 'neutral',
    hint: 'Mirroring needs the phone booted normally.'
  },
  sideload: {
    text: 'Sideload mode',
    tone: 'neutral',
    hint: 'Mirroring needs the phone booted normally.'
  },
  bootloader: {
    text: 'Bootloader',
    tone: 'neutral',
    hint: 'Mirroring needs the phone booted normally.'
  },
  unknown: { text: 'Unknown state', tone: 'neutral', hint: null }
}

export function stateLabel(state: DeviceState): StateLabel {
  return STATES[state]
}

/** Badge for a device that has a session; the plain device state otherwise. */
export function sessionLabel(session: SessionInfo): { text: string; tone: Tone } | null {
  switch (session.state) {
    case 'starting':
      return { text: 'Starting…', tone: 'neutral' }
    case 'running':
      return { text: 'Mirroring', tone: 'ok' }
    case 'stopping':
      return { text: 'Stopping…', tone: 'neutral' }
    case 'exited':
      return session.error ? { text: 'Stopped with error', tone: 'bad' } : null
  }
}

export function deviceTitle(device: Device): string {
  const parts = [device.manufacturer, device.model].filter(Boolean) as string[]
  if (parts.length === 2 && parts[1].toLowerCase().startsWith(parts[0].toLowerCase())) {
    return parts[1]
  }
  return parts.length ? parts.join(' ') : device.serial
}

export function androidLabel(device: Device): string | null {
  if (!device.androidVersion) return null
  return device.sdk
    ? `Android ${device.androidVersion} (API ${device.sdk})`
    : `Android ${device.androidVersion}`
}

export function connectionLabel(device: Device): string {
  return device.connection === 'usb' ? 'USB' : 'Wi-Fi / network'
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** 0–1, or null while the total size is unknown. */
export function downloadFraction(download: DownloadState): number | null {
  if (download.total <= 0) return null
  return Math.min(1, download.received / download.total)
}

export function downloadText(download: DownloadState): string {
  switch (download.phase) {
    case 'checking':
      return 'Checking the latest scrcpy release…'
    case 'downloading':
      return download.total > 0
        ? `Downloading scrcpy ${download.version ?? ''} — ${formatBytes(download.received)} of ${formatBytes(download.total)}`
        : `Downloading scrcpy ${download.version ?? ''}…`
    case 'verifying':
      return 'Verifying checksum…'
    case 'extracting':
      return 'Unpacking…'
    case 'done':
      return `scrcpy ${download.version ?? ''} installed.`
    case 'error':
      return download.error ?? 'Download failed.'
    default:
      return ''
  }
}

import { useCallback, useEffect, useRef, useState } from 'react'
import type {
  ActionResult,
  AutostartState,
  UpdatesState,
  CaptureItem,
  DevicesSnapshot,
  ScreenshotResult,
  SessionInfo,
  SettingsState,
  ToolsState,
  TransferProgress,
  TransferResult,
  WirelessState
} from '../../shared/models'
import type { MirrorConfig, OptionValue } from '../../shared/options'

/** Subscribes before the first read so no update can slip between the two. */
function useLive<T>(
  read: () => Promise<T>,
  subscribe: (callback: (value: T) => void) => () => void
): T | null {
  const [value, setValue] = useState<T | null>(null)
  useEffect(() => {
    let current = true
    const unsubscribe = subscribe((next) => {
      if (current) setValue(next)
    })
    void read().then((initial) => {
      // An event that already arrived is newer than this first read.
      if (current) setValue((existing) => existing ?? initial)
    })
    return () => {
      current = false
      unsubscribe()
    }
    // read/subscribe are stable references to window.api methods
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return value
}

export function useTools(): ToolsState | null {
  return useLive(window.api.getTools, window.api.onToolsChanged)
}

export function useDevices(): DevicesSnapshot | null {
  return useLive(window.api.getDevices, window.api.onDevicesChanged)
}

export function useSessions(): SessionInfo[] | null {
  return useLive(window.api.getSessions, window.api.onSessionsChanged)
}

/** Wireless state. While `watching`, the main process polls for nearby devices. */
export function useWireless(watching: boolean): WirelessState | null {
  const state = useLive(window.api.getWireless, window.api.onWirelessChanged)
  useEffect(() => {
    if (!watching) return
    void window.api.watchWireless()
    return () => void window.api.unwatchWireless()
  }, [watching])
  return state
}

export function useSettings(): SettingsState | null {
  return useLive(window.api.getSettings, window.api.onSettingsChanged)
}

export function useUpdates(): UpdatesState | null {
  return useLive(window.api.getUpdates, window.api.onUpdatesChanged)
}

/** Start-with-Windows state, read once and kept in step with what the person sets. */
export function useAutostart(): {
  state: AutostartState | null
  set: (enabled: boolean) => Promise<ActionResult>
} {
  const [state, setState] = useState<AutostartState | null>(null)
  useEffect(() => {
    void window.api.getAutostart().then(setState)
  }, [])
  const set = useCallback(async (enabled: boolean): Promise<ActionResult> => {
    const result = await window.api.setAutostart(enabled)
    setState(await window.api.getAutostart())
    return result
  }, [])
  return { state, set }
}

/**
 * The recordings and screenshots list with what is on disk right now. It reloads when the list
 * changes and when the window is focused again, since files can be moved or deleted meanwhile.
 */
export function useCaptures(settings: SettingsState): {
  items: CaptureItem[] | null
  refresh: () => void
} {
  const [items, setItems] = useState<CaptureItem[] | null>(null)
  const refresh = useCallback(() => {
    void window.api.listCaptures().then(setItems)
  }, [])
  const signature = settings.captures.map((c) => c.path).join('|')
  useEffect(refresh, [refresh, signature])
  useEffect(() => {
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [refresh])
  return { items, refresh }
}

export interface DeviceToolsHandle {
  screenshotBusy: boolean
  screenshot: ScreenshotResult | null
  takeScreenshot: () => Promise<void>
  sending: boolean
  progress: TransferProgress | null
  transfer: TransferResult | null
  /** Install APKs and copy other files. */
  send: (paths: string[]) => Promise<void>
  /** Ask for files with a dialog, then send them. */
  choose: () => Promise<void>
  dismissTransfer: () => void
}

/** Screenshot and file sending for one device, with their latest results. */
export function useDeviceTools(serial: string): DeviceToolsHandle {
  const [screenshotBusy, setScreenshotBusy] = useState(false)
  const [screenshot, setScreenshot] = useState<ScreenshotResult | null>(null)
  const [sending, setSending] = useState(false)
  const [progress, setProgress] = useState<TransferProgress | null>(null)
  const [transfer, setTransfer] = useState<TransferResult | null>(null)

  useEffect(() => {
    if (!sending) return
    return window.api.onTransferProgress((next) => {
      if (next.serial === serial) setProgress(next)
    })
  }, [sending, serial])

  const takeScreenshot = useCallback(async () => {
    setScreenshotBusy(true)
    setScreenshot(null)
    try {
      setScreenshot(await window.api.screenshot(serial))
    } finally {
      setScreenshotBusy(false)
    }
  }, [serial])

  const run = useCallback(async (action: () => Promise<TransferResult>) => {
    setSending(true)
    setProgress(null)
    setTransfer(null)
    try {
      const result = await action()
      // Closing the file dialog is not a result worth showing.
      setTransfer(result.ok && result.cancelled ? null : result)
    } finally {
      setSending(false)
      setProgress(null)
    }
  }, [])

  return {
    screenshotBusy,
    screenshot,
    takeScreenshot,
    sending,
    progress,
    transfer,
    send: (paths) => run(() => window.api.sendFiles(serial, paths)),
    choose: () => run(() => window.api.chooseAndSendFiles(serial)),
    dismissTransfer: () => setTransfer(null)
  }
}

export interface OptionsHandle {
  config: MirrorConfig
  /** Pass undefined to clear the option back to scrcpy's default. */
  setValue(id: string, value: OptionValue | undefined): void
  reset(): void
  /** Write any pending change now. Resolves when it is saved. */
  flush(): Promise<void>
}

/**
 * Edits one preset's options locally and writes them back shortly after each change.
 * Mount it with `key={presetId}`: a pending change is written when the preset is switched away.
 */
export function useOptionEditor(presetId: string, initial: MirrorConfig): OptionsHandle {
  const [config, setConfig] = useState<MirrorConfig>(initial)
  const latest = useRef<MirrorConfig>(initial)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const flush = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
    await window.api.setPresetOptions(presetId, latest.current)
  }, [presetId])

  useEffect(
    () => () => {
      if (timer.current) void flush()
    },
    [flush]
  )

  const update = useCallback(
    (next: MirrorConfig) => {
      latest.current = next
      setConfig(next)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => void flush(), 300)
    },
    [flush]
  )

  const setValue = useCallback(
    (id: string, value: OptionValue | undefined) => {
      const next = { ...latest.current }
      if (value === undefined || value === false) delete next[id]
      else next[id] = value
      update(next)
    },
    [update]
  )

  const reset = useCallback(() => update({}), [update])

  return { config, setValue, reset, flush }
}
const MAX_LOG_LINES = 500

/** Output of one session. Only loads and listens while `enabled`. */
export function useSessionLog(serial: string, enabled: boolean): string[] {
  const [lines, setLines] = useState<string[]>([])
  useEffect(() => {
    if (!enabled) return
    let current = true
    const unsubscribe = window.api.onSessionLog((log) => {
      if (!current || log.serial !== serial) return
      setLines((existing) => [...existing, ...log.lines].slice(-MAX_LOG_LINES))
    })
    void window.api.getSessionLog(serial).then((initial) => {
      // Lines that arrived while loading are already in state; keep history first, then those.
      if (current) setLines((existing) => dedupeJoin(initial, existing))
    })
    return () => {
      current = false
      unsubscribe()
      setLines([])
    }
  }, [serial, enabled])
  return lines
}

/** History followed by live lines, without repeating a line that appears in both. */
export function dedupeJoin(history: string[], live: string[]): string[] {
  if (live.length === 0) return history.slice(-MAX_LOG_LINES)
  // Find the longest tail of history that is a prefix of live.
  for (let overlap = Math.min(history.length, live.length); overlap > 0; overlap--) {
    let same = true
    for (let i = 0; i < overlap; i++) {
      if (history[history.length - overlap + i] !== live[i]) {
        same = false
        break
      }
    }
    if (same) return [...history, ...live.slice(overlap)].slice(-MAX_LOG_LINES)
  }
  return [...history, ...live].slice(-MAX_LOG_LINES)
}

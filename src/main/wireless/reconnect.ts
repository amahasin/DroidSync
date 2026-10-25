export interface ReconnectDeps {
  enabled(): boolean
  /** adb is running and reachable; there is no point trying otherwise. */
  adbReady(): boolean
  /** Addresses the person asked to remember. */
  candidates(): string[]
  isConnected(address: string): boolean
  /** The person disconnected it on purpose. */
  isPaused(address: string): boolean
  /** Try once. Resolves true when connected. */
  attempt(address: string): Promise<boolean>
  now(): number
}

export interface ReconnectTimings {
  tickMs: number
  /** Wait after the first failure; doubles after each further one. */
  baseDelayMs: number
  maxDelayMs: number
  /** Wait before retrying a device that was connected a moment ago and dropped. */
  dropDelayMs: number
}

const DEFAULTS: ReconnectTimings = {
  tickMs: 10_000,
  baseDelayMs: 20_000,
  maxDelayMs: 300_000,
  dropDelayMs: 3_000
}

interface Track {
  failures: number
  nextAttempt: number
  wasConnected: boolean
}

/**
 * Brings remembered devices back after they drop or the app starts.
 * One attempt at a time, backing off per device so an absent phone is not hammered.
 */
export class AutoReconnector {
  private tracks = new Map<string, Track>()
  private timer: NodeJS.Timeout | null = null
  private running = false
  private timings: ReconnectTimings

  constructor(
    private readonly deps: ReconnectDeps,
    timings: Partial<ReconnectTimings> = {}
  ) {
    this.timings = { ...DEFAULTS, ...timings }
  }

  start(): void {
    if (this.timer) return
    this.timer = setInterval(() => void this.tick(), this.timings.tickMs)
    // Do not make people wait a full interval after the app opens.
    setTimeout(() => void this.tick(), 1000).unref?.()
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
  }

  /** Forget the back-off for a device, so the next tick tries it straight away. */
  reset(address: string): void {
    this.tracks.delete(address)
  }

  /** One pass over the remembered devices. Exposed for tests and for "reconnect now". */
  async tick(): Promise<void> {
    if (this.running || !this.deps.enabled() || !this.deps.adbReady()) return
    this.running = true
    try {
      const addresses = this.deps.candidates()
      for (const stale of [...this.tracks.keys()]) {
        if (!addresses.includes(stale)) this.tracks.delete(stale)
      }
      for (const address of addresses) {
        if (!this.deps.enabled() || !this.deps.adbReady()) break
        await this.visit(address)
      }
    } finally {
      this.running = false
    }
  }

  private async visit(address: string): Promise<void> {
    const track = this.tracks.get(address) ?? { failures: 0, nextAttempt: 0, wasConnected: false }
    this.tracks.set(address, track)

    if (this.deps.isConnected(address)) {
      track.failures = 0
      track.wasConnected = true
      return
    }
    if (track.wasConnected) {
      // It was here a moment ago: try again soon, without the penalty of a long back-off.
      track.wasConnected = false
      track.nextAttempt = this.deps.now() + this.timings.dropDelayMs
    }
    if (this.deps.isPaused(address) || this.deps.now() < track.nextAttempt) return

    const connected = await this.deps.attempt(address)
    if (connected) {
      track.failures = 0
      track.wasConnected = true
      return
    }
    track.failures += 1
    const wait = Math.min(
      this.timings.maxDelayMs,
      this.timings.baseDelayMs * 2 ** (track.failures - 1)
    )
    track.nextAttempt = this.deps.now() + wait
  }
}

import type { EventEmitter } from 'events'
import type { Readable } from 'stream'
import type { SessionInfo, SessionLog, StartResult } from '../../shared/models'
import { classifyExit } from './classify'

/** The slice of ChildProcess the supervisor needs, so tests can substitute a fake. */
export interface ChildLike extends EventEmitter {
  pid?: number
  stdout: Readable | null
  stderr: Readable | null
}

export interface SessionDeps {
  spawn(file: string, args: string[], env: NodeJS.ProcessEnv): ChildLike
  /** Ask the process to close its window (WM_CLOSE). Resolves whatever the outcome. */
  closeGracefully(pid: number): Promise<void>
  /** Terminate the process and its children. */
  forceKill(pid: number): Promise<void>
}

export interface SessionTimings {
  /** How long to keep asking nicely before force-killing. */
  gracefulTimeoutMs: number
  /** Gap between graceful attempts (the window may not exist yet while starting). */
  gracefulRetryMs: number
  /** Consider the session running after this long even if no known "ready" line appeared. */
  runningFallbackMs: number
  logFlushMs: number
  maxLogLines: number
}

const DEFAULT_TIMINGS: SessionTimings = {
  gracefulTimeoutMs: 4000,
  gracefulRetryMs: 500,
  runningFallbackMs: 4000,
  logFlushMs: 100,
  maxLogLines: 500
}

// scrcpy prints these once it has connected and is about to show the window.
const READY_LINE = /INFO: (?:Device|Renderer|Texture):/

export interface StartRequest {
  serial: string
  scrcpyPath: string
  args: string[]
  /** Command line for display. */
  command: string
  env?: NodeJS.ProcessEnv
}

interface Session {
  info: SessionInfo
  child: ChildLike | null
  log: string[]
  pending: string[]
  flushTimer: NodeJS.Timeout | null
  fallbackTimer: NodeJS.Timeout | null
  stopRequested: boolean
  closed: Promise<void>
  markClosed: () => void
}

/** Runs one scrcpy process per device and reports their lifecycle and output. */
export class SessionManager {
  private sessions = new Map<string, Session>()
  private changeListeners = new Set<(sessions: SessionInfo[]) => void>()
  private logListeners = new Set<(log: SessionLog) => void>()
  private timings: SessionTimings

  constructor(
    private readonly deps: SessionDeps,
    timings: Partial<SessionTimings> = {}
  ) {
    this.timings = { ...DEFAULT_TIMINGS, ...timings }
  }

  list(): SessionInfo[] {
    return [...this.sessions.values()].map((session) => session.info)
  }

  getLog(serial: string): string[] {
    return [...(this.sessions.get(serial)?.log ?? [])]
  }

  isActive(serial: string): boolean {
    const session = this.sessions.get(serial)
    return !!session && session.info.state !== 'exited'
  }

  onChange(listener: (sessions: SessionInfo[]) => void): () => void {
    this.changeListeners.add(listener)
    return () => this.changeListeners.delete(listener)
  }

  onLog(listener: (log: SessionLog) => void): () => void {
    this.logListeners.add(listener)
    return () => this.logListeners.delete(listener)
  }

  start(request: StartRequest): StartResult {
    const { serial } = request
    if (this.isActive(serial)) return { ok: false, error: 'This device is already being mirrored.' }

    let markClosed = (): void => {}
    const closed = new Promise<void>((resolve) => (markClosed = resolve))
    const session: Session = {
      info: {
        serial,
        state: 'starting',
        pid: null,
        startedAt: Date.now(),
        exitCode: null,
        error: null,
        command: request.command
      },
      child: null,
      log: [],
      pending: [],
      flushTimer: null,
      fallbackTimer: null,
      stopRequested: false,
      closed,
      markClosed
    }

    let child: ChildLike
    try {
      child = this.deps.spawn(request.scrcpyPath, request.args, {
        ...process.env,
        ...request.env
      })
    } catch (error) {
      return { ok: false, error: `Could not start scrcpy: ${(error as Error).message}` }
    }

    session.child = child
    session.info.pid = child.pid ?? null
    this.sessions.set(serial, session)
    this.pushLines(session, [`$ ${request.command}`])

    this.attachOutput(session, child.stdout)
    this.attachOutput(session, child.stderr)

    session.fallbackTimer = setTimeout(
      () => this.markRunning(session),
      this.timings.runningFallbackMs
    )

    child.once('error', (error: Error) => {
      this.pushLines(session, [`ERROR: ${error.message}`])
      this.finish(session, null, `Could not start scrcpy: ${error.message}`)
    })
    child.once('close', (code: number | null) => this.finish(session, code))

    this.emitChange()
    return { ok: true }
  }

  /** Closes the window gracefully so scrcpy can clean up, force-killing after a timeout. */
  async stop(serial: string): Promise<void> {
    const session = this.sessions.get(serial)
    if (!session || session.info.state === 'exited') return
    if (session.info.state !== 'stopping') {
      session.stopRequested = true
      session.info = { ...session.info, state: 'stopping' }
      this.emitChange()
    }
    const pid = session.info.pid
    if (pid === null) return

    const deadline = Date.now() + this.timings.gracefulTimeoutMs
    let exited = false
    void session.closed.then(() => (exited = true))
    while (!exited && Date.now() < deadline) {
      await this.deps.closeGracefully(pid)
      await Promise.race([session.closed, delay(this.timings.gracefulRetryMs)])
    }
    if (!exited) {
      this.pushLines(session, ['[gui] scrcpy did not close in time; terminating it.'])
      await this.deps.forceKill(pid)
      await Promise.race([session.closed, delay(2000)])
    }
  }

  async stopAll(): Promise<void> {
    await Promise.all([...this.sessions.keys()].map((serial) => this.stop(serial)))
  }

  /** Adds a line to a session's log, for notes from the app itself. */
  note(serial: string, line: string): void {
    const session = this.sessions.get(serial)
    if (session) this.pushLines(session, [line])
  }

  private attachOutput(session: Session, stream: Readable | null): void {
    if (!stream) return
    let carry = ''
    stream.setEncoding?.('utf8')
    stream.on('data', (chunk: string | Buffer) => {
      const parts = (carry + chunk.toString()).split(/\r?\n/)
      carry = parts.pop() ?? ''
      this.pushLines(
        session,
        parts.filter((line) => line !== '')
      )
    })
    stream.on('end', () => {
      if (carry) this.pushLines(session, [carry])
      carry = ''
    })
  }

  private pushLines(session: Session, lines: string[]): void {
    if (lines.length === 0) return
    session.log.push(...lines)
    if (session.log.length > this.timings.maxLogLines) {
      session.log.splice(0, session.log.length - this.timings.maxLogLines)
    }
    session.pending.push(...lines)
    if (lines.some((line) => READY_LINE.test(line))) this.markRunning(session)
    if (!session.flushTimer) {
      session.flushTimer = setTimeout(() => this.flush(session), this.timings.logFlushMs)
    }
  }

  private flush(session: Session): void {
    session.flushTimer = null
    if (session.pending.length === 0) return
    const lines = session.pending
    session.pending = []
    for (const listener of this.logListeners) listener({ serial: session.info.serial, lines })
  }

  private markRunning(session: Session): void {
    if (session.info.state !== 'starting') return
    session.info = { ...session.info, state: 'running' }
    this.emitChange()
  }

  private finish(session: Session, exitCode: number | null, forcedError?: string): void {
    if (session.info.state === 'exited') return
    if (session.fallbackTimer) clearTimeout(session.fallbackTimer)
    if (session.flushTimer) clearTimeout(session.flushTimer)
    this.flush(session)

    const error = session.stopRequested
      ? null
      : (forcedError ?? classifyExit(session.log, exitCode))
    session.info = { ...session.info, state: 'exited', pid: null, exitCode, error }
    session.child = null
    session.markClosed()
    this.emitChange()
  }

  private emitChange(): void {
    const sessions = this.list()
    for (const listener of this.changeListeners) listener(sessions)
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

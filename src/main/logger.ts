import { appendFileSync, mkdirSync, readFileSync, renameSync, statSync, rmSync } from 'fs'
import { dirname } from 'path'

const DEFAULT_MAX_BYTES = 1024 * 1024

export type LogLevel = 'info' | 'warn' | 'error'

/**
 * A plain text log file. Every line is appended synchronously, so the last words before a crash
 * are on disk. When the file passes `maxBytes` it moves to `<file>.1` (replacing an older one), so
 * the log never grows without limit. Logging never throws.
 */
export class Logger {
  constructor(
    private readonly file: string,
    private readonly maxBytes = DEFAULT_MAX_BYTES,
    private readonly now: () => Date = () => new Date()
  ) {}

  info(...parts: unknown[]): void {
    this.write('info', parts)
  }

  warn(...parts: unknown[]): void {
    this.write('warn', parts)
  }

  error(...parts: unknown[]): void {
    this.write('error', parts)
  }

  write(level: LogLevel, parts: unknown[]): void {
    try {
      const line = `${this.now().toISOString()} ${level.toUpperCase().padEnd(5)} ${parts
        .map(describe)
        .join(' ')
        .replace(/\r?\n/g, '\n    ')}\n`
      mkdirSync(dirname(this.file), { recursive: true })
      this.rotateIfNeeded(Buffer.byteLength(line))
      appendFileSync(this.file, line, 'utf8')
    } catch {
      // A log that cannot be written must never take the app down.
    }
  }

  /** The last `lines` lines, oldest first. Empty when there is no log yet. */
  tail(lines: number): string[] {
    try {
      const text = readFileSync(this.file, 'utf8')
      return text.split('\n').filter(Boolean).slice(-lines)
    } catch {
      return []
    }
  }

  private rotateIfNeeded(incoming: number): void {
    let size: number
    try {
      size = statSync(this.file).size
    } catch {
      return
    }
    if (size + incoming <= this.maxBytes) return
    const old = `${this.file}.1`
    rmSync(old, { force: true })
    renameSync(this.file, old)
  }
}

function describe(value: unknown): string {
  if (typeof value === 'string') return value
  if (value instanceof Error) return value.stack ?? `${value.name}: ${value.message}`
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

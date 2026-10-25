/**
 * scrcpy option builder.
 *
 * The schema (optionSchema.ts) is data: the options view renders from it and `buildArgs` turns a
 * config into argv. Everything here is pure, so the renderer can show the exact command the main
 * process will run. Which flags exist depends on the installed scrcpy, so availability comes from
 * `scrcpy --help` (see `flags` in the build context) rather than from hard-coded version numbers.
 */
import { OPTIONS } from './optionSchema'
import type { MirrorConfig, OptionDef, OptionValue } from './optionTypes'

export { OPTIONS } from './optionSchema'
export { OPTION_GROUPS } from './optionTypes'
export type { MirrorConfig, OptionDef, OptionGroup, OptionValue } from './optionTypes'

const BY_ID = new Map(OPTIONS.map((option) => [option.id, option]))

export function optionById(id: string): OptionDef | undefined {
  return BY_ID.get(id)
}

/** The flag the installed scrcpy understands, or null when none of the candidates exist. */
export function resolveFlag(option: OptionDef, flags: ReadonlySet<string> | null): string | null {
  // Free-form arguments have no flag of their own; they are always available.
  if (option.kind === 'args') return ''
  if (!flags) return option.flags[0]
  return option.flags.find((flag) => flags.has(flag)) ?? null
}

/** True when every word of the query appears in the option's name, description or flag. */
export function matchesQuery(option: OptionDef, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text =
    `${option.label} ${option.description} ${option.flags.join(' ')} ${option.id}`.toLowerCase()
  return words.every((word) => text.includes(word))
}

// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_ALL = /[\u0000-\u001f\u007f]/g

/**
 * Keeps only known options whose value has the right type. Range and pattern problems are kept,
 * so the person can see and fix them; `buildArgs` reports them.
 */
export function sanitizeConfig(raw: unknown): MirrorConfig {
  const config: MirrorConfig = {}
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return config
  for (const [id, value] of Object.entries(raw as Record<string, unknown>)) {
    const option = BY_ID.get(id)
    if (!option) continue
    switch (option.kind) {
      case 'bool':
        if (value === true) config[id] = true
        break
      case 'int':
        if (typeof value === 'number' && Number.isFinite(value)) config[id] = value
        break
      case 'string':
      case 'path':
      case 'args':
        if (typeof value === 'string' && value.trim() !== '') {
          config[id] = value.trim().slice(0, option.kind === 'path' ? 400 : option.maxLength + 50)
        }
        break
      case 'optional':
        if (value === true) config[id] = true
        else if (typeof value === 'string' && value.trim() !== '') {
          config[id] = value.trim().slice(0, option.maxLength + 50)
        }
        break
      case 'enum':
        if (typeof value === 'string' && option.choices.some((c) => c.value === value)) {
          config[id] = value
        }
        break
    }
  }
  return config
}

export interface BuildContext {
  serial: string
  /** Flags the installed scrcpy knows, from `--help`. null = unknown, assume everything exists. */
  flags: ReadonlySet<string> | null
  /** Used for the window title when the person has not set one. */
  defaultTitle?: string
}

export interface BuildResult {
  args: string[]
  /** Option id → problem with its value. Starting is refused while this is non-empty. */
  errors: Record<string, string>
  /** Options that were set but are not available in the installed scrcpy. They are left out. */
  unsupported: string[]
}

// Flags the app manages itself; accepting them in free-form arguments would fight the device card.
const RESERVED_FLAG =
  /^(--serial|-s|--select-usb|-d|--select-tcpip|-e|--otg|--tcpip|--kill-adb-on-close)(=|$)/

export interface SplitResult {
  tokens: string[]
  error: string | null
}

/** Splits free-form arguments on spaces, honouring '…' and "…" quotes. Backslashes stay as typed. */
export function splitArgs(text: string): SplitResult {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | null = null
  let has = false
  for (const char of text) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
    } else if (char === '"' || char === "'") {
      quote = char
      has = true
    } else if (/\s/.test(char)) {
      if (has || current) tokens.push(current)
      current = ''
      has = false
    } else {
      current += char
    }
  }
  if (quote) return { tokens: [], error: `Missing closing ${quote} quote.` }
  if (has || current) tokens.push(current)
  return { tokens, error: null }
}

export function validateOption(option: OptionDef, value: OptionValue): string | null {
  switch (option.kind) {
    case 'bool':
      return typeof value === 'boolean' ? null : 'Must be on or off.'
    case 'int':
      if (typeof value !== 'number' || !Number.isInteger(value)) return 'Enter a whole number.'
      if (value < option.min || value > option.max) {
        return `Enter a number from ${option.min} to ${option.max}.`
      }
      return null
    case 'string':
    case 'optional': {
      if (option.kind === 'optional' && value === true) return null
      if (typeof value !== 'string') return 'Enter text.'
      if (CONTROL_CHARS.test(value)) return 'Remove control characters.'
      if (value.length > option.maxLength) return `Use at most ${option.maxLength} characters.`
      if (option.pattern && !new RegExp(option.pattern.regex).test(value)) {
        return option.pattern.message
      }
      return null
    }
    case 'enum':
      return option.choices.some((c) => c.value === value) ? null : 'Pick one of the listed values.'
    case 'path': {
      if (typeof value !== 'string') return 'Enter a file name.'
      if (CONTROL_CHARS.test(value) || /[<>"|?*]/.test(value.replace(/^[A-Za-z]:/, ''))) {
        return 'The name contains characters Windows does not allow in file names.'
      }
      return null
    }
    case 'args': {
      if (typeof value !== 'string') return 'Enter text.'
      if (CONTROL_CHARS.test(value)) return 'Remove control characters.'
      if (value.length > option.maxLength) return `Use at most ${option.maxLength} characters.`
      const { tokens, error } = splitArgs(value)
      if (error) return error
      const reserved = tokens.find((token) => RESERVED_FLAG.test(token))
      if (reserved)
        return `${reserved.split('=')[0]} is managed by the app and cannot be added here.`
      return null
    }
  }
}

/** Extension of a file name or template, lower case, without the dot. */
export function fileExtension(name: string): string {
  const match = /\.([A-Za-z0-9]+)$/.exec(name)
  return match ? match[1].toLowerCase() : ''
}

export function buildArgs(config: MirrorConfig, context: BuildContext): BuildResult {
  const args: string[] = [`--serial=${context.serial}`]
  const errors: Record<string, string> = {}
  const unsupported: string[] = []

  for (const option of OPTIONS) {
    const value = config[option.id]
    const isUnset =
      value === undefined ||
      value === false ||
      (option.kind === 'int' && option.default !== undefined && value === option.default)
    if (isUnset && !(option.id === 'windowTitle' && context.defaultTitle)) continue

    if (value !== undefined) {
      const problem = validateOption(option, value)
      if (problem) {
        errors[option.id] = problem
        continue
      }
    }

    // A recording needs a known container: from the extension, or from --record-format.
    if (option.kind === 'path' && typeof value === 'string' && !config['recordFormat']) {
      if (!option.extensions.includes(fileExtension(value))) {
        errors[option.id] = `End the name with ${option.extensions
          .map((e) => `.${e}`)
          .join(', ')}, or pick a Recording format.`
        continue
      }
    }

    const flag = resolveFlag(option, context.flags)
    if (flag === null) {
      if (value !== undefined && value !== false) unsupported.push(option.id)
      continue
    }

    if (option.kind === 'bool') {
      args.push(flag)
    } else if (option.kind === 'args') {
      args.push(...splitArgs(String(value)).tokens)
    } else if (option.kind === 'optional' && value === true) {
      args.push(flag)
    } else if (option.id === 'windowTitle' && value === undefined) {
      args.push(`${flag}=${context.defaultTitle}`)
    } else {
      args.push(`${flag}=${String(value)}`)
    }
  }

  return { args, errors, unsupported }
}

// ── Recording names ───────────────────────────────────────────────────────

const pad = (n: number): string => String(n).padStart(2, '0')

/** Replaces {device}, {date} and {time} so each device and run gets its own file. */
export function expandPlaceholders(template: string, device: string, now: Date): string {
  const safeDevice = device.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'device'
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  const time = `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`
  return template
    .replace(/\{device\}/g, safeDevice)
    .replace(/\{date\}/g, date)
    .replace(/\{time\}/g, time)
}

/** Window title used when the person has not set one, so several mirrors can be told apart. */
export function defaultWindowTitle(model: string | null, serial: string): string {
  return `${model ?? 'Android device'} (${serial})`.replace(CONTROL_CHARS_ALL, ' ').slice(0, 100)
}

/** Shell-style display of a command line. For showing and copying only, never for running. */
export function formatCommand(executable: string, args: string[]): string {
  const quote = (text: string): string =>
    /[\s"]/.test(text) || text === '' ? `"${text.replace(/"/g, '\\"')}"` : text
  return [executable, ...args].map(quote).join(' ')
}

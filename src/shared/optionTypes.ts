export type OptionValue = boolean | number | string

/** Option id → value. Only options the person has changed are present. */
export type MirrorConfig = Record<string, OptionValue>

export type OptionGroup =
  | 'video'
  | 'audio'
  | 'camera'
  | 'control'
  | 'recording'
  | 'window'
  | 'device'
  | 'display'
  | 'advanced'

export const OPTION_GROUPS: Array<{ id: OptionGroup; label: string }> = [
  { id: 'video', label: 'Video' },
  { id: 'audio', label: 'Audio' },
  { id: 'camera', label: 'Camera' },
  { id: 'control', label: 'Input & control' },
  { id: 'recording', label: 'Recording' },
  { id: 'window', label: 'Window' },
  { id: 'device', label: 'Device' },
  { id: 'display', label: 'Virtual display' },
  { id: 'advanced', label: 'Advanced' }
]

interface BaseOption {
  id: string
  label: string
  group: OptionGroup
  description: string
  /** Candidate long flags, newest name first. The first one the installed scrcpy knows is used. */
  flags: string[]
}

export interface BoolOption extends BaseOption {
  kind: 'bool'
}

export interface IntOption extends BaseOption {
  kind: 'int'
  min: number
  max: number
  /** Value meaning "scrcpy default"; no flag is emitted for it. */
  default?: number
  unit?: string
}

export interface Pattern {
  regex: string
  message: string
}

export interface StringOption extends BaseOption {
  kind: 'string'
  placeholder?: string
  maxLength: number
  /** Optional shape check with the message shown when it fails. */
  pattern?: Pattern
}

export interface EnumOption extends BaseOption {
  kind: 'enum'
  choices: Array<{ value: string; label: string }>
}

/** A file to write, chosen with a save dialog. May contain {device}, {date} and {time}. */
export interface PathOption extends BaseOption {
  kind: 'path'
  placeholder?: string
  /** File extensions scrcpy can write, lower case, without the dot. */
  extensions: string[]
}

/** A flag that works on its own (true) or with a value (a string), like --new-display[=WxH]. */
export interface OptionalOption extends BaseOption {
  kind: 'optional'
  placeholder?: string
  maxLength: number
  pattern?: Pattern
}

/** Free-form extra arguments, split like a command line and appended as they are. */
export interface ArgsOption extends BaseOption {
  kind: 'args'
  placeholder?: string
  maxLength: number
}

export type OptionDef =
  BoolOption | IntOption | StringOption | EnumOption | PathOption | OptionalOption | ArgsOption

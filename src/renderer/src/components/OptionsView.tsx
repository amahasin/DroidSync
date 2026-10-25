import { useState } from 'react'
import type { Device, Preset, ScrcpyTool, SettingsState } from '../../../shared/models'
import {
  OPTIONS,
  OPTION_GROUPS,
  buildArgs,
  defaultWindowTitle,
  formatCommand,
  matchesQuery,
  resolveFlag,
  type OptionGroup
} from '../../../shared/options'
import { useOptionEditor } from '../hooks'
import { OptionField } from './OptionField'
import { PresetBar } from './PresetBar'

interface ViewProps {
  settings: SettingsState
  presetId: string
  onSelectPreset: (id: string) => void
  scrcpy: ScrcpyTool | null
  /** A connected device to show the command for. */
  sample: { serial: string; model: string | null } | null
  /** Devices that can be asked what displays and cameras they have. */
  readyDevices: Device[]
}

/** Chooses the preset being edited; the editor below remounts per preset. */
export function OptionsView(props: ViewProps): React.JSX.Element {
  const preset =
    props.settings.presets.find((p) => p.id === props.presetId) ?? props.settings.presets[0]
  return <PresetWorkspace key={preset.id} {...props} preset={preset} />
}

function PresetWorkspace({
  settings,
  preset,
  onSelectPreset,
  scrcpy,
  sample,
  readyDevices
}: ViewProps & { preset: Preset }): React.JSX.Element {
  const editor = useOptionEditor(preset.id, preset.options)
  const [query, setQuery] = useState('')
  const [changedOnly, setChangedOnly] = useState(false)
  const [showUnavailable, setShowUnavailable] = useState(false)
  const [openGroups, setOpenGroups] = useState<Set<OptionGroup>>(new Set(['video']))
  const [copied, setCopied] = useState(false)

  const flags = scrcpy?.flags ? new Set(scrcpy.flags) : null
  const serial = sample?.serial ?? '<device serial>'
  const built = buildArgs(editor.config, {
    serial,
    flags,
    defaultTitle: defaultWindowTitle(sample?.model ?? null, serial)
  })
  const command = formatCommand(scrcpy?.path ?? 'scrcpy', built.args)
  const changedCount = Object.keys(editor.config).length

  const searching = query.trim() !== ''
  const visible = OPTIONS.filter(
    (option) =>
      matchesQuery(option, query) &&
      (!changedOnly || editor.config[option.id] !== undefined) &&
      (showUnavailable || resolveFlag(option, flags) !== null)
  )
  const hiddenUnavailable = flags
    ? OPTIONS.filter((option) => resolveFlag(option, flags) === null).length
    : 0

  const toggleGroup = (id: OptionGroup): void =>
    setOpenGroups((previous) => {
      const next = new Set(previous)
      if (!next.delete(id)) next.add(id)
      return next
    })

  const copy = (): void => {
    void navigator.clipboard
      .writeText(command)
      .then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 1500)
      })
      .catch(() => {})
  }

  return (
    <div className="options-view">
      <PresetBar
        presets={settings.presets}
        selected={preset}
        config={editor.config}
        onSelect={(id) => {
          void editor.flush().then(() => onSelectPreset(id))
        }}
      />

      <div className="toolbar">
        <input
          type="search"
          className="search"
          placeholder="Search options, like “bit rate” or --record"
          aria-label="Search options"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <label className="check">
          <input
            type="checkbox"
            checked={changedOnly}
            onChange={(event) => setChangedOnly(event.target.checked)}
          />
          Changed only{changedCount > 0 && ` (${changedCount})`}
        </label>
        <button type="button" onClick={editor.reset} disabled={changedCount === 0}>
          Reset all
        </button>
      </div>
      <p className="muted result-count" aria-live="polite">
        {visible.length} of {OPTIONS.length - (showUnavailable ? 0 : hiddenUnavailable)} options
        {hiddenUnavailable > 0 && (
          <>
            {' · '}
            <label className="check inline">
              <input
                type="checkbox"
                checked={showUnavailable}
                onChange={(event) => setShowUnavailable(event.target.checked)}
              />
              Show {hiddenUnavailable} not in scrcpy {scrcpy?.version ?? ''}
            </label>
          </>
        )}
      </p>

      {OPTION_GROUPS.map((group) => {
        const options = visible.filter((option) => option.group === group.id)
        if (options.length === 0) return null
        const open = searching || changedOnly || openGroups.has(group.id)
        const changed = options.filter((option) => editor.config[option.id] !== undefined).length
        return (
          <section key={group.id} className="group">
            <h2>
              <button
                type="button"
                className="group-toggle"
                aria-expanded={open}
                onClick={() => toggleGroup(group.id)}
                disabled={searching || changedOnly}
              >
                <span aria-hidden="true">{open ? '▾' : '▸'}</span> {group.label}
                <span className="muted">
                  {' '}
                  · {options.length}
                  {changed > 0 && ` · ${changed} changed`}
                </span>
              </button>
            </h2>
            {open && (
              <div className="group-fields">
                {options.map((option) => (
                  <OptionField
                    key={option.id}
                    option={option}
                    value={editor.config[option.id]}
                    error={built.errors[option.id]}
                    supported={resolveFlag(option, flags) !== null}
                    onChange={(value) => editor.setValue(option.id, value)}
                    picker={{ devices: readyDevices, setValue: editor.setValue }}
                  />
                ))}
              </div>
            )}
          </section>
        )
      })}

      {visible.length === 0 && (
        <p className="muted empty-note">
          {searching ? `No options match “${query.trim()}”.` : 'No options to show.'}
        </p>
      )}

      <div className="preview">
        <div className="preview-head">
          <strong>Command</strong>
          <button type="button" onClick={copy}>
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre className="command" tabIndex={0}>
          {command}
        </pre>
        {typeof editor.config['record'] === 'string' && (
          <p className="muted preview-note">
            {'{device}, {date} and {time}'} in the recording name are filled in when mirroring
            starts.
          </p>
        )}
      </div>
    </div>
  )
}

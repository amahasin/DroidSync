import { useState } from 'react'
import { DEFAULT_PRESET_ID, type ActionResult, type Preset } from '../../../shared/models'
import type { MirrorConfig } from '../../../shared/options'

type Mode = 'idle' | 'new' | 'rename' | 'delete'

interface Props {
  presets: Preset[]
  selected: Preset
  /** The options currently shown, which "Save as new" copies. */
  config: MirrorConfig
  onSelect: (id: string) => void
}

/** Pick, create, rename and delete presets. Name entry and delete confirmation happen inline. */
export function PresetBar({ presets, selected, config, onSelect }: Props): React.JSX.Element {
  const [mode, setMode] = useState<Mode>('idle')
  const [name, setName] = useState('')
  const [error, setError] = useState<string | null>(null)
  const isDefault = selected.id === DEFAULT_PRESET_ID

  const open = (next: Mode): void => {
    setMode(next)
    setError(null)
    setName(next === 'rename' ? selected.name : '')
  }
  const close = (): void => open('idle')

  const report = (result: ActionResult): boolean => {
    if (result.ok) return true
    setError(result.error)
    return false
  }

  const submitName = async (): Promise<void> => {
    if (mode === 'new') {
      const result = await window.api.createPreset(name, config)
      if (report(result) && result.id) {
        onSelect(result.id)
        close()
      }
    } else if (mode === 'rename') {
      if (report(await window.api.renamePreset(selected.id, name))) close()
    }
  }

  const remove = async (): Promise<void> => {
    if (report(await window.api.deletePreset(selected.id))) {
      onSelect(DEFAULT_PRESET_ID)
      close()
    }
  }

  return (
    <div className="preset-bar">
      <div className="preset-row">
        <label htmlFor="preset-select">Preset</label>
        <select
          id="preset-select"
          value={selected.id}
          onChange={(event) => {
            close()
            onSelect(event.target.value)
          }}
        >
          {presets.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.name}
            </option>
          ))}
        </select>
        {mode === 'idle' && (
          <>
            <button type="button" onClick={() => open('new')}>
              Save as new…
            </button>
            <button type="button" onClick={() => open('rename')} disabled={isDefault}>
              Rename…
            </button>
            <button type="button" onClick={() => open('delete')} disabled={isDefault}>
              Delete…
            </button>
          </>
        )}
      </div>

      {(mode === 'new' || mode === 'rename') && (
        <form
          className="preset-row"
          onSubmit={(event) => {
            event.preventDefault()
            void submitName()
          }}
        >
          <label htmlFor="preset-name">{mode === 'new' ? 'New preset name' : 'New name'}</label>
          <input
            id="preset-name"
            type="text"
            autoFocus
            maxLength={40}
            value={name}
            aria-invalid={!!error}
            onChange={(event) => setName(event.target.value)}
          />
          <button type="submit" className="primary">
            {mode === 'new' ? 'Save' : 'Rename'}
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </form>
      )}

      {mode === 'delete' && (
        <div className="preset-row" role="alert">
          <span>Delete “{selected.name}”? Devices using it go back to Default.</span>
          <button type="button" className="primary" onClick={() => void remove()}>
            Delete
          </button>
          <button type="button" onClick={close}>
            Cancel
          </button>
        </div>
      )}

      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {isDefault && (
        <p className="muted preset-note">
          Default is used by every device that has not been given its own preset.
        </p>
      )}
    </div>
  )
}

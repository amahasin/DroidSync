import { useId } from 'react'
import type { Device } from '../../../shared/models'
import type { OptionDef, OptionValue } from '../../../shared/options'
import { PICKER_FOR } from './pickers'
import { SourcePicker } from './SourcePicker'

export interface FieldProps {
  option: OptionDef
  value: OptionValue | undefined
  error: string | undefined
  supported: boolean
  onChange: (value: OptionValue | undefined) => void
  /** Connected devices and a way to set other options, for the "pick from device" helpers. */
  picker?: {
    devices: Device[]
    setValue: (id: string, value: OptionValue | undefined) => void
  }
}

const textOrUndefined = (text: string): string | undefined => (text === '' ? undefined : text)

/** Common choices offered while typing, for options where people rarely know the format. */
const SUGGESTIONS: Record<string, string[]> = {
  newDisplay: ['1920x1080/420', '1280x720/320', '1080x1920/420', '2560x1440/560', '/320']
}

/** One option rendered from its schema entry. */
export function OptionField({
  option,
  value,
  error,
  supported,
  onChange,
  picker
}: FieldProps): React.JSX.Element {
  const id = useId()
  const describedBy = `${id}-desc`
  const note = supported ? option.description : 'Not available in this version of scrcpy.'
  const common = { id, disabled: !supported, 'aria-describedby': describedBy }

  const control = ((): React.JSX.Element => {
    switch (option.kind) {
      case 'bool':
        return (
          <input
            {...common}
            type="checkbox"
            checked={value === true}
            onChange={(event) => onChange(event.target.checked ? true : undefined)}
          />
        )
      case 'int':
        return (
          <span className="with-unit">
            <input
              {...common}
              type="number"
              inputMode="numeric"
              min={option.min}
              max={option.max}
              placeholder={option.default === undefined ? '' : String(option.default)}
              value={typeof value === 'number' ? value : ''}
              aria-invalid={!!error}
              onChange={(event) =>
                onChange(event.target.value === '' ? undefined : Number(event.target.value))
              }
            />
            {option.unit && <span className="muted">{option.unit}</span>}
          </span>
        )
      case 'string':
      case 'args':
        return (
          <input
            {...common}
            type="text"
            className={option.kind === 'args' ? 'wide' : undefined}
            placeholder={option.placeholder}
            maxLength={option.maxLength + 50}
            value={typeof value === 'string' ? value : ''}
            aria-invalid={!!error}
            onChange={(event) => onChange(textOrUndefined(event.target.value))}
          />
        )
      case 'enum':
        return (
          <select
            {...common}
            value={typeof value === 'string' ? value : ''}
            onChange={(event) => onChange(textOrUndefined(event.target.value))}
          >
            <option value="">Default</option>
            {option.choices.map((choice) => (
              <option key={choice.value} value={choice.value}>
                {choice.label}
              </option>
            ))}
          </select>
        )
      case 'path':
        return (
          <span className="with-button">
            <input
              {...common}
              type="text"
              className="wide"
              placeholder={option.placeholder}
              value={typeof value === 'string' ? value : ''}
              aria-invalid={!!error}
              onChange={(event) => onChange(textOrUndefined(event.target.value))}
            />
            <button
              type="button"
              disabled={!supported}
              onClick={() => {
                void window.api.chooseRecordingPath().then((chosen) => chosen && onChange(chosen))
              }}
            >
              Browse…
            </button>
          </span>
        )
      case 'optional':
        return (
          <span className="with-button">
            <input
              {...common}
              type="checkbox"
              checked={value !== undefined}
              onChange={(event) => onChange(event.target.checked ? true : undefined)}
            />
            <input
              type="text"
              aria-label={`${option.label} value`}
              placeholder={option.placeholder}
              maxLength={option.maxLength + 50}
              list={SUGGESTIONS[option.id] ? `${id}-suggestions` : undefined}
              value={typeof value === 'string' ? value : ''}
              disabled={!supported || value === undefined}
              aria-invalid={!!error}
              onChange={(event) => onChange(event.target.value === '' ? true : event.target.value)}
            />
            {SUGGESTIONS[option.id] && (
              <datalist id={`${id}-suggestions`}>
                {SUGGESTIONS[option.id].map((suggestion) => (
                  <option key={suggestion} value={suggestion} />
                ))}
              </datalist>
            )}
          </span>
        )
    }
  })()

  const wide = option.kind === 'path' || option.kind === 'args'
  return (
    <div
      className={`field ${option.kind === 'bool' ? 'field-bool' : ''} ${wide ? 'field-wide' : ''}`}
    >
      <label htmlFor={id}>{option.label}</label>
      {control}
      {picker && supported && PICKER_FOR[option.id] && (
        <SourcePicker
          kind={PICKER_FOR[option.id]}
          devices={picker.devices}
          setValue={picker.setValue}
        />
      )}
      <p id={describedBy} className={`muted field-note ${supported ? '' : 'unsupported'}`}>
        {note}
      </p>
      {error && (
        <p className="error field-note" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}

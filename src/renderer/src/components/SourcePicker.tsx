import { useState } from 'react'
import type { Device, SourcesResult } from '../../../shared/models'
import type { OptionValue } from '../../../shared/options'
import { deviceTitle } from '../labels'
import type { PickerKind } from './pickers'

interface Props {
  kind: PickerKind
  devices: Device[]
  /** Sets any option of the preset being edited. */
  setValue: (id: string, value: OptionValue | undefined) => void
}

/** Asks a connected device what displays or cameras it has, and fills the options from the answer. */
export function SourcePicker({ kind, devices, setValue }: Props): React.JSX.Element {
  const [serial, setSerial] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SourcesResult | null>(null)
  const chosen = devices.find((d) => d.serial === serial) ?? devices[0]

  const detect = async (): Promise<void> => {
    if (!chosen) return
    setBusy(true)
    setResult(null)
    try {
      setResult(await window.api.listSources(chosen.serial, kind))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="source-picker">
      {devices.length === 0 ? (
        <p className="muted field-note">Connect a device to pick from what it offers.</p>
      ) : (
        <div className="form-row">
          {devices.length > 1 && (
            <select
              aria-label="Device to ask"
              value={chosen.serial}
              onChange={(event) => {
                setSerial(event.target.value)
                setResult(null)
              }}
            >
              {devices.map((d) => (
                <option key={d.serial} value={d.serial}>
                  {deviceTitle(d)}
                </option>
              ))}
            </select>
          )}
          <button type="button" onClick={() => void detect()} disabled={busy}>
            {busy
              ? 'Asking the device…'
              : `Pick from ${devices.length > 1 ? 'device' : deviceTitle(chosen)}`}
          </button>
        </div>
      )}

      {result && !result.ok && (
        <p className="error field-note" role="alert">
          {result.error}
        </p>
      )}

      {result?.ok && kind === 'displays' && (
        <div className="chips" role="group" aria-label="Displays">
          {result.displays.length === 0 && <span className="muted">No displays reported.</span>}
          {result.displays.map((display) => (
            <button
              key={display.id}
              type="button"
              className="chip"
              onClick={() => setValue('displayId', display.id)}
            >
              Display {display.id}
              {display.size && ` · ${display.size}`}
            </button>
          ))}
        </div>
      )}

      {result?.ok && kind === 'cameras' && (
        <div className="chips" role="group" aria-label="Cameras">
          {result.cameras.length === 0 && (
            <span className="muted">This device has no cameras that scrcpy can use.</span>
          )}
          {result.cameras.map((camera) => (
            <div key={camera.id} className="camera">
              <button
                type="button"
                className="chip"
                onClick={() => {
                  setValue('cameraId', camera.id)
                  setValue('cameraFacing', undefined)
                }}
              >
                Camera {camera.id}
                {camera.facing && ` · ${camera.facing}`}
                {camera.size && ` · up to ${camera.size}`}
              </button>
              {camera.sizes.map((size) => (
                <button
                  key={size}
                  type="button"
                  className="chip small"
                  title={`Use camera ${camera.id} at ${size}`}
                  onClick={() => {
                    setValue('cameraId', camera.id)
                    setValue('cameraFacing', undefined)
                    setValue('cameraSize', size)
                  }}
                >
                  {size}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

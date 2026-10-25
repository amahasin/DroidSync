import { useState } from 'react'
import type {
  DevicesSnapshot,
  MdnsService,
  RememberedDevice,
  SettingsState,
  WirelessResult,
  WirelessState
} from '../../../shared/models'

/** Outcome of an action, shown right under the control that started it. */
function Outcome({ result }: { result: WirelessResult | null }): React.JSX.Element | null {
  if (!result) return null
  return result.ok ? (
    <p className={result.warning ? 'warn-text' : 'ok-text'} role="status">
      {result.message}
    </p>
  ) : (
    <p className="error" role="alert">
      {result.error}
    </p>
  )
}

/** Runs an action, keeping the button disabled meanwhile and the result for display. */
function useAction(): {
  busy: boolean
  result: WirelessResult | null
  run: (action: () => Promise<WirelessResult>) => Promise<WirelessResult>
  clear: () => void
} {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<WirelessResult | null>(null)
  const run = async (action: () => Promise<WirelessResult>): Promise<WirelessResult> => {
    setBusy(true)
    setResult(null)
    try {
      const outcome = await action()
      setResult(outcome)
      return outcome
    } finally {
      setBusy(false)
    }
  }
  return { busy, result, run, clear: () => setResult(null) }
}

function ConnectForm(): React.JSX.Element {
  const [address, setAddress] = useState('')
  const action = useAction()
  return (
    <section className="card">
      <h2>Connect by address</h2>
      <p className="muted">
        For a device already set up for wireless use, or one you switched to Wi-Fi from a cable.
        Type just the IP address: 5555 is tried first, then the phone is searched for its Wireless
        debugging port (this can take about 15 seconds). Or type both, like 192.168.1.20:38021.
      </p>
      <form
        className="form-row"
        onSubmit={(event) => {
          event.preventDefault()
          void action
            .run(() => window.api.connectWireless(address))
            .then((r) => r.ok && setAddress(''))
        }}
      >
        <label htmlFor="connect-address">IP address</label>
        <input
          id="connect-address"
          type="text"
          placeholder="192.168.1.20 or 192.168.1.20:5555"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <button type="submit" className="primary" disabled={action.busy || address.trim() === ''}>
          {action.busy ? 'Connecting…' : 'Connect'}
        </button>
      </form>
      <Outcome result={action.result} />
    </section>
  )
}

function PairForm({ offers }: { offers: MdnsService[] }): React.JSX.Element {
  const [address, setAddress] = useState('')
  const [code, setCode] = useState('')
  const action = useAction()
  const ready = /^\d{6}$/.test(code) && address.trim() !== ''

  return (
    <section className="card">
      <h2>Pair a new device</h2>
      <ol className="steps muted">
        <li>
          On the phone open Settings → Developer options → Wireless debugging, and turn it on.
        </li>
        <li>Tap “Pair device with pairing code”. Keep that screen open.</li>
        <li>Enter the address and the six-digit code it shows.</li>
      </ol>

      {offers.length > 0 && (
        <ul className="rows" aria-label="Devices showing a pairing code">
          {offers.map((offer) => (
            <li key={offer.address} className="row">
              <div>
                <strong>{offer.name}</strong> <code>{offer.address}</code>
                <span className="muted"> · showing a pairing code</span>
              </div>
              <button type="button" onClick={() => setAddress(offer.address)}>
                Use this address
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="form-row"
        onSubmit={(event) => {
          event.preventDefault()
          void action
            .run(() => window.api.pairWireless(address, code))
            .then((r) => {
              if (r.ok) setCode('')
            })
        }}
      >
        <label htmlFor="pair-address">Pairing address</label>
        <input
          id="pair-address"
          type="text"
          placeholder="192.168.1.20:41234"
          value={address}
          onChange={(event) => setAddress(event.target.value)}
        />
        <label htmlFor="pair-code">Code</label>
        <input
          id="pair-code"
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={6}
          className="code"
          placeholder="123456"
          value={code}
          onChange={(event) => setCode(event.target.value.replace(/\D/g, ''))}
        />
        <button type="submit" className="primary" disabled={action.busy || !ready}>
          {action.busy ? 'Pairing…' : 'Pair'}
        </button>
      </form>
      <p className="muted field-note">
        The address on the pairing screen is not the same as the one on the main Wireless debugging
        screen.
      </p>
      <Outcome result={action.result} />
    </section>
  )
}

function Nearby({ wireless }: { wireless: WirelessState }): React.JSX.Element {
  const [pending, setPending] = useState<string | null>(null)
  const [result, setResult] = useState<WirelessResult | null>(null)

  const connect = async (service: MdnsService): Promise<void> => {
    setPending(service.address)
    setResult(null)
    try {
      setResult(await window.api.connectWireless(service.address))
    } finally {
      setPending(null)
    }
  }

  return (
    <section className="card">
      <h2>Nearby devices</h2>
      {wireless.mdns === 'unavailable' ? (
        <p className="muted">
          Automatic discovery is not available here ({wireless.mdnsError}). Use the address shown on
          the phone instead.
        </p>
      ) : wireless.connectable.length === 0 ? (
        <p className="muted">
          {wireless.mdns === 'available'
            ? 'No devices are announcing themselves. Turn on Wireless debugging on a phone that has been paired.'
            : 'Looking for devices…'}
        </p>
      ) : (
        <ul className="rows" aria-label="Nearby devices">
          {wireless.connectable.map((service) => (
            <li key={service.address} className="row">
              <div>
                <strong>{service.name}</strong> <code>{service.address}</code>
              </div>
              <button
                type="button"
                className="primary"
                disabled={pending !== null}
                onClick={() => void connect(service)}
              >
                {pending === service.address ? 'Connecting…' : 'Connect'}
              </button>
            </li>
          ))}
        </ul>
      )}
      <Outcome result={result} />
    </section>
  )
}

function Remembered({
  settings,
  wireless,
  devices
}: {
  settings: SettingsState
  wireless: WirelessState
  devices: DevicesSnapshot | null
}): React.JSX.Element {
  const action = useAction()
  const connected = (address: string): boolean =>
    !!devices?.devices.some(
      (d) => d.serial === address && d.state !== 'offline' && d.state !== 'connecting'
    )

  const status = (device: RememberedDevice): { text: string; tone: string } => {
    if (connected(device.address)) return { text: 'Connected', tone: 'ok' }
    if (wireless.attempting.includes(device.address))
      return { text: 'Connecting…', tone: 'neutral' }
    if (wireless.paused.includes(device.address)) return { text: 'Paused', tone: 'warn' }
    return { text: settings.autoReconnect ? 'Waiting' : 'Offline', tone: 'neutral' }
  }

  return (
    <section className="card">
      <h2>Remembered devices</h2>
      <label className="check">
        <input
          type="checkbox"
          checked={settings.autoReconnect}
          onChange={(event) => void window.api.setAutoReconnect(event.target.checked)}
        />
        Reconnect these devices automatically
      </label>
      {settings.wireless.length === 0 ? (
        <p className="muted">
          Devices you connect to by address, pair, or switch to Wi-Fi appear here and are
          reconnected when they come back.
        </p>
      ) : (
        <ul className="rows" aria-label="Remembered devices">
          {settings.wireless.map((device) => {
            const s = status(device)
            return (
              <li key={device.address} className="row">
                <div>
                  <strong>{device.name ?? device.address}</strong>
                  {device.name && <code> {device.address}</code>}
                  {s.text === 'Paused' && (
                    <span className="muted">
                      {' '}
                      · you disconnected it; press Reconnect to bring it back
                    </span>
                  )}
                </div>
                <div className="row-actions">
                  <span className={`badge ${s.tone}`}>{s.text}</span>
                  <button
                    type="button"
                    disabled={action.busy || connected(device.address)}
                    onClick={() =>
                      void action.run(() => window.api.reconnectWireless(device.address))
                    }
                  >
                    Reconnect
                  </button>
                  <button
                    type="button"
                    onClick={() => void window.api.forgetWireless(device.address)}
                  >
                    Forget
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}
      <Outcome result={action.result} />
    </section>
  )
}

interface ViewProps {
  wireless: WirelessState
  settings: SettingsState
  devices: DevicesSnapshot | null
}

export function WirelessView({ wireless, settings, devices }: ViewProps): React.JSX.Element {
  return (
    <div className="wireless-view">
      <ConnectForm />
      <PairForm offers={wireless.pairing} />
      <Nearby wireless={wireless} />
      <Remembered settings={settings} wireless={wireless} devices={devices} />
      <p className="muted">
        A phone connected by cable can be switched to Wi-Fi from its card on the Devices tab.
      </p>
    </div>
  )
}

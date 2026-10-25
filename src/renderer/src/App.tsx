import { useState } from 'react'
import { DEFAULT_PRESET_ID } from '../../shared/models'
import { CapturesView } from './components/CapturesView'
import { DeviceList } from './components/DeviceList'
import { OptionsView } from './components/OptionsView'
import { SettingsView } from './components/SettingsView'
import { SetupBanner } from './components/SetupBanner'
import { StatusBar } from './components/StatusBar'
import { WirelessView } from './components/WirelessView'
import { useDevices, useSessions, useSettings, useTools, useWireless } from './hooks'

type Tab = 'devices' | 'wireless' | 'options' | 'captures' | 'settings'

function App(): React.JSX.Element {
  const tools = useTools()
  const snapshot = useDevices()
  const sessions = useSessions()
  const settings = useSettings()
  const [tab, setTab] = useState<Tab>('devices')
  const wireless = useWireless(tab === 'wireless')
  const [presetId, setPresetId] = useState(DEFAULT_PRESET_ID)

  if (!tools || !settings) {
    return (
      <main className="shell">
        <p className="muted">Loading…</p>
      </main>
    )
  }

  const scrcpy = tools.status.scrcpy
  const readyDevices = snapshot?.devices.filter((device) => device.state === 'device') ?? []
  const firstReady = readyDevices[0] ?? null
  const running = (sessions ?? []).filter((s) => s.state !== 'exited').length

  return (
    <div className="layout">
      <nav className="tabs" role="tablist" aria-label="Sections">
        <button
          type="button"
          role="tab"
          id="tab-devices"
          aria-selected={tab === 'devices'}
          aria-controls="panel-devices"
          onClick={() => setTab('devices')}
        >
          Devices{running > 0 && <span className="count">{running}</span>}
        </button>
        <button
          type="button"
          role="tab"
          id="tab-wireless"
          aria-selected={tab === 'wireless'}
          aria-controls="panel-wireless"
          onClick={() => setTab('wireless')}
        >
          Wireless
        </button>
        <button
          type="button"
          role="tab"
          id="tab-options"
          aria-selected={tab === 'options'}
          aria-controls="panel-options"
          onClick={() => setTab('options')}
        >
          Options &amp; presets
        </button>
        <button
          type="button"
          role="tab"
          id="tab-captures"
          aria-selected={tab === 'captures'}
          aria-controls="panel-captures"
          onClick={() => setTab('captures')}
        >
          Captures
        </button>
        <button
          type="button"
          role="tab"
          id="tab-settings"
          aria-selected={tab === 'settings'}
          aria-controls="panel-settings"
          onClick={() => setTab('settings')}
        >
          Settings
        </button>
      </nav>

      <main className="shell">
        <SetupBanner tools={tools} />
        {tab === 'devices' ? (
          <section id="panel-devices" role="tabpanel" aria-labelledby="tab-devices">
            {snapshot ? (
              <DeviceList
                snapshot={snapshot}
                sessions={sessions ?? []}
                settings={settings}
                adbInstalled={tools.status.adb !== null}
                canMirror={scrcpy !== null}
                canMirrorApp={scrcpy?.flags?.includes('--start-app') ?? false}
                canOtg={scrcpy !== null && (scrcpy.flags?.includes('--otg') ?? true)}
              />
            ) : (
              <p className="muted">Looking for devices…</p>
            )}
          </section>
        ) : tab === 'wireless' ? (
          <section id="panel-wireless" role="tabpanel" aria-labelledby="tab-wireless">
            {wireless ? (
              <WirelessView wireless={wireless} settings={settings} devices={snapshot} />
            ) : (
              <p className="muted">Loading…</p>
            )}
          </section>
        ) : tab === 'options' ? (
          <section id="panel-options" role="tabpanel" aria-labelledby="tab-options">
            <OptionsView
              settings={settings}
              presetId={presetId}
              onSelectPreset={setPresetId}
              scrcpy={scrcpy}
              sample={firstReady ? { serial: firstReady.serial, model: firstReady.model } : null}
              readyDevices={readyDevices}
            />
          </section>
        ) : tab === 'captures' ? (
          <section id="panel-captures" role="tabpanel" aria-labelledby="tab-captures">
            <CapturesView settings={settings} />
          </section>
        ) : (
          <section id="panel-settings" role="tabpanel" aria-labelledby="tab-settings">
            <SettingsView settings={settings} tools={tools} />
          </section>
        )}
      </main>
      <StatusBar tools={tools} snapshot={snapshot} />
    </div>
  )
}

export default App

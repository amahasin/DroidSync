import { describe, expect, it } from 'vitest'
import type {
  ActionResult,
  Device,
  DevicesSnapshot,
  RememberedDevice,
  SettingsState
} from '../../shared/models'
import type { ConnectOutcome, MdnsEntry, PairOutcome } from '../adb/host'
import type { WirelessAdb } from './ops'
import { AutoReconnector, type ReconnectDeps } from './reconnect'
import { WirelessService } from './service'

const device = (serial: string, overrides: Partial<Device> = {}): Device => ({
  serial,
  state: 'device',
  rawState: 'device',
  connection: serial.includes(':') ? 'tcpip' : 'usb',
  transportId: '1',
  model: null,
  manufacturer: null,
  androidVersion: null,
  sdk: null,
  ...overrides
})

// ── WirelessService ──────────────────────────────────────────────────────

interface Fake {
  service: WirelessService
  calls: string[]
  devices: Device[]
  remembered: RememberedDevice[]
  autoReconnect: { value: boolean }
  shellOutput: Record<string, string>
  connectResults: Array<ConnectOutcome>
  mdns: { value: { ok: true; entries: MdnsEntry[] } | { ok: false; error: string } }
  pairResult: { value: PairOutcome }
  tcpipReply: { value: string | Error }
  adbState: { value: DevicesSnapshot['adb'] }
  /** Ports the fake phone has open, for the port search. */
  openPorts: { value: number[] }
}

function fake(): Fake {
  const calls: string[] = []
  const state: Fake = {
    calls,
    devices: [],
    remembered: [],
    autoReconnect: { value: true },
    shellOutput: {},
    connectResults: [],
    mdns: { value: { ok: true, entries: [] } },
    pairResult: { value: { ok: true, message: 'Successfully paired to x' } },
    tcpipReply: { value: 'restarting in TCP mode port: 5555\n' },
    adbState: { value: 'connected' },
    openPorts: { value: [] },
    service: undefined as unknown as WirelessService
  }
  const adb: WirelessAdb = {
    connect: async (host, port) => {
      calls.push(`connect ${host}:${port}`)
      return state.connectResults.shift() ?? { ok: true, address: `${host}:${port}` }
    },
    pair: async (address, code) => {
      calls.push(`pair ${address} ${code}`)
      return state.pairResult.value
    },
    disconnect: async (serial) => {
      calls.push(`disconnect ${serial}`)
      return { ok: true, message: '' }
    },
    mdnsServices: async () => state.mdns.value,
    shell: async (_serial, command) => {
      calls.push(`shell ${command}`)
      return state.shellOutput[command] ?? ''
    },
    tcpip: async (serial, port) => {
      calls.push(`tcpip ${serial} ${port}`)
      if (state.tcpipReply.value instanceof Error) throw state.tcpipReply.value
      return state.tcpipReply.value
    },
    findAdbPorts: async (host, from, to) => {
      calls.push(`scan ${host} ${from}-${to}`)
      return state.openPorts.value.filter((port) => port >= from && port <= to)
    }
  }
  const ok: ActionResult = { ok: true }
  state.service = new WirelessService({
    adb,
    settings: {
      get snapshot(): SettingsState {
        return {
          presets: [],
          devicePresets: {},
          wireless: state.remembered,
          autoReconnect: state.autoReconnect.value,
          screenshotFolder: null,
          captures: [],
          closeToTray: false,
          preferManagedScrcpy: false,
          hotkeys: { showWindow: null, stopAll: null, screenshot: null }
        }
      },
      rememberDevice: (address, name) => {
        const existing = state.remembered.find((d) => d.address === address)
        if (existing) existing.name = name ?? existing.name
        else state.remembered.push({ address, name: name ?? null })
        return ok
      },
      forgetDevice: (address) => {
        state.remembered = state.remembered.filter((d) => d.address !== address)
        return ok
      },
      moveRememberedDevice: (from, to) => {
        const d = state.remembered.find((x) => x.address === from)
        if (d) d.address = to
        return ok
      },
      setAutoReconnect: (enabled) => {
        state.autoReconnect.value = enabled
        return ok
      }
    },
    devices: {
      get snapshot(): DevicesSnapshot {
        return { adb: state.adbState.value, error: null, devices: state.devices }
      }
    },
    // Must yield to the event loop: an instant delay would let the mDNS poll loop starve it.
    delay: () => new Promise<void>((resolve) => setTimeout(resolve, 1)),
    restartWaitMs: 0,
    pollGapMs: 1
  })
  return state
}

describe('WirelessService.connect', () => {
  it('validates the address, connects, and remembers the device', async () => {
    const f = fake()
    expect(await f.service.connect('nonsense host')).toMatchObject({ ok: false })
    expect(f.calls).toEqual([])

    expect(await f.service.connect('192.168.1.20')).toEqual({
      ok: true,
      message: 'Connected to 192.168.1.20:5555.',
      address: '192.168.1.20:5555'
    })
    expect(f.remembered).toEqual([{ address: '192.168.1.20:5555', name: null }])
  })

  it('uses the model name of an already listed device', async () => {
    const f = fake()
    f.devices = [device('192.168.1.20:5555', { model: 'Pixel 7' })]
    await f.service.connect('192.168.1.20:5555')
    expect(f.remembered).toEqual([{ address: '192.168.1.20:5555', name: 'Pixel 7' }])
  })

  it('reports adb’s reason and remembers nothing on failure', async () => {
    const f = fake()
    f.connectResults.push({ ok: false, error: 'cannot connect to 1.2.3.4:5555: timed out' })
    expect(await f.service.connect('1.2.3.4')).toMatchObject({
      ok: false,
      error: expect.stringContaining('cannot connect to 1.2.3.4:5555: timed out')
    })
    expect(f.remembered).toEqual([])
  })
})

describe('WirelessService.connect without a port', () => {
  it('looks for the Wireless debugging port when 5555 is refused', async () => {
    const f = fake()
    f.connectResults.push({ ok: false, error: 'actively refused' })
    f.openPorts.value = [38021]
    const result = await f.service.connect('192.168.1.20')
    expect(result).toMatchObject({ ok: true, address: '192.168.1.20:38021' })
    expect(f.calls).toEqual([
      'connect 192.168.1.20:5555',
      'scan 192.168.1.20 32768-60999',
      'connect 192.168.1.20:38021'
    ])
  })

  it('does not scan when the person typed a port', async () => {
    const f = fake()
    f.connectResults.push({ ok: false, error: 'actively refused' })
    f.openPorts.value = [38021]
    expect(await f.service.connect('192.168.1.20:5555')).toEqual({
      ok: false,
      error: 'actively refused'
    })
    expect(f.calls).toEqual(['connect 192.168.1.20:5555'])
  })

  it('does not scan when the host simply does not answer', async () => {
    const f = fake()
    f.connectResults.push({ ok: false, error: 'adb did not answer in time' })
    f.openPorts.value = [38021]
    expect(await f.service.connect('192.168.1.20')).toEqual({
      ok: false,
      error: 'adb did not answer in time'
    })
    expect(f.calls).toEqual(['connect 192.168.1.20:5555'])
  })

  it('does not scan when 5555 works', async () => {
    const f = fake()
    await f.service.connect('192.168.1.20')
    expect(f.calls).toEqual(['connect 192.168.1.20:5555'])
  })

  it('keeps adb’s reason and points at the Wireless debugging screen when nothing is found', async () => {
    const f = fake()
    f.connectResults.push({ ok: false, error: 'actively refused' })
    const result = await f.service.connect('192.168.1.20')
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('actively refused')
    })
    expect(result.ok === false && result.error).toContain('Wireless debugging screen')
  })
})

describe('WirelessService.pair', () => {
  it('checks the address and code before calling adb', async () => {
    const f = fake()
    expect(await f.service.pair('192.168.1.20', '123456')).toMatchObject({ ok: false })
    expect(await f.service.pair('192.168.1.20:41234', '12345')).toMatchObject({ ok: false })
    expect(f.calls).toEqual([])
  })

  it('reports a failed pairing', async () => {
    const f = fake()
    f.pairResult.value = { ok: false, error: 'Wrong password or connection was dropped.' }
    expect(await f.service.pair('192.168.1.20:41234', '000000')).toEqual({
      ok: false,
      error: 'Wrong password or connection was dropped.'
    })
  })

  it('connects through the announced connect port after pairing', async () => {
    const f = fake()
    f.mdns.value = {
      ok: true,
      entries: [
        { name: 'adb-X', type: '_adb-tls-connect._tcp', address: '192.168.1.20:37045' },
        { name: 'adb-Y', type: '_adb-tls-connect._tcp', address: '192.168.1.99:40000' }
      ]
    }
    const result = await f.service.pair('192.168.1.20:41234', '123456')
    expect(result).toMatchObject({ ok: true, address: '192.168.1.20:37045' })
    expect(f.calls).toEqual(['pair 192.168.1.20:41234 123456', 'connect 192.168.1.20:37045'])
    expect(f.remembered.map((d) => d.address)).toEqual(['192.168.1.20:37045'])
  })

  it('finds the connect port by looking for it when mDNS announces nothing', async () => {
    const f = fake()
    f.openPorts.value = [38021]
    const result = await f.service.pair('192.168.1.20:41234', '123456')
    expect(result).toEqual({
      ok: true,
      message: 'Paired and connected to 192.168.1.20:38021.',
      address: '192.168.1.20:38021'
    })
    expect(f.calls).toEqual([
      'pair 192.168.1.20:41234 123456',
      'scan 192.168.1.20 32768-60999',
      'connect 192.168.1.20:38021'
    ])
    expect(f.remembered.map((d) => d.address)).toEqual(['192.168.1.20:38021'])
  })

  it('tries the next open port when the first is not adb', async () => {
    const f = fake()
    f.openPorts.value = [33000, 38021]
    f.connectResults.push({ ok: false, error: 'not adb' })
    const result = await f.service.pair('192.168.1.20:41234', '123456')
    expect(result).toMatchObject({ ok: true, address: '192.168.1.20:38021' })
    expect(f.calls.filter((c) => c.startsWith('connect'))).toEqual([
      'connect 192.168.1.20:33000',
      'connect 192.168.1.20:38021'
    ])
  })

  it('says the phone is paired but not connected when no port can be found', async () => {
    const f = fake()
    const result = await f.service.pair('192.168.1.20:41234', '123456')
    expect(result).toMatchObject({
      ok: true,
      warning: true,
      message: expect.stringContaining('Paired, but not connected yet')
    })
    expect(f.remembered).toEqual([])
  })

  it('still reports the pairing when the follow-up connect fails', async () => {
    const f = fake()
    f.mdns.value = {
      ok: true,
      entries: [{ name: 'adb-X', type: '_adb-tls-connect._tcp', address: '192.168.1.20:37045' }]
    }
    f.connectResults.push({ ok: false, error: 'refused' })
    expect(await f.service.pair('192.168.1.20:41234', '123456')).toEqual({
      ok: true,
      warning: true,
      message: 'Paired, but connecting failed: refused'
    })
  })
})

describe('WirelessService.enableWifi', () => {
  const wlan = '    inet 192.168.1.77/24 brd 192.168.1.255 scope global wlan0\n'

  it('reads the Wi-Fi address, restarts adbd on 5555 and connects', async () => {
    const f = fake()
    f.devices = [device('R5CT1234', { model: 'Pixel 7' })]
    f.shellOutput['ip -f inet addr show wlan0'] = wlan
    const result = await f.service.enableWifi('R5CT1234')
    expect(result).toEqual({
      ok: true,
      message: 'Connected to 192.168.1.77:5555. You can unplug the cable.',
      address: '192.168.1.77:5555'
    })
    expect(f.calls).toEqual([
      'shell ip -f inet addr show wlan0',
      'tcpip R5CT1234 5555',
      'connect 192.168.1.77:5555'
    ])
    expect(f.remembered).toEqual([{ address: '192.168.1.77:5555', name: 'Pixel 7' }])
  })

  it('falls back to the routing table for the address', async () => {
    const f = fake()
    f.devices = [device('R5CT1234')]
    f.shellOutput['ip route'] =
      '192.168.1.0/24 dev wlan0 proto kernel scope link src 192.168.1.78\n'
    expect(await f.service.enableWifi('R5CT1234')).toMatchObject({
      ok: true,
      address: '192.168.1.78:5555'
    })
  })

  it('retries while adbd restarts', async () => {
    const f = fake()
    f.devices = [device('R5CT1234')]
    f.shellOutput['ip -f inet addr show wlan0'] = wlan
    f.connectResults.push({ ok: false, error: 'refused' }, { ok: false, error: 'refused' })
    expect(await f.service.enableWifi('R5CT1234')).toMatchObject({ ok: true })
    expect(f.calls.filter((c) => c.startsWith('connect'))).toHaveLength(3)
  })

  it('gives up after repeated failures and says why', async () => {
    const f = fake()
    f.devices = [device('R5CT1234')]
    f.shellOutput['ip -f inet addr show wlan0'] = wlan
    for (let i = 0; i < 8; i++) f.connectResults.push({ ok: false, error: 'timed out' })
    const result = await f.service.enableWifi('R5CT1234')
    expect(result).toMatchObject({
      ok: false,
      error: expect.stringContaining('same Wi-Fi network')
    })
    expect(f.calls.filter((c) => c.startsWith('connect'))).toHaveLength(8)
  })

  it('stops early when there is no Wi-Fi address, without touching adbd', async () => {
    const f = fake()
    f.devices = [device('R5CT1234')]
    const result = await f.service.enableWifi('R5CT1234')
    expect(result).toMatchObject({ ok: false, error: expect.stringContaining('no Wi-Fi address') })
    expect(f.calls.some((c) => c.startsWith('tcpip'))).toBe(false)
  })

  it('reports an unexpected tcpip answer and a failing device', async () => {
    const f = fake()
    f.devices = [device('R5CT1234')]
    f.shellOutput['ip -f inet addr show wlan0'] = wlan
    f.tcpipReply.value = 'error: closed'
    expect(await f.service.enableWifi('R5CT1234')).toEqual({ ok: false, error: 'error: closed' })
    f.tcpipReply.value = new Error('device offline')
    expect(await f.service.enableWifi('R5CT1234')).toMatchObject({
      ok: false,
      error: expect.stringContaining('device offline')
    })
  })

  it('only works for ready USB devices', async () => {
    const f = fake()
    f.devices = [device('192.168.1.5:5555'), device('USB1', { state: 'unauthorized' })]
    expect(await f.service.enableWifi('nope')).toMatchObject({ ok: false })
    expect(await f.service.enableWifi('192.168.1.5:5555')).toMatchObject({
      ok: false,
      error: expect.stringContaining('already wireless')
    })
    expect(await f.service.enableWifi('USB1')).toMatchObject({
      ok: false,
      error: expect.stringContaining('not ready')
    })
    expect(await f.service.enableWifi(5)).toMatchObject({ ok: false })
  })
})

describe('WirelessService.disconnect', () => {
  it('disconnects a wireless device and pauses auto-reconnect for a remembered one', async () => {
    const f = fake()
    f.devices = [device('192.168.1.5:5555')]
    f.remembered = [{ address: '192.168.1.5:5555', name: null }]
    expect(await f.service.disconnect('192.168.1.5:5555')).toMatchObject({ ok: true })
    expect(f.service.state.paused).toEqual(['192.168.1.5:5555'])
  })

  it('does not pause a device that is not remembered, and refuses USB devices', async () => {
    const f = fake()
    f.devices = [device('192.168.1.5:5555'), device('USB1')]
    await f.service.disconnect('192.168.1.5:5555')
    expect(f.service.state.paused).toEqual([])
    expect(await f.service.disconnect('USB1')).toMatchObject({
      ok: false,
      error: expect.stringContaining('cable')
    })
    expect(await f.service.disconnect(5)).toMatchObject({ ok: false })
  })
})

describe('WirelessService remembered devices', () => {
  it('reconnectNow lifts a pause and connects', async () => {
    const f = fake()
    f.remembered = [{ address: '192.168.1.5:5555', name: null }]
    f.devices = [device('192.168.1.5:5555')]
    await f.service.disconnect('192.168.1.5:5555')
    expect(f.service.state.paused).toHaveLength(1)
    expect(await f.service.reconnectNow('192.168.1.5:5555')).toMatchObject({ ok: true })
    expect(f.service.state.paused).toEqual([])
  })

  it('reconnectNow refuses unknown addresses and reports unreachable ones', async () => {
    const f = fake()
    expect(await f.service.reconnectNow('9.9.9.9:5555')).toMatchObject({ ok: false })
    f.remembered = [{ address: '192.168.1.5:5555', name: null }]
    f.connectResults.push({ ok: false, error: 'timed out' })
    expect(await f.service.reconnectNow('192.168.1.5:5555')).toMatchObject({
      ok: false,
      error: expect.stringContaining('Could not reach')
    })
  })

  it('follows a device whose connect port changed', async () => {
    const f = fake()
    f.remembered = [{ address: '192.168.1.5:37045', name: 'Pixel' }]
    f.connectResults.push({ ok: false, error: 'refused' })
    f.mdns.value = {
      ok: true,
      entries: [{ name: 'adb-X', type: '_adb-tls-connect._tcp', address: '192.168.1.5:40111' }]
    }
    expect(await f.service.reconnectNow('192.168.1.5:37045')).toMatchObject({ ok: true })
    expect(f.calls).toEqual(['connect 192.168.1.5:37045', 'connect 192.168.1.5:40111'])
    expect(f.remembered).toEqual([{ address: '192.168.1.5:40111', name: 'Pixel' }])
  })

  it('reconnectNow follows a moved Wireless debugging port by looking for it', async () => {
    const f = fake()
    f.remembered = [{ address: '192.168.1.5:37045', name: 'Pixel' }]
    f.connectResults.push({ ok: false, error: 'refused' })
    f.openPorts.value = [41000]
    expect(await f.service.reconnectNow('192.168.1.5:37045')).toMatchObject({ ok: true })
    expect(f.remembered).toEqual([{ address: '192.168.1.5:41000', name: 'Pixel' }])
  })

  it('background reconnects never scan the network', async () => {
    const f = fake()
    f.remembered = [{ address: '192.168.1.5:37045', name: 'Pixel' }]
    f.connectResults.push({ ok: false, error: 'refused' })
    f.openPorts.value = [41000]
    await f.service.reconnectNow('192.168.1.5:37045').catch(() => {})
    f.calls.length = 0
    // The background path is the AutoReconnector's attempt, which calls reconnect without scanning.
    const service = f.service as unknown as { reconnect(a: string): Promise<boolean> }
    f.connectResults.push({ ok: false, error: 'refused' })
    await service.reconnect('192.168.1.5:41000')
    expect(f.calls.some((c) => c.startsWith('scan'))).toBe(false)
  })

  it('forget removes the device and its pause', async () => {
    const f = fake()
    f.remembered = [{ address: '192.168.1.5:5555', name: null }]
    f.devices = [device('192.168.1.5:5555')]
    await f.service.disconnect('192.168.1.5:5555')
    expect(f.service.forget('192.168.1.5:5555')).toEqual({ ok: true })
    expect(f.remembered).toEqual([])
    expect(f.service.state.paused).toEqual([])
    expect(f.service.forget(5)).toMatchObject({ ok: false })
  })

  it('learns the model name of a remembered device once it is listed', () => {
    const f = fake()
    f.remembered = [{ address: '192.168.1.5:5555', name: null }]
    f.devices = [device('192.168.1.5:5555', { model: 'Pixel 7' })]
    f.service.devicesChanged()
    expect(f.remembered[0].name).toBe('Pixel 7')
  })

  it('toggles auto-reconnect', () => {
    const f = fake()
    f.service.setAutoReconnect(false)
    expect(f.autoReconnect.value).toBe(false)
    f.service.setAutoReconnect('yes')
    expect(f.autoReconnect.value).toBe(false)
    f.service.setAutoReconnect(true)
    expect(f.autoReconnect.value).toBe(true)
  })
})

describe('WirelessService.watch (mDNS)', () => {
  const until = async (check: () => boolean): Promise<void> => {
    const start = Date.now()
    while (!check()) {
      if (Date.now() - start > 2000) throw new Error('timed out')
      await new Promise((r) => setTimeout(r, 2))
    }
  }

  it('lists pairing and connectable devices, hiding ones already connected', async () => {
    const f = fake()
    f.devices = [device('adb-LISTED._adb-tls-connect._tcp')]
    f.mdns.value = {
      ok: true,
      entries: [
        { name: 'adb-PAIR', type: '_adb-tls-pairing._tcp', address: '192.168.1.5:41234' },
        { name: 'adb-NEW', type: '_adb-tls-connect._tcp', address: '192.168.1.6:37000' },
        { name: 'adb-LISTED', type: '_adb-tls-connect._tcp', address: '192.168.1.7:37001' }
      ]
    }
    const seen: number[] = []
    f.service.onChange((s) => seen.push(s.pairing.length))
    const stop = f.service.watch()
    await until(() => f.service.state.mdns === 'available')
    stop()
    expect(f.service.state.pairing).toEqual([
      { name: 'adb-PAIR', address: '192.168.1.5:41234', kind: 'pairing' }
    ])
    expect(f.service.state.connectable.map((s) => s.name)).toEqual(['adb-NEW'])
    expect(seen.length).toBeGreaterThan(0)
  })

  it('reports mDNS as unavailable when adb says so, but only unknown when it is silent', async () => {
    const f = fake()
    f.mdns.value = { ok: false, error: 'mdns discovery unavailable' }
    let stop = f.service.watch()
    await until(() => f.service.state.mdns === 'unavailable')
    stop()
    expect(f.service.state.mdnsError).toBe('mdns discovery unavailable')

    const g = fake()
    g.mdns.value = { ok: false, error: 'adb did not answer in time' }
    stop = g.service.watch()
    await until(() => g.service.state.mdnsError !== null)
    stop()
    expect(g.service.state.mdns).toBe('unknown')
  })

  it('stops polling when nobody is watching', async () => {
    const f = fake()
    let polls = 0
    const original = f.mdns
    Object.defineProperty(f.mdns, 'value', {
      get() {
        polls++
        return { ok: true, entries: [] }
      },
      configurable: true
    })
    void original
    const stop = f.service.watch()
    await until(() => polls >= 2)
    stop()
    await new Promise((r) => setTimeout(r, 30))
    const after = polls
    await new Promise((r) => setTimeout(r, 30))
    expect(polls).toBe(after)
  })
})

// ── AutoReconnector ──────────────────────────────────────────────────────

interface Clock {
  reconnector: AutoReconnector
  attempts: string[]
  connected: Set<string>
  paused: Set<string>
  candidates: { value: string[] }
  results: Map<string, boolean>
  enabled: { value: boolean }
  ready: { value: boolean }
  time: { value: number }
}

function clock(): Clock {
  const c: Clock = {
    attempts: [],
    connected: new Set(),
    paused: new Set(),
    candidates: { value: ['A:1'] },
    results: new Map(),
    enabled: { value: true },
    ready: { value: true },
    time: { value: 1_000_000 },
    reconnector: undefined as unknown as AutoReconnector
  }
  const deps: ReconnectDeps = {
    enabled: () => c.enabled.value,
    adbReady: () => c.ready.value,
    candidates: () => c.candidates.value,
    isConnected: (a) => c.connected.has(a),
    isPaused: (a) => c.paused.has(a),
    attempt: async (a) => {
      c.attempts.push(a)
      return c.results.get(a) ?? false
    },
    now: () => c.time.value
  }
  c.reconnector = new AutoReconnector(deps, {
    baseDelayMs: 20_000,
    maxDelayMs: 100_000,
    dropDelayMs: 3_000
  })
  return c
}

describe('AutoReconnector', () => {
  it('tries a missing remembered device, then backs off exponentially up to the cap', async () => {
    const c = clock()
    const advance = (ms: number): number => (c.time.value += ms)

    await c.reconnector.tick()
    expect(c.attempts).toEqual(['A:1'])
    await c.reconnector.tick() // too soon
    expect(c.attempts).toHaveLength(1)

    advance(19_999)
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(1)
    advance(1)
    await c.reconnector.tick() // 20 s after the first failure
    expect(c.attempts).toHaveLength(2)

    advance(39_999)
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(2)
    advance(1)
    await c.reconnector.tick() // second failure waited 40 s
    expect(c.attempts).toHaveLength(3)

    advance(80_000)
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(4)
    advance(99_999) // third failure would wait 80 s; fourth is capped at 100 s
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(4)
    advance(1)
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(5)
  })

  it('leaves connected devices alone and retries soon after one drops', async () => {
    const c = clock()
    c.connected.add('A:1')
    await c.reconnector.tick()
    expect(c.attempts).toEqual([])

    c.connected.delete('A:1')
    await c.reconnector.tick() // noticed the drop: waits 3 s
    expect(c.attempts).toEqual([])
    c.time.value += 3_000
    await c.reconnector.tick()
    expect(c.attempts).toEqual(['A:1'])
  })

  it('resets the back-off after a success', async () => {
    const c = clock()
    c.results.set('A:1', true)
    await c.reconnector.tick()
    c.connected.add('A:1')
    await c.reconnector.tick()
    c.connected.delete('A:1')
    c.results.set('A:1', false)
    await c.reconnector.tick()
    c.time.value += 3_000
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(2)
  })

  it('does nothing when disabled, adb is down, or the device is paused', async () => {
    const c = clock()
    c.enabled.value = false
    await c.reconnector.tick()
    c.enabled.value = true
    c.ready.value = false
    await c.reconnector.tick()
    c.ready.value = true
    c.paused.add('A:1')
    await c.reconnector.tick()
    expect(c.attempts).toEqual([])
    c.paused.delete('A:1')
    await c.reconnector.tick()
    expect(c.attempts).toEqual(['A:1'])
  })

  it('reset() makes the next tick try straight away', async () => {
    const c = clock()
    await c.reconnector.tick()
    c.reconnector.reset('A:1')
    await c.reconnector.tick()
    expect(c.attempts).toHaveLength(2)
  })

  it('handles several devices one at a time and forgets removed ones', async () => {
    const c = clock()
    c.candidates.value = ['A:1', 'B:2']
    c.connected.add('A:1')
    await c.reconnector.tick()
    expect(c.attempts).toEqual(['B:2'])
    c.candidates.value = ['A:1']
    await c.reconnector.tick()
    c.candidates.value = ['A:1', 'B:2']
    c.connected.clear()
    c.time.value += 3_000
    await c.reconnector.tick()
    // B:2 is new again, so it is tried at once; A:1 was just seen connected and waits 3 s (elapsed).
    expect(c.attempts.filter((a) => a === 'B:2')).toHaveLength(2)
  })

  it('does not overlap ticks', async () => {
    const c = clock()
    let release: () => void = () => {}
    const gate = new Promise<void>((r) => (release = r))
    const slow = new AutoReconnector(
      {
        enabled: () => true,
        adbReady: () => true,
        candidates: () => ['A:1'],
        isConnected: () => false,
        isPaused: () => false,
        attempt: async () => {
          c.attempts.push('A:1')
          await gate
          return false
        },
        now: () => c.time.value
      },
      {}
    )
    const first = slow.tick()
    await slow.tick()
    release()
    await first
    expect(c.attempts).toHaveLength(1)
  })
})

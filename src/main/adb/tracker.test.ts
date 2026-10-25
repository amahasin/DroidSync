import { afterEach, describe, expect, it } from 'vitest'
import type { AdbStatus } from '../../shared/models'
import { adbShell } from './client'
import { framed, freePort, listen, onRequests, type FakeAdbServer } from './fakeServer'
import type { RawDevice } from './protocol'
import { DeviceTracker } from './tracker'

const ONE = 'S1 device usb:1-1 model:Pixel_7 transport_id:1\n'
const TWO = 'S1 device usb:1-1 model:Pixel_7 transport_id:1\nS2 unauthorized transport_id:2\n'

function waitFor<T>(check: () => T | undefined | false, timeoutMs = 3000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now()
    const tick = (): void => {
      const value = check()
      if (value) return resolve(value as T)
      if (Date.now() - started > timeoutMs) return reject(new Error('timed out waiting'))
      setTimeout(tick, 10)
    }
    tick()
  })
}

function collect(): {
  lists: RawDevice[][]
  statuses: Array<[AdbStatus, string | null]>
  listener: ConstructorParameters<typeof DeviceTracker>[1]
} {
  const lists: RawDevice[][] = []
  const statuses: Array<[AdbStatus, string | null]> = []
  return {
    lists,
    statuses,
    listener: {
      onDevices: (devices) => lists.push(devices),
      onStatus: (status, error) => statuses.push([status, error])
    }
  }
}

describe('DeviceTracker', () => {
  const cleanup: Array<() => Promise<void> | void> = []
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn()
  })

  it('performs the handshake and reports device lists split across chunks', async () => {
    const server = await listen((socket, requests) => {
      onRequests(socket, (payload) => {
        requests.push(payload)
        const first = framed(ONE)
        socket.write('OKAY' + first.slice(0, 10))
        setTimeout(() => socket.write(first.slice(10) + framed(TWO)), 20)
      })
    })
    cleanup.push(() => server.close())
    const { lists, statuses, listener } = collect()
    const tracker = new DeviceTracker({ host: '127.0.0.1', port: server.port }, listener)
    cleanup.push(() => tracker.stop())
    tracker.start()

    await waitFor(() => lists.length >= 2)
    expect(server.requests).toEqual(['host:track-devices-l'])
    expect(lists[0].map((d) => d.serial)).toEqual(['S1'])
    expect(lists[1].map((d) => [d.serial, d.state])).toEqual([
      ['S1', 'device'],
      ['S2', 'unauthorized']
    ])
    expect(statuses.map((s) => s[0])).toEqual(['starting', 'connected'])
  })

  it('reports an empty list when the last device is unplugged', async () => {
    const server = await listen((socket) => {
      onRequests(socket, () => {
        socket.write('OKAY' + framed(ONE))
        setTimeout(() => socket.write(framed('')), 20)
      })
    })
    cleanup.push(() => server.close())
    const { lists, listener } = collect()
    const tracker = new DeviceTracker({ host: '127.0.0.1', port: server.port }, listener)
    cleanup.push(() => tracker.stop())
    tracker.start()
    await waitFor(() => lists.length >= 2)
    expect(lists[1]).toEqual([])
  })

  it('reconnects after the server drops the connection', async () => {
    let connections = 0
    const server = await listen((socket) => {
      connections += 1
      const n = connections
      onRequests(socket, () => {
        socket.write('OKAY' + framed(ONE))
        if (n === 1) setTimeout(() => socket.destroy(), 20)
      })
    })
    cleanup.push(() => server.close())
    const { statuses, lists, listener } = collect()
    const tracker = new DeviceTracker(
      { host: '127.0.0.1', port: server.port, retryDelaysMs: [10] },
      listener
    )
    cleanup.push(() => tracker.stop())
    tracker.start()
    await waitFor(() => connections >= 2 && lists.length >= 2)
    expect(statuses.map((s) => s[0])).toContain('unavailable')
    expect(statuses[statuses.length - 1][0]).toBe('connected')
  })

  it('starts the adb server once when the connection is refused', async () => {
    const port = await freePort()
    let started = 0
    let server: FakeAdbServer | undefined
    const { lists, listener } = collect()
    const tracker = new DeviceTracker(
      {
        host: '127.0.0.1',
        port,
        retryDelaysMs: [10],
        startServer: async () => {
          started += 1
          server = await listen((socket) => {
            onRequests(socket, () => socket.write('OKAY' + framed(ONE)))
          }, port)
        }
      },
      listener
    )
    cleanup.push(
      () => tracker.stop(),
      () => server?.close()
    )
    tracker.start()
    await waitFor(() => lists.length >= 1)
    expect(started).toBe(1)
  })

  it('reports unavailable when the server cannot be started', async () => {
    const port = await freePort()
    const { statuses, listener } = collect()
    const tracker = new DeviceTracker(
      {
        host: '127.0.0.1',
        port,
        retryDelaysMs: [10],
        startServer: async () => {
          throw new Error('spawn adb ENOENT')
        }
      },
      listener
    )
    cleanup.push(() => tracker.stop())
    tracker.start()
    const last = await waitFor(() => statuses.find((s) => s[0] === 'unavailable'))
    expect(last[1]).toContain('spawn adb ENOENT')
  })

  it('surfaces a FAIL reply as unavailable', async () => {
    const server = await listen((socket) => {
      onRequests(socket, () => socket.write('FAIL' + framed('unknown host service')))
    })
    cleanup.push(() => server.close())
    const { statuses, listener } = collect()
    const tracker = new DeviceTracker(
      { host: '127.0.0.1', port: server.port, retryDelaysMs: [1000] },
      listener
    )
    cleanup.push(() => tracker.stop())
    tracker.start()
    const entry = await waitFor(() => statuses.find((s) => s[0] === 'unavailable'))
    expect(entry[1]).toContain('unknown host service')
  })

  it('stop() prevents further reconnects', async () => {
    const port = await freePort()
    const { statuses, listener } = collect()
    const tracker = new DeviceTracker({ host: '127.0.0.1', port, retryDelaysMs: [5] }, listener)
    tracker.start()
    await waitFor(() => statuses.some((s) => s[0] === 'unavailable'))
    tracker.stop()
    const count = statuses.length
    await new Promise((r) => setTimeout(r, 60))
    expect(statuses.length).toBe(count)
  })
})

describe('adbShell', () => {
  const cleanup: Array<() => Promise<void>> = []
  afterEach(async () => {
    for (const fn of cleanup.splice(0)) await fn()
  })

  it('selects the transport, runs the command and returns the output', async () => {
    const server = await listen((socket, requests) => {
      onRequests(socket, (payload) => {
        requests.push(payload)
        if (payload.startsWith('host:transport:')) socket.write('OKAY')
        else {
          // OKAY arrives glued to the first output bytes, then the rest, then close.
          socket.write('OKAY[ro.product.model]: [Pixel 7]\n')
          setTimeout(() => socket.end('[ro.build.version.release]: [14]\n'), 10)
        }
      })
    })
    cleanup.push(() => server.close())
    const output = await adbShell({
      host: '127.0.0.1',
      port: server.port,
      serial: 'S1',
      command: 'getprop'
    })
    expect(server.requests).toEqual(['host:transport:S1', 'shell:getprop'])
    expect(output).toBe('[ro.product.model]: [Pixel 7]\n[ro.build.version.release]: [14]\n')
  })

  it('rejects with the adb error message', async () => {
    const server = await listen((socket) => {
      onRequests(socket, () => socket.write('FAIL' + framed("device 'S9' not found")))
    })
    cleanup.push(() => server.close())
    await expect(
      adbShell({ host: '127.0.0.1', port: server.port, serial: 'S9', command: 'getprop' })
    ).rejects.toThrow("device 'S9' not found")
  })

  it('times out when the server never answers', async () => {
    const server = await listen(() => {})
    cleanup.push(() => server.close())
    await expect(
      adbShell({
        host: '127.0.0.1',
        port: server.port,
        serial: 'S1',
        command: 'getprop',
        timeoutMs: 50
      })
    ).rejects.toThrow('timed out')
  })

  it('refuses serials containing control characters', async () => {
    await expect(
      adbShell({ host: '127.0.0.1', port: 1, serial: 'a\nb', command: 'getprop' })
    ).rejects.toThrow('Invalid device serial')
  })
})

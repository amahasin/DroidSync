import { EventEmitter } from 'events'
import { PassThrough } from 'stream'
import { describe, expect, it } from 'vitest'
import type { SessionInfo, SessionLog } from '../../shared/models'
import { classifyExit } from './classify'
import { SessionManager, type ChildLike, type SessionDeps, type SessionTimings } from './manager'

class FakeChild extends EventEmitter implements ChildLike {
  pid = 4242
  stdout = new PassThrough()
  stderr = new PassThrough()
  say(text: string, stream: 'stdout' | 'stderr' = 'stdout'): void {
    this[stream].write(text)
  }
  exit(code: number | null): void {
    this.stdout.end()
    this.stderr.end()
    setTimeout(() => this.emit('close', code), 5)
  }
}

interface Harness {
  manager: SessionManager
  child: FakeChild
  calls: string[]
  states: string[]
  logs: SessionLog[]
}

function harness(
  options: {
    closesOnGraceful?: boolean
    throwOnSpawn?: boolean
    timings?: Partial<SessionTimings>
  } = {}
): Harness {
  const child = new FakeChild()
  const calls: string[] = []
  const deps: SessionDeps = {
    spawn: (file, args) => {
      if (options.throwOnSpawn) throw new Error('boom')
      calls.push(`spawn ${file} ${args.join(' ')}`)
      return child
    },
    closeGracefully: async (pid) => {
      calls.push(`graceful ${pid}`)
      if (options.closesOnGraceful) child.exit(0)
    },
    forceKill: async (pid) => {
      calls.push(`force ${pid}`)
      child.exit(1)
    }
  }
  const manager = new SessionManager(deps, {
    gracefulTimeoutMs: 120,
    gracefulRetryMs: 20,
    runningFallbackMs: 60,
    logFlushMs: 5,
    ...options.timings
  })
  const states: string[] = []
  const logs: SessionLog[] = []
  manager.onChange((sessions: SessionInfo[]) => states.push(sessions[0]?.state ?? 'none'))
  manager.onLog((log) => logs.push(log))
  return { manager, child, calls, states, logs }
}

const request = {
  serial: 'S1',
  scrcpyPath: 'C:\\scrcpy.exe',
  args: ['--serial=S1'],
  command: 'C:\\scrcpy.exe --serial=S1'
}

const until = async (check: () => boolean, ms = 2000): Promise<void> => {
  const start = Date.now()
  while (!check()) {
    if (Date.now() - start > ms) throw new Error('timed out')
    await new Promise((r) => setTimeout(r, 5))
  }
}

describe('SessionManager', () => {
  it('spawns with the given arguments and starts in the starting state', () => {
    const h = harness()
    expect(h.manager.start(request)).toEqual({ ok: true })
    expect(h.calls[0]).toBe('spawn C:\\scrcpy.exe --serial=S1')
    expect(h.manager.list()[0]).toMatchObject({ serial: 'S1', state: 'starting', pid: 4242 })
  })

  it('becomes running when scrcpy reports the device', async () => {
    const h = harness({ timings: { runningFallbackMs: 10_000 } })
    h.manager.start(request)
    h.child.say('scrcpy 2.6.1 <https://github.com/Genymobile/scrcpy>\nINFO: Device: [Xiaomi] TV\n')
    await until(() => h.manager.list()[0].state === 'running')
  })

  it('becomes running after the fallback delay even without a known line', async () => {
    const h = harness()
    h.manager.start(request)
    await until(() => h.manager.list()[0].state === 'running')
  })

  it('splits lines across chunks and streams them to log listeners', async () => {
    const h = harness()
    h.manager.start(request)
    h.child.say('INFO: Dev', 'stderr')
    h.child.say('ice: x\nWARN: second', 'stderr')
    h.child.say(' line\n', 'stderr')
    await until(() => h.logs.flatMap((l) => l.lines).length >= 3)
    expect(h.logs.flatMap((l) => l.lines)).toEqual([
      '$ C:\\scrcpy.exe --serial=S1',
      'INFO: Device: x',
      'WARN: second line'
    ])
    expect(h.manager.getLog('S1')).toHaveLength(3)
  })

  it('keeps only the most recent log lines', () => {
    const h = harness({ timings: { maxLogLines: 5 } })
    h.manager.start(request)
    h.child.say(Array.from({ length: 20 }, (_, i) => `line ${i}`).join('\n') + '\n')
    return until(() => h.manager.getLog('S1').includes('line 19')).then(() => {
      const log = h.manager.getLog('S1')
      expect(log).toHaveLength(5)
      expect(log[0]).toBe('line 15')
    })
  })

  it('refuses to start a second session for the same device', () => {
    const h = harness()
    h.manager.start(request)
    expect(h.manager.start(request)).toEqual({
      ok: false,
      error: 'This device is already being mirrored.'
    })
  })

  it('can start again after the previous session exited', async () => {
    const h = harness()
    h.manager.start(request)
    h.child.exit(0)
    await until(() => h.manager.list()[0].state === 'exited')
    expect(h.manager.start(request)).toEqual({ ok: true })
    expect(h.manager.list()[0].state).toBe('starting')
  })

  it('reports a failed spawn', () => {
    const h = harness({ throwOnSpawn: true })
    expect(h.manager.start(request)).toEqual({
      ok: false,
      error: 'Could not start scrcpy: boom'
    })
    expect(h.manager.list()).toEqual([])
  })

  it('explains an unexpected exit', async () => {
    const h = harness()
    h.manager.start(request)
    h.child.say('ERROR: Could not find any ADB device\n')
    h.child.exit(1)
    await until(() => h.manager.list()[0].state === 'exited')
    const info = h.manager.list()[0]
    expect(info.exitCode).toBe(1)
    expect(info.error).toContain('device was not found')
    expect(info.pid).toBeNull()
  })

  it('treats a clean exit as no error', async () => {
    const h = harness()
    h.manager.start(request)
    h.child.exit(0)
    await until(() => h.manager.list()[0].state === 'exited')
    expect(h.manager.list()[0].error).toBeNull()
  })

  it('stops gracefully and never force-kills a process that closes', async () => {
    const h = harness({ closesOnGraceful: true })
    h.manager.start(request)
    await h.manager.stop('S1')
    expect(h.manager.list()[0]).toMatchObject({ state: 'exited', error: null })
    expect(h.calls.filter((c) => c.startsWith('graceful'))).toHaveLength(1)
    expect(h.calls.some((c) => c.startsWith('force'))).toBe(false)
    expect(h.states).toContain('stopping')
  })

  it('retries the graceful close, then force-kills after the timeout', async () => {
    const h = harness()
    h.manager.start(request)
    await h.manager.stop('S1')
    expect(h.calls.filter((c) => c.startsWith('graceful')).length).toBeGreaterThan(1)
    expect(h.calls).toContain('force 4242')
    expect(h.manager.list()[0]).toMatchObject({ state: 'exited', error: null })
    expect(h.manager.getLog('S1').join('\n')).toContain('terminating')
  })

  it('does not report an error for an exit the person asked for', async () => {
    const h = harness()
    h.manager.start(request)
    h.child.say('ERROR: Server connection failed\n')
    await h.manager.stop('S1')
    expect(h.manager.list()[0].error).toBeNull()
  })

  it('stop on an unknown or finished session is a no-op', async () => {
    const h = harness()
    await h.manager.stop('nope')
    h.manager.start(request)
    h.child.exit(0)
    await until(() => h.manager.list()[0].state === 'exited')
    await h.manager.stop('S1')
    expect(h.calls.filter((c) => c.startsWith('graceful') || c.startsWith('force'))).toEqual([])
  })

  it('surfaces a process error such as a missing executable', async () => {
    const h = harness()
    h.manager.start(request)
    h.child.emit('error', new Error('spawn ENOENT'))
    await until(() => h.manager.list()[0].state === 'exited')
    expect(h.manager.list()[0].error).toBe('Could not start scrcpy: spawn ENOENT')
  })
})

describe('classifyExit', () => {
  it('returns null for a clean exit', () => {
    expect(classifyExit(['ERROR: whatever'], 0)).toBeNull()
  })

  it.each([
    ['ERROR: Device is unauthorized', 'authorized'],
    ['ERROR: Could not find any ADB device', 'not found'],
    ["adb: error: device 'X' not found", 'not found'],
    ['ERROR: Server connection failed', 'could not reach its server'],
    ['ERROR: Demuxer error', 'encoder failed'],
    ['ERROR: Unrecognized option: --nope', 'rejected one of the options']
  ])('recognises "%s"', (line, expected) => {
    expect(classifyExit(['INFO: starting', line], 1)).toContain(expected)
  })

  it('falls back to the last ERROR line, then to the exit code', () => {
    expect(classifyExit(['ERROR: something odd happened'], 1)).toBe('something odd happened')
    expect(classifyExit(['INFO: hi'], 3)).toBe('scrcpy exited with code 3.')
    expect(classifyExit([], null)).toBe('scrcpy was stopped.')
  })

  it('prefers ERROR lines over unrelated noise that mentions a keyword', () => {
    const lines = [
      'INFO: encoder list: c2.android.avc.encoder',
      'ERROR: Could not find any ADB device'
    ]
    expect(classifyExit(lines, 1)).toContain('not found')
  })
})

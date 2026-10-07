// terminal-session runtime：探测缓存（成功永久、失败 TTL）、并发合并、manager 生命周期。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTerminalRuntime, TERMINAL_PROBE_FAILURE_TTL_MS } from '../../src/host/terminal-session/runtime.ts'

const BASE = { timeoutMs: 30000, allowBackground: false, events: { enabled: false, maxReconnectMs: 30000 }, reportState: true }
const cap = (available: boolean) => ({ available, observe: available, control: available }) as never

test('successful probe is cached forever and concurrent calls share one probe', async () => {
  let calls = 0
  const rt = createTerminalRuntime({ ...BASE, terminalSession: { enabled: false } } as never, {
    probe: async () => { calls++; return cap(true) },
  })
  const [a, b] = await Promise.all([rt.ensureAvailable(), rt.ensureAvailable()])
  assert.equal(a && b, true)
  assert.equal(await rt.ensureAvailable(), true)
  assert.equal(calls, 1)
})

test('failed probe is cached for the TTL, then re-probed', async () => {
  let calls = 0
  let t = 1000
  const rt = createTerminalRuntime({ ...BASE, terminalSession: { enabled: false } } as never, {
    probe: async () => { calls++; return cap(false) },
    now: () => t,
  })
  assert.equal(await rt.ensureAvailable(), false)
  t += TERMINAL_PROBE_FAILURE_TTL_MS - 1
  assert.equal(await rt.ensureAvailable(), false)
  assert.equal(calls, 1)
  t += 2
  await rt.ensureAvailable()
  assert.equal(calls, 2)
})

test('probe errors propagate and do not poison the cache', async () => {
  let fail = true
  const rt = createTerminalRuntime({ ...BASE, terminalSession: { enabled: false } } as never, {
    probe: async () => { if (fail) throw new Error('boom'); return cap(true) },
  })
  await assert.rejects(rt.ensureAvailable(), /boom/)
  fail = false
  assert.equal(await rt.ensureAvailable(), true)
})

test('manager is created only when enabled with a socket path, and disposed once', () => {
  let disposed = 0
  const createManager = () => ({ dispose: () => { disposed++ } })
  assert.equal(createTerminalRuntime({ ...BASE, terminalSession: { enabled: false }, socketPath: '/tmp/x.sock' } as never, { createManager }).manager(), null)
  const rt = createTerminalRuntime({ ...BASE, terminalSession: { enabled: true }, socketPath: '/tmp/x.sock' } as never, { createManager })
  assert.ok(rt.manager())
  rt.dispose()
  rt.dispose()
  assert.equal(disposed, 1)
  assert.equal(rt.manager(), null)
})

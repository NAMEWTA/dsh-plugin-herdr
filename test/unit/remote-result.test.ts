// Regression: dsh-api-gateway direct methods resolve to a Result envelope
// ({ ok: true, value } | { ok: false, error }), not the host return value.
// The web read snap.workspaces off the envelope and crashed the dashboard.
// Fixtures are real protocol-22 payloads captured through the alpha gateway.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HerdrRemoteError,
  getHerdrRemote,
  isRemoteResult,
  setHerdrRemote,
  unwrapRemoteResult,
} from '../../src/web/remote.ts'
import { closeGlobalDashboard, fetchDashboard, openGlobalDashboard, statusStore } from '../../src/web/store.ts'
import { createFetchTransport } from '../../src/web/terminal-session.ts'
import { fetchPaneSession } from '../../src/web/session-pane.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'remote-p22')
const load = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as { ok: true; value: Record<string, unknown> }

/** Fake raw namespace shaped like the gateway: every direct call resolves to a Result. */
function gatewayRemote(values: Record<string, (request?: unknown) => unknown>): Record<string, unknown> {
  const raw: Record<string, unknown> = {}
  for (const [name, impl] of Object.entries(values)) {
    raw[name] = async function (this: unknown, request?: unknown) {
      assert.equal(this, raw, 'method keeps its receiver')
      return { ok: true, value: await impl(request) }
    }
  }
  return raw
}

test('unwrapRemoteResult unwraps ok, throws failures, passes raw values through', () => {
  assert.deepEqual(unwrapRemoteResult({ ok: true, value: { a: 1 } }), { a: 1 })
  assert.equal(unwrapRemoteResult({ ok: true, value: undefined }), undefined)
  // Host mutation results travel inside the envelope and survive unwrapping.
  assert.deepEqual(unwrapRemoteResult({ ok: true, value: { ok: false, error: 'pane_not_found' } }), { ok: false, error: 'pane_not_found' })
  assert.throws(
    () => unwrapRemoteResult({ ok: false, error: { code: 'gateway/internal', message: 'boom' } }),
    (error: unknown) => error instanceof HerdrRemoteError && error.code === 'gateway/internal' && error.message === 'boom',
  )
  // Not an envelope: host-shaped values (string error, no value key) pass through.
  assert.deepEqual(unwrapRemoteResult({ ok: false, error: 'x' }), { ok: false, error: 'x' })
  assert.deepEqual(unwrapRemoteResult({ ok: true }), { ok: true })
  assert.equal(isRemoteResult(load('dashboard.result.json')), true)
})

test('dashboard fetch returns the protocol-22 snapshot, not the gateway envelope', async () => {
  const fixture = load('dashboard.result.json')
  setHerdrRemote(gatewayRemote({ dashboard: () => fixture.value }))
  try {
    const snap = await fetchDashboard(new AbortController().signal)
    assert.ok(Array.isArray(snap.workspaces))
    assert.equal(snap.workspaces.length, 3)
    assert.equal(snap.summary.workspaces, 3)
    assert.equal(snap.server.protocol, 22)
    assert.equal(snap.server.version, '0.9.0')
    assert.equal((snap as unknown as Record<string, unknown>).ok, undefined)
  } finally {
    setHerdrRemote(null)
  }
})

test('status store receives the protocol-22 status snapshot', async () => {
  const fixture = load('status.result.json')
  setHerdrRemote(gatewayRemote({ status: () => fixture.value }))
  openGlobalDashboard()
  const stop = statusStore.subscribe(() => {})
  try {
    await new Promise(resolve => setTimeout(resolve, 30))
    const snap = statusStore.getSnap()
    assert.equal(snap?.server?.protocol, 22)
    assert.equal(snap?.agents.length, 2)
    assert.equal(snap?.topology?.panes.length, 3)
  } finally {
    stop()
    closeGlobalDashboard()
    setHerdrRemote(null)
  }
})

test('gateway failures reject instead of resolving to an envelope', async () => {
  setHerdrRemote({ dashboard: async () => ({ ok: false, error: { code: 'gateway/internal', message: 'offline' } }) })
  try {
    await assert.rejects(() => fetchDashboard(new AbortController().signal), /offline/)
  } finally {
    setHerdrRemote(null)
  }
})

test('mutation, session and terminal callers read the unwrapped host value', async () => {
  setHerdrRemote(gatewayRemote({
    close: () => ({ ok: false, error: 'pane_not_found' }),
    paneSession: () => ({ session_id: 'sess-1' }),
    terminalStart: () => ({ ok: true, session_id: 'term-1', generation: 2 }),
  }))
  try {
    assert.deepEqual(await getHerdrRemote().close({ kind: 'pane', id: 'w1:p1' }), { ok: false, error: 'pane_not_found' })
    assert.equal(await fetchPaneSession('w1:p1'), 'sess-1')
    const started = await createFetchTransport().start({ pane_id: 'w1:p1' } as never)
    assert.deepEqual(started, { sessionId: 'term-1', generation: 2 })
  } finally {
    setHerdrRemote(null)
  }
})

test('stream methods are passed through without awaiting an envelope', async () => {
  const items = [{ type: 'heartbeat' }]
  const handle = { async *[Symbol.asyncIterator]() { yield* items } }
  setHerdrRemote({ events: () => handle })
  try {
    const stream = getHerdrRemote().events({})
    assert.equal(stream, handle)
    const seen: unknown[] = []
    for await (const item of stream) seen.push(item)
    assert.deepEqual(seen, items)
  } finally {
    setHerdrRemote(null)
  }
})

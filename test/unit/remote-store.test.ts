import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeGlobalDashboard, openGlobalDashboard, openHerdrEvents, sendPaneInput, statusStore } from '../../src/web/store.ts'
import { setHerdrRemote, type HerdrRemote } from '../../src/web/remote.ts'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}

test('status store calls the remote unary method', async () => {
  let seen: unknown
  const remote = {
    status: async (request?: unknown) => {
      seen = request
      return { server: { running: true }, agents: [], topology: { workspaces: [] }, updated_at: 1 }
    },
  } as HerdrRemote
  setHerdrRemote(remote)
  openGlobalDashboard()
  const stop = statusStore.subscribe(() => {})
  try {
    await new Promise(resolve => setTimeout(resolve, 30))
    assert.deepEqual(seen, { scope: 'project' })
    assert.equal(statusStore.getSnap()?.server?.running, true)
  } finally {
    stop()
    closeGlobalDashboard()
    setHerdrRemote(null)
  }
})

test('event stream reconnects after the remote iterable ends and stops after close', async () => {
  let calls = 0
  const first = deferred<void>()
  const remote = {
    events: (_request?: unknown) => ({
      async *[Symbol.asyncIterator]() {
        calls += 1
        if (calls === 1) {
          yield { type: 'heartbeat', stale: false, last_error: null }
          first.resolve()
          return
        }
        yield { type: 'heartbeat', stale: true, last_error: 'again' }
        await new Promise(() => {})
      },
    }),
  } as unknown as HerdrRemote
  setHerdrRemote(remote)
  const seen: string[] = []
  const ctrl = new AbortController()
  const handle = openHerdrEvents(ctrl.signal, event => {
    if (event.type === 'heartbeat') seen.push(String(event.stale))
  })
  await first.promise
  await new Promise(resolve => setTimeout(resolve, 3200))
  handle.close()
  const stoppedAt = calls
  await new Promise(resolve => setTimeout(resolve, 50))
  assert.deepEqual(seen, ['false', 'true'])
  assert.equal(calls, stoppedAt)
  assert.ok(calls >= 2)
  setHerdrRemote(null)
})

test('panel data layer does not fetch herdr http routes', () => {
  const here = dirname(fileURLToPath(import.meta.url))
  const store = readFileSync(join(here, '..', '..', 'src', 'web', 'store.ts'), 'utf8')
  const self = readFileSync(fileURLToPath(import.meta.url), 'utf8')
  assert.doesNotMatch(store, /fetch\(\s*['"`]\/herdr-/)
  assert.doesNotMatch(self, /fetch\(\s*['"`]\/herdr-/)
})

test('pane input uses the remote and rejects when it is not mounted', async () => {
  const calls: unknown[] = []
  setHerdrRemote({
    paneInput: async request => {
      calls.push(request)
      return { ok: true }
    },
  } as HerdrRemote)
  await sendPaneInput('w1:p1', { text: 'hi' })
  assert.deepEqual(calls, [{ pane_id: 'w1:p1', text: 'hi' }])
  setHerdrRemote(null)
  await assert.rejects(() => sendPaneInput('w1:p1', { text: 'x' }), /not mounted/)
})

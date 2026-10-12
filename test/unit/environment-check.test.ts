import { test } from 'node:test'
import assert from 'node:assert/strict'
import { checkEnvironment, setupFailureDetail } from '../../src/web/environment/check.ts'

test('environment recheck is read-only and returns host facts', async () => {
  const report = { platform: 'linux', available: false }
  const calls: string[] = []
  const remote = { start: async () => { calls.push('start'); return { ok: true } }, environment: async () => { calls.push('check'); return report } }
  assert.equal(await checkEnvironment(remote), report)
  assert.deepEqual(calls, ['check'])
})

test('start failure preserves actionable binary/socket diagnostics', async () => {
  let checks = 0
  const remote = {
    start: async () => ({ ok: false, error: 'herdr executable not found; open installation settings' }),
    environment: async () => { checks++; return {} },
  }
  await assert.rejects(checkEnvironment(remote, true), /herdr executable not found/)
  assert.equal(checks, 0, 'do not present a follow-up check as a successful start')
})

test('environment read follows an explicitly confirmed successful start', async () => {
  const calls: string[] = []
  await checkEnvironment({ start: async () => { calls.push('start'); return { ok: true } }, environment: async () => { calls.push('check'); return {} } }, true)
  assert.deepEqual(calls, ['start', 'check'])
})

test('invalid or timeout start receipts cannot report success', async () => {
  for (const result of [null, undefined, {}, { ok: 'true' }, { ok: false, server: { running: false } }]) {
    await assert.rejects(checkEnvironment({ start: async () => result, environment: async () => ({}) }, true), /herdr_start_unconfirmed/)
  }
})

test('gateway exceptions retain their diagnostic message', async () => {
  const failure = new Error('herdr remote is not mounted')
  await assert.rejects(checkEnvironment({ start: async () => ({ ok: true }), environment: async () => { throw failure } }), error => error === failure)
  assert.equal(setupFailureDetail(failure), 'herdr remote is not mounted')
})

test('diagnostics are bounded and do not stringify arbitrary objects', () => {
  assert.equal(setupFailureDetail({ credentials: 'must-not-render' }), null)
  assert.equal(setupFailureDetail(null), null)
  assert.equal(setupFailureDetail('x'.repeat(10000))?.length, 1000)
  assert.equal(setupFailureDetail({ code: 'HERDR_UNAVAILABLE' }), 'HERDR_UNAVAILABLE')
})

test('diagnostics remove control sequences and common credential-bearing values', () => {
  const message = '\u001b[31mfailed\u001b[0m\nhttps://example.test/?token=fake-value&x=1 api_key=fake-key Bearer fake-auth'
  const detail = setupFailureDetail(new Error(message))!
  assert.doesNotMatch(detail, /fake-value|fake-key|fake-auth|\u001b|\n/)
  assert.match(detail, /failed/)
  assert.match(detail, /\[redacted\]/)
})

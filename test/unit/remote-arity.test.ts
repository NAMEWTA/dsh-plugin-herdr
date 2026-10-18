import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TYPERT, TYPERT_REMOTE } from '../../lib/typert.host.js'
import { adaptHerdrRemote } from '../../src/web/remote.ts'

// Optional request schemas do not make a wire parameter optional: the DSH
// client checks argument count before sending a request to the Host.
const noRequest = ['environment', 'dashboard', 'topology', 'start', 'terminalStats'] as const

for (const name of noRequest) {
  test(`${name}: generated Host and Web descriptors accept the zero-argument caller`, async () => {
    const host = TYPERT.invocations.find(descriptor => descriptor.method === name)!
    const web = TYPERT_REMOTE.descriptors.find(descriptor => descriptor.method === name)!
    assert.ok(host)
    assert.equal(web, host)
    assert.deepEqual(host.parameters, [], `${name} must not require a dummy request`)
    let calls = 0
    const value = { method: name }
    const remote = adaptHerdrRemote({
      [name](...args: unknown[]) {
        assert.equal(args.length, web.parameters.length, `${name} wire argument count`)
        calls++
        return Promise.resolve({ ok: true, value })
      },
    })
    assert.deepEqual(await remote[name](), value)
    assert.equal(calls, 1)
  })
}

test('request-bearing methods retain their single request codec, including status and events', () => {
  for (const descriptor of TYPERT.invocations) {
    if ((noRequest as readonly string[]).includes(descriptor.method)) continue
    assert.equal(descriptor.parameters.length, 1, descriptor.method)
    const request = descriptor.parameters[0] as { name: string; wire: string; codec: { create(): unknown } }
    assert.equal(request.name, 'request')
    assert.equal(request.wire, 'request')
    assert.equal(typeof request.codec.create, 'function')
  }
  const events = TYPERT.invocations.find(descriptor => descriptor.method === 'events')!
  assert.equal(events.mode, 'stream')
  assert.deepEqual(events.cancellation, { parameter: 'signal' })
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readWebStartupUrl, redactLaunchTokens } from '../../scripts/dsh-smoke-utils.mjs'

const origin = 'http://127.0.0.1:3080'
const token = 'a-test-only-token-0123456789'
test('Web smoke uses the authenticated launch URL from the owned child', () => {
  assert.equal(readWebStartupUrl(`dsh web: ${origin}/?token=${token}\n`, origin), `${origin}/?token=${token}`)
})
test('Web smoke refuses foreign origins, ports, credentials and paths', () => {
  for (const url of [
    `https://example.com/?token=${token}`,
    `http://127.0.0.1:3081/?token=${token}`,
    `http://user@127.0.0.1:3080/?token=${token}`,
    `${origin}/elsewhere?token=${token}`,
  ]) assert.equal(readWebStartupUrl(url, origin), null)
})
test('Web smoke waits for a complete token and does not disable authentication', () => {
  assert.equal(readWebStartupUrl(origin, origin), null)
  assert.equal(readWebStartupUrl(`${origin}/?token=short`, origin), null)
  assert.equal(readWebStartupUrl(`booting\n${origin}/?token=${token}&extra=ignored`, origin), `${origin}/?token=${token}`)
})
test('Web launch credentials are redacted from retained diagnostics', () => {
  const text = `${origin}/?token=${token}\n${origin}/?a=1&token=${token}&b=2`
  assert.equal(redactLaunchTokens(text), `${origin}/?token=[redacted]\n${origin}/?a=1&token=[redacted]&b=2`)
  assert.ok(!redactLaunchTokens(text).includes(token))
})

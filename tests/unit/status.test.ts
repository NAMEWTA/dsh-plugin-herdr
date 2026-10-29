import { test } from 'node:test'
import assert from 'node:assert/strict'
import { agentName, canonicalizeStatus, presentTerminal, refineLiveStatus, resolvePaneStatus, sessionAgentName, tabHeading, terminalTitle } from '../../modules/herdr/src/domain/status.ts'

test('Herdr status aliases map onto the five stored states', () => {
  assert.equal(canonicalizeStatus('running'), 'working')
  assert.equal(canonicalizeStatus({status: 'busy'}), 'working')
  assert.equal(canonicalizeStatus('needs input'), 'blocked')
  assert.equal(canonicalizeStatus('completed'), 'done')
  assert.equal(canonicalizeStatus('ready'), 'idle')
  assert.equal(canonicalizeStatus(null), 'unknown')
  assert.equal(canonicalizeStatus('mystery'), 'unknown')
  assert.equal(resolvePaneStatus('unknown', {phase: 'working'}), 'working')
  assert.equal(resolvePaneStatus('unknown', {cwd: '/tmp'}), 'unknown')
  assert.equal(resolvePaneStatus('running', {phase: 'idle'}), 'working')
})

test('a plain unknown shell is shown as idle, and an unclassified agent is not a question mark', () => {
  assert.deepEqual(presentTerminal({state: 'unknown', agent: null}), {mark: 'idle', statusKey: 'idle', agent: null})
  assert.deepEqual(presentTerminal({state: 'unknown', agent: 'bash'}), {mark: 'idle', statusKey: 'idle', agent: null})
  assert.deepEqual(presentTerminal({state: 'unknown', agent: 'claude'}), {mark: 'unreported', statusKey: 'statusUnreported', agent: 'claude'})
  assert.equal(presentTerminal({state: 'working', agent: 'codex'}).mark, 'working')
  assert.equal(terminalTitle({label: 'Shell', title: '', id: 'w1:p1'}), null)
  assert.equal(terminalTitle({label: 'API', title: 'Shell', id: 'w1:p1'}), 'API')
  assert.equal(tabHeading('1', 'Tab'), 'Tab 1')
  assert.equal(tabHeading('Main', 'Tab'), 'Main')
  assert.equal(agentName(['bash', 'claude']), 'claude')
  assert.equal(agentName(['bash']), null)
  assert.equal(sessionAgentName({agent: 'codex', kind: 'id'}), 'codex')
  assert.equal(refineLiveStatus('unknown', {launchPending: true}), 'working')
  assert.equal(refineLiveStatus('unknown', {interactiveReady: true}), 'idle')
  assert.equal(refineLiveStatus('blocked', {interactiveReady: true}), 'blocked')
  assert.equal(refineLiveStatus('unknown', {}), 'unknown')
})

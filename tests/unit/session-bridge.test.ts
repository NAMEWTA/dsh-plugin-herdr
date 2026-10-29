import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { bindGlobalWorkbenchOpener, bindSessionWorkbenchOpener, requestWorkbenchPage, workspaceLabelFromPath } from '../../modules/herdr/src/web/session-bridge.ts'

describe('session workbench page', { concurrency: false }, () => {
test('a session workbench opener wins over the global panel opener', () => {
  const seen: string[] = []
  const stopGlobal = bindGlobalWorkbenchOpener(() => seen.push('global'))
  const stopSession = bindSessionWorkbenchOpener('demo', () => seen.push('session'))
  try {
    assert.equal(requestWorkbenchPage('demo'), true)
    assert.equal(requestWorkbenchPage('other'), true)
    assert.equal(requestWorkbenchPage(), true)
    assert.deepEqual(seen, ['session', 'global', 'global'])
  } finally {
    stopSession()
    stopGlobal()
    assert.equal(requestWorkbenchPage('demo'), false)
  }
})

test('a failing workbench opener leaves the in-shell navigation available', () => {
  const stop = bindGlobalWorkbenchOpener(() => { throw new Error('panel missing') })
  try { assert.equal(requestWorkbenchPage('demo'), false) }
  finally { stop() }
})

test('workspace labels come from the project path basename', () => {
  assert.equal(workspaceLabelFromPath('/demo/workbench', 'workspace'), 'workbench')
  assert.equal(workspaceLabelFromPath('C:\\demo\\workbench\\', 'workspace'), 'workbench')
  assert.equal(workspaceLabelFromPath('/demo/bad\u0000name', 'workspace'), 'badname')
  assert.equal(workspaceLabelFromPath('/', '工作区'), '工作区')
})
})

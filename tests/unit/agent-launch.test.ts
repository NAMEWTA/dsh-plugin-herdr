import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validateArgs, type ParameterSchemaSpec } from '@deepseek-ai/dsh-tools'
import { WorkbenchError } from '@workbench/contracts'
import { launchArgumentExample, launchParameters } from '../../adapters/dsh/src/host/tools.ts'
import { LAUNCH_ARGUMENT_EXAMPLE, agentInstanceName, planLaunch, selectWorkspaceForCwd } from '../../modules/herdr/src/domain/agent-launch.ts'

const parameters = launchParameters as unknown as ParameterSchemaSpec

test('the launch example is the same string the model and the server describe', () => {
  assert.equal(launchArgumentExample, LAUNCH_ARGUMENT_EXAMPLE)
  assert.deepEqual(validateArgs(parameters, JSON.parse(launchArgumentExample)), [])
})

test('the launch schema accepts one agent and rejects a bad kind, count, or prompt', () => {
  assert.deepEqual(validateArgs(parameters, {agents: [{kind: 'claude-code', count: 1}]}), [])
  const kind = validateArgs(parameters, {agents: [{kind: 'shell', count: 1}], send: false})
  assert.ok(kind.some(issue => issue.includes('kind') && issue.includes('codex')))
  const count = validateArgs(parameters, {agents: [{kind: 'codex', count: 9}], send: false})
  assert.ok(count.some(issue => issue.includes('count')))
  const prompt = validateArgs(parameters, {agents: [{kind: 'codex', count: 1}], prompt: 'hello'})
  assert.equal(prompt.length, 0, 'the tool root is open; execute rejects prompt and names the field')
})

test('planLaunch maps aliases, caps the total, and names the bad field', () => {
  assert.deepEqual(planLaunch([{kind: 'codex', count: 4}, {kind: 'claude-code', count: 4}], ['claude', 'codex']), [
    {kind: 'codex', command: 'codex', count: 4},
    {kind: 'claude', command: 'claude', count: 4},
  ])
  assert.throws(() => planLaunch([{kind: 'gpt', count: 1}], ['claude', 'codex']), (error: unknown) => {
    assert.equal((error as WorkbenchError).code, 'INVALID_REQUEST')
    assert.match((error as Error).message, /agents\[0\]\.kind/)
    assert.match((error as Error).message, /codex, claude, claude-code/)
    return true
  })
  assert.throws(() => planLaunch([{kind: 'codex', count: 0}], ['codex']), (error: unknown) => {
    assert.match((error as Error).message, /agents\[0\]\.count/)
    return true
  })
  assert.throws(() => planLaunch([{kind: 'codex', count: 8}, {kind: 'claude', count: 1}], ['claude', 'codex']), (error: unknown) => {
    assert.match((error as Error).message, /total count is 9/)
    assert.match((error as Error).message, /LAUNCH_ARGUMENT_EXAMPLE|agents/)
    return true
  })
  assert.throws(() => planLaunch([], ['codex']), /field agents/)
})

test('selectWorkspaceForCwd reuses one match and refuses an ambiguous set', () => {
  const workspaces = [
    {id: 'a', label: 'Workbench', cwds: ['/demo/workbench']},
    {id: 'b', label: '服务端控制面', cwds: ['/demo/workbench']},
  ]
  assert.equal(selectWorkspaceForCwd(workspaces, '/demo/workbench', 'workbench'), null)
  assert.equal(selectWorkspaceForCwd([{id: 'only', label: 'other', cwds: ['/demo/workbench']}], '/demo/workbench', 'workbench'), 'only')
  assert.equal(selectWorkspaceForCwd([...workspaces, {id: 'c', label: 'workbench', cwds: ['/demo/workbench']}], '/demo/workbench', 'workbench'), 'c')
})

test('agent names match the Herdr name pattern', () => {
  for (let index = 1; index <= 8; index++) {
    const name = agentInstanceName('claude-code', index)
    assert.match(name, /^[a-z][a-z0-9_-]{0,31}$/)
    assert.ok(name.length <= 32)
  }
})

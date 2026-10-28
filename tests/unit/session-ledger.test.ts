import { test } from 'node:test'
import assert from 'node:assert/strict'
import { WorkbenchRuntime, MemoryStorage, MemoryAudit } from '@workbench/core'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import { testPrincipal } from '@workbench/testkit'
import { createHerdrModule, herdrManifest } from '../../modules/herdr/src/index.ts'
import { connectionConfigSchema } from '../../modules/herdr/src/contracts/config.ts'
import { catalog, type ResourceRef } from '../../modules/herdr/src/contracts/index.ts'
import { emptyLedger, mergeEntries } from '../../modules/herdr/src/application/session-ledger.ts'
import type { HerdrPort } from '../../modules/herdr/src/infrastructure/herdr-api/client.ts'
import type { SessionSnapshot } from '../../modules/herdr/src/infrastructure/herdr-api/protocol.generated.ts'

const raw = () => ({version:'0.9.3',protocol:22,agents:[],layouts:[],
  workspaces:[{workspace_id:'w1',label:'Workbench',pane_count:1,tab_count:1}],
  tabs:[{workspace_id:'w1',tab_id:'w1:t1',label:'Main'}],
  panes:[{pane_id:'w1:p1',workspace_id:'w1',tab_id:'w1:t1',terminal_id:'term-a',revision:1,agent_status:'working',agent:'claude',label:'API'}],
} as unknown as SessionSnapshot)

function principal(conversationId: string, clientId: string): Principal {
  return {...testPrincipal(['platform.read',...herdrManifest.capabilities], clientId), conversationId}
}

async function boot(storage = new MemoryStorage()) {
  const port: HerdrPort = {identity: async () => 'socket-a', snapshot: async () => raw(), request: async () => ({}), subscribe: async () => () => {}}
  const runtime = new WorkbenchRuntime({storage, audit: new MemoryAudit()})
  runtime.register(createHerdrModule(connectionConfigSchema.parse({socketPath:'/tmp/herdr.sock',rootDirectory:'/tmp',terminal:{enabled:false}}), {port}))
  await runtime.startAll()
  return runtime
}

async function invoke(runtime: WorkbenchRuntime, operation: 'herdr.snapshot' | 'herdr.session.resources' | 'herdr.session.record', input: Json, who: Principal) {
  const response = await runtime.invoke({operation, input, requestId: crypto.randomUUID()}, who)
  if (!response.ok) throw new WorkbenchError(response.error.code)
  return catalog[operation].output.parse(response.data)
}

test('ledger keeps a bounded history and drops closed rows first', () => {
  const ref = (id: string): ResourceRef => ({connectionId:'local',session:'default',epoch:'e',kind:'pane',id,instance:'i'})
  const drafts = Array.from({length: 241}, (_, index) => ({ref: ref('p'+index), role: 'terminal' as const, origin: 'tool' as const, operation: 'herdr.pane.split', requestId: 'r'+index, ...index < 5 ? {lastSeen: {status: 'closed' as const, at: index}} : {}}))
  const ledger = mergeEntries(emptyLedger('session-a'), drafts, 10)
  assert.equal(ledger.entries.length, 240)
  assert.equal(ledger.entries.some(entry => entry.ref.id === 'p0'), false)
  assert.equal(ledger.entries.some(entry => entry.ref.id === 'p5'), true)
})

test('session ledger is persistent, conversation-scoped, and folds subagent children under the parent', async () => {
  const storage = new MemoryStorage()
  const runtime = await boot(storage)
  const parent = principal('session-a', 'agent-a')
  const child = principal('session-child', 'agent-child')
  const other = principal('session-b', 'agent-b')
  try {
    const snapshot = await invoke(runtime, 'herdr.snapshot', {}, parent)
    if (!('panes' in snapshot)) throw new Error('snapshot')
    const pane = snapshot.panes[0]!.ref
    await invoke(runtime, 'herdr.session.record', {conversationId:'session-a', entries:[{ref:pane, role:'agent', origin:'tool', operation:'herdr.agent.start', requestId:'tool-1', agentKind:'claude', label:'API'}]}, parent)
    await invoke(runtime, 'herdr.session.record', {conversationId:'session-child', parentConversationId:'session-a', entries:[{ref:pane, role:'terminal', origin:'tool', operation:'herdr.pane.split', requestId:'tool-2', label:'API'}]}, child)
    const tree = await invoke(runtime, 'herdr.session.resources', {conversationId:'session-a'}, parent)
    if (!('nodes' in tree)) throw new Error('tree')
    assert.deepEqual(tree.nodes.map(node => node.conversationId), ['session-a', 'session-child'])
    assert.equal(tree.nodes[0]!.entries[0]!.presence, 'running')
    assert.equal(tree.nodes[0]!.entries[0]!.origin, 'tool')
    assert.equal(tree.nodes[1]!.parentConversationId, 'session-a')
    await assert.rejects(invoke(runtime, 'herdr.session.resources', {conversationId:'session-a'}, other), {code:'FORBIDDEN'})
    await assert.rejects(invoke(runtime, 'herdr.session.record', {conversationId:'session-a', entries:[{ref:pane, role:'terminal', origin:'ui', operation:'herdr.pane.split', requestId:'nope'}]}, other), {code:'FORBIDDEN'})
  } finally { await runtime.dispose() }
  const restarted = await boot(storage)
  try {
    const tree = await invoke(restarted, 'herdr.session.resources', {conversationId:'session-a'}, principal('session-a', 'agent-a-again'))
    if (!('nodes' in tree)) throw new Error('tree')
    assert.equal(tree.nodes.length, 2)
    assert.equal(tree.nodes[0]!.entries[0]!.label, 'API')
    assert.equal(tree.nodes[1]!.conversationId, 'session-child')
  } finally { await restarted.dispose() }
})

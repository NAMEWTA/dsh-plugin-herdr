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

test('creating from the UI records the shell; a create without origin does not', async () => {
  let created: string | null = null
  const base = {version:'0.9.3', protocol:22, agents:[], layouts:[]}
  const port: HerdrPort = {
    identity: async () => 'socket-a',
    snapshot: async () => ({...base, workspaces: created ? [{workspace_id:created, label:'demo', pane_count:1, tab_count:1}] : [], tabs: created ? [{workspace_id:created, tab_id:created+':t1', label:'1'}] : [], panes: created ? [{pane_id:created+':p1', workspace_id:created, tab_id:created+':t1', terminal_id:'term-ui', revision:1, agent_status:'unknown', label:'Shell', title:''}] : []}) as unknown as SessionSnapshot,
    request: async method => {
      if (method !== 'workspace.create') return {}
      created = created === 'w-ui' ? 'w-tool' : 'w-ui'
      return {workspace:{workspace_id:created}, root_pane:{pane_id:created+':p1'}}
    },
    subscribe: async () => () => {},
  }
  const runtime = new WorkbenchRuntime({storage: new MemoryStorage(), audit: new MemoryAudit()})
  runtime.register(createHerdrModule(connectionConfigSchema.parse({socketPath:'/tmp/herdr.sock', rootDirectory:'/tmp', terminal:{enabled:false}}), {port}))
  await runtime.startAll()
  const ui = principal('session-ui', 'browser-ui')
  const tool = principal('session-tool', 'agent-tool')
  try {
    const createdUi = await runtime.invoke({operation:'herdr.conversation.create', input:{conversationId:'session-ui', label:'demo', cwd:'/tmp', confirmed:true, origin:'ui'}, requestId:crypto.randomUUID()}, ui)
    if (!createdUi.ok) throw new WorkbenchError(createdUi.error.code)
    const resources = await runtime.invoke({operation:'herdr.session.resources', input:{conversationId:'session-ui'}, requestId:crypto.randomUUID()}, ui)
    if (!resources.ok) throw new WorkbenchError(resources.error.code)
    const tree = catalog['herdr.session.resources'].output.parse(resources.data)
    const terminal = tree.nodes[0]!.entries.find(entry => entry.role === 'terminal')
    assert.equal(terminal?.origin, 'ui')
    assert.equal(terminal?.operation, 'herdr.conversation.create')
    const snapshot = await runtime.invoke({operation:'herdr.snapshot', input:{}, requestId:crypto.randomUUID()}, ui)
    if (!snapshot.ok) throw new WorkbenchError(snapshot.error.code)
    const snap = catalog['herdr.snapshot'].output.parse(snapshot.data)
    if (!('panes' in snap)) throw new Error('snapshot')
    assert.equal(snap.panes[0]!.state, 'unknown')
    const createdTool = await runtime.invoke({operation:'herdr.conversation.create', input:{conversationId:'session-tool', label:'demo', cwd:'/tmp', confirmed:true}, requestId:crypto.randomUUID()}, tool)
    if (!createdTool.ok) throw new WorkbenchError(createdTool.error.code)
    const plain = await runtime.invoke({operation:'herdr.session.resources', input:{conversationId:'session-tool'}, requestId:crypto.randomUUID()}, tool)
    if (!plain.ok) throw new WorkbenchError(plain.error.code)
    const untouched = catalog['herdr.session.resources'].output.parse(plain.data)
    assert.equal(untouched.nodes[0]!.entries.length, 0)
  } finally { await runtime.dispose() }
})

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

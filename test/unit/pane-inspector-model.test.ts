import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { copyInspectorCommand, enrichInspectedPane, sameInspectorEndpoint, mergeInspectorDetails, findInspectedPane, inspectorCommands, lookupPaneBinding, shellQuote } from '../../src/web/pane-inspector-model.ts'
import type { HerdrDashboardSnapshot } from '../../src/web/dashboard-types.ts'
import type { HerdrEnvironmentReport } from '../../src/core/environment.ts'

const report = {
  supported: true, cli: { state: 'available', path: '/opt/herdr/bin/herdr' },
  connection: { socketPath: '/tmp/actual.sock', session: 'different-session' },
} as unknown as HerdrEnvironmentReport
const snapshot = {
  workspaces: [{ workspace_id: 'w1', checkout_path_base: '/checkout', panes: [{ pane_id: 'p1', label: null, kind: 'unknown', status: 'idle' }] }],
} as unknown as HerdrDashboardSnapshot

test('selection includes unbound/plain panes and never fabricates IDs or pane cwd', () => {
  const selected = findInspectedPane(snapshot, 'p1')!
  assert.equal(selected.pane.pane_id, 'p1')
  assert.equal(selected.workspace.workspace_id, 'w1')
  assert.equal(selected.cwd, null)
  assert.equal(selected.tabId, null)
})
test('selection disappears when removed, hidden, or its workspace closes', () => {
  assert.equal(findInspectedPane(snapshot, 'gone'), null)
  assert.equal(findInspectedPane(null, 'p1'), null)
  assert.equal(findInspectedPane(snapshot, 'p1', new Set(['p1'])), null)
  assert.equal(findInspectedPane(snapshot, 'p1', new Set(), new Set(['w1'])), null)
})
test('cwd comes from matching pane and workspace, never workspace checkout', () => {
  const topology = { workspaces: [], tabs: [], panes: [{ pane_id: 'p1', workspace_id: 'w1', focused: false, cwd: '/shell', foreground_cwd: '/foreground', tab_id: 't1' }] }
  assert.equal(findInspectedPane(snapshot, 'p1', undefined, undefined, topology)?.cwd, '/foreground')
  assert.equal(findInspectedPane(snapshot, 'p1', undefined, undefined, topology)?.tabId, 't1')
  topology.panes[0]!.workspace_id = 'foreign'
  assert.equal(findInspectedPane(snapshot, 'p1', undefined, undefined, topology)?.cwd, null)
})
test('commands pin socket and executable; never add overriding --session', () => {
  const commands = inspectorCommands(report, 'p1')
  assert.equal(commands.length, 6)
  for (const { command } of commands) {
    assert.ok(command.startsWith("HERDR_SOCKET_PATH='/tmp/actual.sock' '/opt/herdr/bin/herdr' "))
    assert.ok(!command.includes('--session'))
  }
  assert.ok(commands.some(c => c.command.endsWith("pane layout --pane 'p1'")))
  assert.ok(commands.some(c => c.command.endsWith("pane process-info --pane 'p1'")))
  assert.ok(commands.some(c => c.command.endsWith("pane read 'p1' --source visible --lines 80 --format text")))
  assert.ok(commands.some(c => c.command.endsWith("agent get 'p1'")))
})
test('named session is explicit only without a socket; no blind defaults', () => {
  const named = { ...report, connection: { ...report.connection, socketPath: null, session: 'named' } }
  assert.ok(inspectorCommands(named, 'p1')[0]?.command.startsWith("'/opt/herdr/bin/herdr' --session 'named' "))
  assert.deepEqual(inspectorCommands({ ...named, connection: { ...named.connection, session: null } }, 'p1'), [])
  assert.deepEqual(inspectorCommands(null, 'p1'), [])
  assert.deepEqual(inspectorCommands({ ...report, supported: false }, 'p1'), [])
  assert.deepEqual(inspectorCommands({ ...report, cli: { ...report.cli, state: 'missing' } }, 'p1'), [])
  assert.deepEqual(inspectorCommands(report, ''), [])
})
test('all dynamic shell arguments are literal, including quote/dollar/backtick/semicolon', () => {
  const value = "space ' quote $HOME `id`; $(id) & --session fake"
  assert.equal(execFileSync('/bin/sh', ['-c', `printf '%s' ${shellQuote(value)}`], { encoding: 'utf8' }), value)
  const escaped = inspectorCommands({ ...report, cli: { ...report.cli, path: value }, connection: { ...report.connection, socketPath: value } }, value)
  assert.ok(escaped[1]?.command.endsWith(`pane get ${shellQuote(value)}`))
  assert.ok(escaped[1]?.command.startsWith(`HERDR_SOCKET_PATH=${shellQuote(value)} ${shellQuote(value)} `))
  for (const bad of ['line\nbreak', '\0', '\r', '\x1b']) {
    assert.throws(() => shellQuote(bad))
    assert.deepEqual(inspectorCommands(report, bad), [])
  }
})
test('binding lookup distinguishes confirmed, unbound and failed; no inferred session', async () => {
  assert.deepEqual(await lookupPaneBinding(async () => ({ session_id: 's1' })), { state: 'bound', sessionId: 's1' })
  for (const result of [null, {}, { session_id: null }, { session_id: '' }, { session_id: ' ' }]) {
    assert.deepEqual(await lookupPaneBinding(async () => result), { state: 'unbound' })
  }
  assert.deepEqual(await lookupPaneBinding(async () => { throw Error('offline') }), { state: 'error' })
})
test('clipboard success, rejection, and missing browser permission are handled', async () => {
  let copied = ''
  assert.equal(await copyInspectorCommand('literal command', { writeText: async text => { copied = text } }), true)
  assert.equal(copied, 'literal command')
  assert.equal(await copyInspectorCommand('x', { writeText: async () => { throw Error('denied') } }), false)
  assert.equal(await copyInspectorCommand('x'), false)
})

test('commands disappear if environment no longer matches the selected snapshot endpoint', () => {
  assert.deepEqual(inspectorCommands(report, 'p1', { socket: '/other.sock', session: 'different-session' }), [])
  assert.deepEqual(inspectorCommands(report, 'p1', { socket: null, session: null }), [])
  assert.equal(inspectorCommands(report, 'p1', { socket: '/tmp/actual.sock', session: 'label-only' }).length, 6)
})

test('real dashboard basename is display-only; all-scope full socket enables matching commands and metadata', () => {
  const dashboard = { ...snapshot, server: { socket: 'actual.sock', session: 'different-session' } } as unknown as HerdrDashboardSnapshot
  const selected = findInspectedPane(dashboard, 'p1')!
  assert.equal(selected.socket, null)
  const status = {
    connected: true, agents: [], updated_at: 1,
    server: { socket: '/tmp/actual.sock', session: 'different-session', status: 'running', running: true, version: '0.9.0', protocol: 22, checked_at: 1 },
    topology: { workspaces: [], tabs: [], panes: [{ pane_id: 'p1', workspace_id: 'w1', focused: false, cwd: '/real-cwd', tab_id: 't9' }] },
  }
  const details = enrichInspectedPane(selected, status, report)!
  assert.equal(details.cwd, '/real-cwd')
  assert.equal(details.tabId, 't9')
  assert.equal(details.socket, '/tmp/actual.sock')
  assert.equal(inspectorCommands(report, 'p1', details).length, 6)
  assert.equal(enrichInspectedPane(selected, { ...status, connected: false }, report), null)
  assert.equal(enrichInspectedPane(selected, { ...status, stale: true }, report), null)
  assert.equal(enrichInspectedPane(selected, { ...status, topology: { ...status.topology, panes: [] } }, report), null)
  assert.equal(enrichInspectedPane(selected, { ...status, server: { ...status.server, socket: '/other/actual.sock' } }, report), null)
  assert.equal(sameInspectorEndpoint(details, { ...details, socket: '/other/actual.sock' }), false)
})

test('session-only identity never accepts a different full socket even with matching session labels', () => {
  const selected = findInspectedPane(snapshot, 'p1')!
  const target = { socket: null, session: report.connection.session }
  assert.deepEqual(inspectorCommands(report, 'p1', target), [])
  const status = { connected: true, server: target, topology: { panes: [{ pane_id: 'p1', workspace_id: 'w1' }] } }
  assert.equal(enrichInspectedPane(selected, status as never, report), null)
})
test('live pane status and labels update without discarding verified detail metadata', () => {
  const selected = findInspectedPane(snapshot, 'p1')!
  const details = { ...selected, socket: '/tmp/actual.sock', cwd: '/verified', tabId: 't9' }
  const latest = { ...selected, pane: { ...selected.pane, status: 'done', label: 'renamed' } }
  const merged = mergeInspectorDetails(latest, details)
  assert.equal(merged.pane.status, 'done')
  assert.equal(merged.pane.label, 'renamed')
  assert.equal(merged.cwd, '/verified')
  assert.equal(merged.socket, '/tmp/actual.sock')
})

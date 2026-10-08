// Defensive snapshot normalization: remote payloads are `unknown`; views must
// never read undefined arrays (dashboard crashed on snap.workspaces.flatMap).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectDashboardAgents,
  deriveMarkerServerState,
  filterGroupsToSession,
  normalizeDashboardSnapshot,
  normalizeStatusSnapshot,
} from '../../src/web/logic.ts'

const fixtures = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'remote-p22')
const load = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8')).value as Record<string, unknown>

test('normalizeDashboardSnapshot: non-objects are null, partial objects get complete structure', () => {
  for (const value of [undefined, null, 1, 'x', []]) assert.equal(normalizeDashboardSnapshot(value), null)
  const snap = normalizeDashboardSnapshot({ workspaces: [{ workspace_id: 'w1', agents: null }, { label: 'no id' }, null] })!
  assert.equal(snap.workspaces.length, 1)
  assert.deepEqual(snap.workspaces[0]!.agents, [])
  assert.deepEqual(snap.workspaces[0]!.panes, [])
  assert.equal(snap.summary.workspaces, 1)
  assert.deepEqual(snap.summary.agents_by_status, {})
  assert.equal(snap.server.running, false)
  assert.equal(snap.process.available, false)
  assert.equal(snap.connection.connected, false)
  assert.deepEqual(collectDashboardAgents(snap.workspaces), [])
  assert.deepEqual(collectDashboardAgents(undefined), [])
})

test('normalizeDashboardSnapshot keeps the real protocol-22 snapshot intact', () => {
  const raw = load('dashboard.result.json')
  const snap = normalizeDashboardSnapshot(raw)!
  assert.deepEqual(snap.summary, raw.summary)
  assert.deepEqual(snap.server, raw.server)
  assert.deepEqual(snap.process, raw.process)
  assert.deepEqual(snap.workspaces, raw.workspaces)
  assert.deepEqual(normalizeDashboardSnapshot(snap), snap, 'idempotent')
  assert.deepEqual(collectDashboardAgents(snap.workspaces).map(a => a.name), ['rvp-impl-ncc', 'rvp-impl-ssox'])
})

test('normalizeStatusSnapshot: arrays always present; real protocol-22 status intact', () => {
  assert.equal(normalizeStatusSnapshot(undefined), null)
  const partial = normalizeStatusSnapshot({ topology: { panes: null } })!
  assert.deepEqual(partial.agents, [])
  assert.deepEqual(partial.topology, { workspaces: [], tabs: [], panes: [] })
  assert.equal(normalizeStatusSnapshot({})!.topology, undefined)
  const raw = load('status.result.json')
  const snap = normalizeStatusSnapshot(raw)!
  assert.deepEqual(snap.agents, raw.agents)
  assert.deepEqual(snap.topology, raw.topology)
  assert.equal(snap.server?.protocol, 22)
  assert.equal(deriveMarkerServerState(snap), 'running')
})

test('filterGroupsToSession tolerates a topology without panes', () => {
  assert.deepEqual(filterGroupsToSession({ workspaces: [] } as never, 'w1:p1'), [])
  const topology = normalizeStatusSnapshot(load('status.result.json'))!.topology
  const groups = filterGroupsToSession(topology, 'w9:p1')
  assert.equal(groups.length, 1)
  assert.equal(groups[0]!.workspace.workspace_id, 'w9')
})

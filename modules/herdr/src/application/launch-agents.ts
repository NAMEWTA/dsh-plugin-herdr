import { randomUUID } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { z } from 'zod'
import { WorkbenchError, type Json } from '@workbench/contracts'
import type { OperationContext, ScopedStorage } from '@workbench/sdk'
import { resourceSchema, type Pane, type ResourceRef } from '../contracts/index.ts'
import { agentInstanceName, planLaunch, type AgentCommand } from '../domain/agent-launch.ts'
import { sameResource } from '../domain/selectors.ts'
import type { ConnectionConfig } from '../contracts/config.ts'
import type { HerdrPort } from '../infrastructure/herdr-api/client.ts'
import type { HerdrReadModel } from './read-model.ts'
import { recordSession } from './session-ledger.ts'

const created = z.object({
  tab: z.object({tab_id: z.string()}).optional(),
  root_pane: z.object({pane_id: z.string()}).optional(),
  pane: z.object({pane_id: z.string()}).optional(),
}).passthrough()

export interface StartedAgent {
  kind: AgentCommand
  command: AgentCommand
  name: string
  paneId: string
  terminalId: string
  tabId: string
  workspaceId: string
  ref: ResourceRef
}

export async function launchAgents(deps: {
  config: ConnectionConfig
  port: HerdrPort
  model: HerdrReadModel
  storage: ScopedStorage
  context: OperationContext
  reserved: Set<string>
  bindingKey: string
  cwdKey: string
}, input: {conversationId: string; agents: readonly {kind: string; count: number}[]; parentConversationId?: string}): Promise<{send: false; workspaceId: string; cwd: string; started: StartedAgent[]}> {
  const {context} = deps
  if (context.principal.conversationId && context.principal.conversationId !== input.conversationId) {
    throw new WorkbenchError('FORBIDDEN', 'This call targets a different conversation. Agents start only in the workspace bound to the current conversation.')
  }
  if (!context.principal.connectionIds.has(deps.config.id)) {
    throw new WorkbenchError('FORBIDDEN', 'This identity is not allowed to use the local Herdr connection.')
  }
  if (!context.principal.capabilities.has('herdr.manage')) {
    throw new WorkbenchError('FORBIDDEN', 'Starting agents creates shell panes and requires herdr.manage in addition to herdr.control. This identity cannot create them.')
  }
  const planned = planLaunch(input.agents, deps.config.allowedAgentKinds)
  const stored = await deps.storage.read<Json>(deps.bindingKey)
  const binding = resourceSchema.nullable().safeParse(stored?.value ?? null)
  if (!binding.success) throw new WorkbenchError('STORAGE_UNAVAILABLE', 'The stored conversation binding could not be read.')
  if (!binding.data) {
    throw new WorkbenchError('INVALID_REQUEST', 'This conversation has no Herdr workspace yet. Retry after the session project path is bound. The focused workspace is not used.')
  }
  const snap = await deps.model.refresh()
  if (snap.connection !== 'online' || snap.stale) {
    throw new WorkbenchError(snap.connection === 'online' ? 'STALE_SNAPSHOT' : 'CONNECTION_UNAVAILABLE', 'Herdr is not ready. Retry the launch. No prompt was sent.')
  }
  const workspace = snap.workspaces.find(item => sameResource(item.ref, binding.data!))
  if (!workspace) throw new WorkbenchError('RESOURCE_CHANGED', 'The bound workspace is no longer in the Herdr snapshot. Retry so the session project path can be bound again. The focused workspace is not used.')
  if (workspace.ownership === 'external') {
    throw new WorkbenchError('OWNERSHIP_REQUIRED', 'The bound workspace is still external. Adopt it, or bind the session project path, before starting agents.')
  }
  const cwdRow = await deps.storage.read<Json>(deps.cwdKey)
  const started: StartedAgent[] = []
  let ordinal = 0
  try {
    for (const group of planned) {
      for (let index = 0; index < group.count; index++) {
        ordinal += 1
        const agent = await startOne(deps, workspace.ref, group.kind, group.command, ordinal)
        started.push(agent)
      }
    }
  } catch (error) {
    if (started.length) await remember(deps.storage, input, started).catch(() => {})
    const names = started.map(agent => agent.name).join(', ')
    const reason = error instanceof Error ? error.message : 'unknown failure'
    if (names) {
      throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN', `Started ${names} before a later start failed (${reason}). Those agents are already running and were recorded; do not start them again. No prompt was sent.`)
    }
    throw error
  }
  await remember(deps.storage, input, started)
  const cwd = typeof cwdRow?.value === 'string' ? cwdRow.value : workspace.ref.id
  return {send: false, workspaceId: workspace.ref.id, cwd, started}
}

async function startOne(deps: {port: HerdrPort; model: HerdrReadModel; context: OperationContext; reserved: Set<string>}, workspace: ResourceRef, kind: AgentCommand, command: AgentCommand, ordinal: number): Promise<StartedAgent> {
  let pane = await allocate(deps, workspace)
  let name = agentInstanceName(kind, ordinal)
  let last = 'the pane was not an available shell'
  for (let attempt = 0; attempt < 12; attempt++) {
    try {
      await deps.model.assert(pane.ref, true)
      await deps.port.request('agent.start', {pane_id: pane.ref.id, kind, name, args: [], timeout_ms: 8000}, deps.context.signal, true, 20000)
      await deps.model.refresh()
      const fresh = deps.model.snapshot().panes.find(item => item.ref.id === pane.ref.id) ?? pane
      return {kind, command, name, paneId: fresh.ref.id, terminalId: fresh.terminalId, tabId: fresh.tabId, workspaceId: fresh.workspaceId, ref: fresh.ref}
    } catch (error) {
      last = error instanceof Error ? error.message : last
      const retryable = /agent_pane_busy|agent_pane_unavailable|agent_name_taken|not an available shell|no live terminal/.test(last)
      if (!retryable || attempt === 11) break
      if (last.includes('agent_name_taken')) name = agentInstanceName(kind, ordinal)
      await delay(400)
      // A new shell can report busy until it is interactive. Keep the reserved pane, then replace it.
      if (attempt >= 7) pane = await allocate(deps, workspace)
    }
  }
  throw new WorkbenchError('INVALID_REQUEST', `Could not start ${kind} (${command}) on a free shell pane: ${last}. field kind must be codex or claude, count an integer from 1 to 8, and send must be false. No prompt was sent.`)
}

async function allocate(deps: {port: HerdrPort; model: HerdrReadModel; context: OperationContext; reserved: Set<string>}, workspace: ResourceRef): Promise<Pane> {
  const free = takeFree(deps, workspace.id)
  if (free) return free
  await deps.model.assert(workspace, true)
  const response = await deps.port.request('tab.create', {workspace_id: workspace.id, label: 'agent', focus: false}, deps.context.signal, true)
  const parsed = created.safeParse(response)
  const paneId = parsed.success ? parsed.data.root_pane?.pane_id : undefined
  const tabId = parsed.success ? parsed.data.tab?.tab_id : undefined
  if (!paneId || !tabId) throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN', 'tab.create did not return a shell pane id, so no agent was started.')
  await deps.model.refresh()
  const tab = deps.model.find('tab', tabId)
  const paneRef = deps.model.find('pane', paneId)
  deps.model.mark(tab, 'created')
  deps.model.mark(paneRef, 'created')
  deps.reserved.add(paneId)
  await deps.model.refresh()
  const pane = deps.model.snapshot().panes.find(item => item.ref.id === paneId)
  if (!pane) throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN', 'The new shell pane was not in the Herdr snapshot, so no agent was started on it.')
  return pane
}

function takeFree(deps: {model: HerdrReadModel; reserved: Set<string>}, workspaceId: string): Pane | undefined {
  const pane = deps.model.snapshot().panes.find(item => item.workspaceId === workspaceId && !item.agent && !deps.reserved.has(item.ref.id) && (item.ownership === 'created' || item.ownership === 'adopted'))
  if (!pane) return undefined
  deps.reserved.add(pane.ref.id)
  return pane
}

async function remember(storage: ScopedStorage, input: {conversationId: string; parentConversationId?: string}, started: readonly StartedAgent[]): Promise<void> {
  if (!started.length) return
  await recordSession(storage, {
    conversationId: input.conversationId,
    ...input.parentConversationId ? {parentConversationId: input.parentConversationId} : {},
    entries: started.map(agent => ({
      ref: agent.ref, role: 'agent' as const, origin: 'tool' as const, operation: 'herdr.agents.launch',
      requestId: randomUUID(), agentKind: agent.kind, label: agent.name,
    })),
  })
}

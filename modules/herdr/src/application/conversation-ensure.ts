import { randomUUID } from 'node:crypto'
import { basename } from 'node:path'
import { realpath } from 'node:fs/promises'
import { WorkbenchError, type Json } from '@workbench/contracts'
import type { OperationContext, ScopedStorage } from '@workbench/sdk'
import { resourceSchema, type HerdrSnapshot, type ResourceRef } from '../contracts/index.ts'
import { selectWorkspaceForCwd } from '../domain/agent-launch.ts'
import { sameResource } from '../domain/selectors.ts'
import type { ConnectionConfig } from '../contracts/config.ts'
import { workspaceDirectory } from '../infrastructure/environment/service.ts'
import type { HerdrReadModel } from './read-model.ts'
import { loadSessionTree, recordSession } from './session-ledger.ts'

export interface EnsureRequest {
  conversationId: string
  cwd: string
  label?: string
  origin: 'tool' | 'ui'
}

export interface EnsureResult {
  conversationId: string
  ref: ResourceRef
  cwd: string
  created: boolean
  reused: boolean
  origin: 'tool' | 'ui' | 'bound'
}

export async function ensureConversation(deps: {
  config: ConnectionConfig
  model: HerdrReadModel
  storage: ScopedStorage
  context: OperationContext
  bindingKey: string
  cwdKey: string
  createWorkspace: (input: {label: string; cwd: string}, context: OperationContext) => Promise<ResourceRef>
  emit: () => void
}, input: EnsureRequest): Promise<EnsureResult> {
  const {context} = deps
  if (context.principal.conversationId && context.principal.conversationId !== input.conversationId) {
    throw new WorkbenchError('FORBIDDEN', 'This call targets a different conversation. Herdr tools only bind the conversation that is executing them.')
  }
  if (!context.principal.connectionIds.has(deps.config.id)) {
    throw new WorkbenchError('FORBIDDEN', 'This identity is not allowed to use the local Herdr connection.')
  }
  const snap = await readySnapshot(deps.model)
  const stored = await deps.storage.read<Json>(deps.bindingKey)
  const current = resourceSchema.nullable().safeParse(stored?.value ?? null)
  if (!current.success) throw new WorkbenchError('STORAGE_UNAVAILABLE', 'The stored conversation binding could not be read.')
  if (current.data) {
    const live = snap.workspaces.find(workspace => sameResource(workspace.ref, current.data!))
    if (live) {
      const cwd = await readStoredCwd(deps.storage, deps.cwdKey)
      return {conversationId: input.conversationId, ref: live.ref, cwd: cwd ?? input.cwd, created: false, reused: false, origin: await ledgerOrigin(deps.storage, input.conversationId, live.ref)}
    }
  }
  const cwd = await approvedDirectory(deps.config.rootDirectory, input.cwd)
  const chosen = await matchWorkspace(deps.model.snapshot(), cwd)
  let ref: ResourceRef
  let created = false
  let reused = false
  let origin: EnsureResult['origin']
  if (chosen) {
    adopt(deps.model, chosen)
    const workspace = deps.model.snapshot().workspaces.find(item => item.ref.id === chosen)
    if (!workspace) throw new WorkbenchError('RESOURCE_CHANGED', 'The matching workspace disappeared before it could be bound. Retry; the focused workspace is not used.')
    ref = workspace.ref
    reused = true
    origin = 'bound'
  } else {
    ref = await deps.createWorkspace({label: safeLabel(input.label, cwd), cwd}, context)
    created = true
    origin = input.origin
  }
  await persist(deps, stored?.version ?? null, ref, cwd)
  try { await remember(deps.storage, deps.model, input.conversationId, ref.id, origin) }
  catch { /* The binding is stored. A later record can fill the ledger. */ }
  deps.emit()
  return {conversationId: input.conversationId, ref, cwd, created, reused, origin}
}

async function readySnapshot(model: HerdrReadModel): Promise<HerdrSnapshot> {
  const snap = await model.refresh()
  if (snap.connection !== 'online' || snap.stale) {
    throw new WorkbenchError(snap.connection === 'online' ? 'STALE_SNAPSHOT' : 'CONNECTION_UNAVAILABLE', 'Herdr is not ready, so the session workspace cannot be bound yet. Retry this call. The focused workspace is not used.')
  }
  return snap
}

async function approvedDirectory(root: string, input: string): Promise<string> {
  try { return await workspaceDirectory(root, input) }
  catch (error) {
    if (error instanceof WorkbenchError && error.code === 'FORBIDDEN') {
      throw new WorkbenchError('FORBIDDEN', `The session project path is outside the approved root (${root}), so it was not bound. The focused workspace is not used.`)
    }
    if (error instanceof WorkbenchError && error.code === 'INVALID_REQUEST') {
      throw new WorkbenchError('INVALID_REQUEST', `The session project path ${JSON.stringify(input)} is not an existing absolute directory, so it cannot be bound. Open the session in a project directory. The focused workspace is not used.`)
    }
    throw error
  }
}

async function matchWorkspace(snapshot: HerdrSnapshot, cwd: string): Promise<string | null> {
  const candidates = []
  for (const workspace of snapshot.workspaces) {
    const cwds: string[] = []
    for (const pane of snapshot.panes) {
      if (pane.workspaceId !== workspace.ref.id || !pane.cwd) continue
      try { cwds.push(await realpath(pane.cwd)) } catch { /* A missing pane cwd is not a match. */ }
    }
    candidates.push({id: workspace.ref.id, label: workspace.label, cwds})
  }
  return selectWorkspaceForCwd(candidates, cwd, basename(cwd))
}

function adopt(model: HerdrReadModel, workspaceId: string): void {
  const snap = model.snapshot()
  const workspace = snap.workspaces.find(item => item.ref.id === workspaceId)
  if (!workspace) throw new WorkbenchError('RESOURCE_CHANGED', 'The matching workspace disappeared before it could be bound. Retry; the focused workspace is not used.')
  if (workspace.ownership === 'external') model.mark(workspace.ref, 'adopted')
  for (const tab of snap.tabs) if (tab.workspaceId === workspaceId && tab.ownership === 'external') model.mark(tab.ref, 'adopted')
  for (const pane of snap.panes) if (pane.workspaceId === workspaceId && pane.ownership === 'external') model.mark(pane.ref, 'adopted')
}

async function persist(deps: {storage: ScopedStorage; bindingKey: string; cwdKey: string; context: OperationContext}, expectedVersion: number | null, ref: ResourceRef, cwd: string): Promise<void> {
  try {
    if (deps.context.signal.aborted) throw new WorkbenchError('CANCELLED', 'Binding was cancelled after the workspace was created. Retry before starting agents.')
    const again = await deps.storage.read<Json>(deps.bindingKey)
    await deps.storage.write(deps.bindingKey, ref, again?.version ?? expectedVersion)
    const path = await deps.storage.read<Json>(deps.cwdKey)
    await deps.storage.write(deps.cwdKey, cwd, path?.version ?? null)
  } catch (error) {
    if (error instanceof WorkbenchError && error.code === 'CANCELLED') throw error
    throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN', 'The workspace exists but the conversation binding could not be saved. Retry before starting agents.')
  }
}

async function readStoredCwd(storage: ScopedStorage, key: string): Promise<string | null> {
  const stored = await storage.read<Json>(key)
  return typeof stored?.value === 'string' && stored.value.length > 0 ? stored.value : null
}

async function ledgerOrigin(storage: ScopedStorage, conversationId: string, ref: ResourceRef): Promise<EnsureResult['origin']> {
  try {
    const ledger = (await loadSessionTree(storage, conversationId))[0]
    return ledger?.entries.find(entry => entry.role === 'workspace' && sameResource(entry.ref, ref))?.origin ?? 'bound'
  } catch { return 'bound' }
}

function safeLabel(label: string | undefined, cwd: string): string {
  const raw = (label?.trim() || basename(cwd) || 'workspace').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
  return raw || 'workspace'
}

async function remember(storage: ScopedStorage, model: HerdrReadModel, conversationId: string, workspaceId: string, origin: EnsureResult['origin']): Promise<void> {
  const snap = model.snapshot()
  const workspace = snap.workspaces.find(item => item.ref.id === workspaceId)
  if (!workspace) return
  const tabs = snap.tabs.filter(item => item.workspaceId === workspaceId)
  const panes = snap.panes.filter(item => item.workspaceId === workspaceId)
  const requestId = () => randomUUID()
  await recordSession(storage, {conversationId, entries: [
    {ref: workspace.ref, role: 'workspace' as const, origin, operation: 'herdr.conversation.ensure', requestId: requestId(), label: workspace.label},
    ...tabs.map(item => ({ref: item.ref, role: 'tab' as const, origin, operation: 'herdr.conversation.ensure', requestId: requestId(), label: item.label})),
    ...panes.map(item => ({ref: item.ref, role: (item.agent ? 'agent' : 'terminal') as 'agent' | 'terminal', origin, operation: 'herdr.conversation.ensure', requestId: requestId(), ...item.agent ? {agentKind: item.agent} : {}, label: item.label})),
  ].slice(0, 24)})
}

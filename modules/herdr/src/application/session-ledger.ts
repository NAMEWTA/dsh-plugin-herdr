import { createHash } from 'node:crypto'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import type { ScopedStorage } from '@workbench/sdk'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import {
  sessionLedgerSchema, sessionResourcesSchema, type HerdrSnapshot, type LedgerEntry, type SessionLedger, type SessionResources,
} from '../contracts/index.ts'

const MAX_ENTRIES = 240
const MAX_BYTES = 900_000

/** Agents carry a server-derived conversation id and cannot read another session. Operators without one use the slot id. */
export function assertSessionAccess(principal: Principal, conversationId: string): void {
  if (principal.conversationId && principal.conversationId !== conversationId) throw new WorkbenchError('FORBIDDEN')
}

export function sessionStorageKey(conversationId: string): string {
  return 'session-' + createHash('sha256').update(conversationId).digest('hex')
}

export function emptyLedger(conversationId: string, parentConversationId?: string): SessionLedger {
  return {conversationId, ...parentConversationId ? {parentConversationId} : {}, childConversationIds: [], entries: []}
}

function entryKey(entry: {role: string; ref: LedgerEntry['ref']}): string {
  return entry.role + ':' + resourceKey(entry.ref)
}

/** Keep the first origin. Later writes refresh labels and presence. Closed rows are the first to leave when the cap is hit. */
export function mergeEntries(ledger: SessionLedger, drafts: readonly Omit<LedgerEntry,'createdAt'>[], now: number, parentConversationId?: string): SessionLedger {
  const entries = ledger.entries.map(entry => ({...entry}))
  for (const draft of drafts) {
    const key = entryKey(draft)
    const index = entries.findIndex(entry => entryKey(entry) === key)
    if (index >= 0) {
      const current = entries[index]!
      entries[index] = {
        ...current,
        ...draft.label ? {label: draft.label} : {},
        ...draft.agentKind ? {agentKind: draft.agentKind} : {},
        ...draft.toolCallId ? {toolCallId: draft.toolCallId} : {},
        ...draft.lastSeen ? {lastSeen: draft.lastSeen} : current.lastSeen ? {lastSeen: current.lastSeen} : {},
        operation: draft.operation,
        requestId: draft.requestId,
      }
    } else {
      entries.push({...draft, createdAt: now, ...draft.lastSeen ? {lastSeen: draft.lastSeen} : {}})
    }
  }
  const ranked = entries.map((entry, index) => ({entry, index}))
  const closed = (entry: LedgerEntry) => entry.lastSeen?.status === 'closed' || entry.lastSeen?.status === 'exited' || entry.lastSeen?.status === 'missing'
  while (ranked.length > MAX_ENTRIES) {
    const drop = ranked.findIndex(item => closed(item.entry))
    ranked.splice(drop >= 0 ? drop : 0, 1)
  }
  return sessionLedgerSchema.parse({
    conversationId: ledger.conversationId,
    ...parentConversationId || ledger.parentConversationId ? {parentConversationId: parentConversationId ?? ledger.parentConversationId} : {},
    childConversationIds: ledger.childConversationIds,
    entries: ranked.sort((a,b) => a.index - b.index).map(item => item.entry),
  })
}

export function projectResources(rootId: string, ledgers: readonly SessionLedger[], snapshot: HerdrSnapshot): SessionResources {
  const byId = new Map(ledgers.map(ledger => [ledger.conversationId, ledger]))
  const nodes: SessionResources['nodes'] = []
  const seen = new Set<string>()
  const visit = (id: string, parent: string | null, depth: number) => {
    if (seen.has(id) || depth > 4 || nodes.length >= 33) return
    seen.add(id)
    const ledger = byId.get(id) ?? emptyLedger(id)
    nodes.push({
      conversationId: id,
      parentConversationId: parent,
      entries: ledger.entries.map(entry => projectEntry(entry, snapshot)),
    })
    if (depth === 0 || ledger.conversationId !== rootId) {
      for (const child of ledger.childConversationIds) visit(child, id, depth + 1)
    }
  }
  visit(rootId, null, 0)
  return sessionResourcesSchema.parse({conversationId: rootId, nodes})
}

function projectEntry(entry: LedgerEntry, snapshot: HerdrSnapshot): SessionResources['nodes'][number]['entries'][number] {
  const pane = entry.ref.kind === 'pane' ? snapshot.panes.find(item => sameResource(item.ref, entry.ref)) : undefined
  const tab = entry.ref.kind === 'tab' ? snapshot.tabs.find(item => sameResource(item.ref, entry.ref)) : undefined
  const workspace = entry.ref.kind === 'workspace' ? snapshot.workspaces.find(item => sameResource(item.ref, entry.ref)) : undefined
  const present = Boolean(pane || tab || workspace)
  const presence = present ? 'running' as const : entry.lastSeen?.status === 'closed' || entry.lastSeen?.status === 'exited' ? entry.lastSeen.status : 'missing' as const
  const title = pane?.label || tab?.label || workspace?.label || entry.label || entry.ref.id
  const workspaceId = pane?.workspaceId ?? tab?.workspaceId ?? workspace?.ref.id ?? null
  const workspaceLabel = workspace?.label ?? (workspaceId ? snapshot.workspaces.find(item => item.ref.id === workspaceId)?.label ?? null : null)
  const tabId = pane?.tabId ?? (tab ? tab.ref.id : null)
  return {
    ref: entry.ref, role: entry.role, origin: entry.origin, operation: entry.operation, requestId: entry.requestId, createdAt: entry.createdAt,
    ...entry.agentKind ? {agentKind: entry.agentKind} : {},
    ...entry.label ? {label: entry.label} : {},
    ...entry.toolCallId ? {toolCallId: entry.toolCallId} : {},
    ...entry.lastSeen ? {lastSeen: entry.lastSeen} : {},
    presence, state: pane?.state ?? null, agent: pane?.agent ?? entry.agentKind ?? null, cwd: pane?.cwd ?? null, title, workspaceId, workspaceLabel, tabId,
  }
}

function parseLedger(value: unknown, conversationId: string): SessionLedger {
  const parsed = sessionLedgerSchema.safeParse(value)
  if (!parsed.success) throw new WorkbenchError('STORAGE_UNAVAILABLE')
  if (parsed.data.conversationId !== conversationId) throw new WorkbenchError('STORAGE_UNAVAILABLE')
  return parsed.data
}

async function readLedger(storage: ScopedStorage, conversationId: string): Promise<{version: number | null; ledger: SessionLedger}> {
  const stored = await storage.read<Json>(sessionStorageKey(conversationId))
  if (!stored) return {version: null, ledger: emptyLedger(conversationId)}
  return {version: stored.version, ledger: parseLedger(stored.value, conversationId)}
}

export async function loadSessionTree(storage: ScopedStorage, conversationId: string): Promise<SessionLedger[]> {
  const root = (await readLedger(storage, conversationId)).ledger
  const ledgers = [root]
  const pending = [...root.childConversationIds]
  const seen = new Set([conversationId])
  while (pending.length && ledgers.length < 33) {
    const child = pending.shift()!
    if (seen.has(child)) continue
    seen.add(child)
    const ledger = (await readLedger(storage, child)).ledger
    if (ledger.parentConversationId && ledger.parentConversationId !== conversationId && !seen.has(ledger.parentConversationId)) continue
    ledgers.push(ledger)
    pending.push(...ledger.childConversationIds)
  }
  return ledgers
}

export async function recordSession(storage: ScopedStorage, input: {conversationId: string; parentConversationId?: string; entries: ReadonlyArray<Omit<LedgerEntry,'createdAt'> & {createdAt?: number}>}, now = Date.now()): Promise<SessionLedger> {
  const key = sessionStorageKey(input.conversationId)
  let last: unknown
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readLedger(storage, input.conversationId)
    const next = mergeEntries(current.ledger, input.entries.map(({createdAt: _created, ...entry}) => entry), now, input.parentConversationId)
    if (Buffer.byteLength(JSON.stringify(next)) > MAX_BYTES) throw new WorkbenchError('QUOTA_EXCEEDED')
    try {
      await storage.write(key, next, current.version)
      if (input.parentConversationId && input.parentConversationId !== input.conversationId) await linkChild(storage, input.parentConversationId, input.conversationId)
      return next
    } catch (error) {
      last = error
      if (error instanceof WorkbenchError && error.code === 'RESOURCE_CHANGED') continue
      throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
    }
  }
  if (last instanceof WorkbenchError && last.code === 'QUOTA_EXCEEDED') throw last
  throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
}

async function linkChild(storage: ScopedStorage, parentId: string, childId: string): Promise<void> {
  const key = sessionStorageKey(parentId)
  for (let attempt = 0; attempt < 4; attempt++) {
    const current = await readLedger(storage, parentId)
    if (current.ledger.childConversationIds.includes(childId)) return
    const next = sessionLedgerSchema.parse({...current.ledger, childConversationIds: [...current.ledger.childConversationIds, childId].slice(-32)})
    try { await storage.write(key, next, current.version); return }
    catch (error) {
      if (error instanceof WorkbenchError && error.code === 'RESOURCE_CHANGED') continue
      throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
    }
  }
  throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
}

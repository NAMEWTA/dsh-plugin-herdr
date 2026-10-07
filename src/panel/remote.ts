// Host methods exposed to the Web panel through Typert Remote.
// The implementation is created beside the existing trackers; this class only
// owns the wire contract and the checks previously done by HTTP routes.

import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { getBindingRegistry, getBoundPaneIds, getBoundWorkspaceIds, sessionIdFromTokens } from '../binding-registry.ts'
import { truncateAnsiTail } from '../terminal-ansi.ts'
import { OUTPUT_CAP, type HerdrStatusTracker } from '../status.ts'
import type { HerdrDashboardTracker } from '../dashboard.ts'
import type { TerminalSessionManager } from '../terminal-session/manager.ts'
import { isTerminalSessionError } from '../terminal-session/errors.ts'
import { parseCommand, validateStart } from '../terminal-session/routes.ts'
import type {
  PanelAgentOutputs,
  PanelBootstrapRequest,
  PanelBootstrapResult,
  PanelCloseRequest,
  PanelEvent,
  PanelEventsRequest,
  PanelInputRequest,
  PanelMutationResult,
  PanelPaneSession,
  PanelRenameRequest,
  PanelSessionPane,
  PanelStartResult,
  PanelTerminalCommandRequest,
  PanelTerminalReleaseRequest,
  PanelTerminalStartRequest,
  PanelTopology,
  HerdrDashboardSnapshot,
  HerdrStatusSnapshot,
} from './protocol.ts'

export interface PanelRuntime {
  tracker: HerdrStatusTracker
  dashboard: HerdrDashboardTracker
  terminal: () => TerminalSessionManager | null
  ensureTerminal: () => Promise<boolean>
  startServer: () => Promise<PanelStartResult>
  snapshot: () => Promise<{ panes: Array<{ pane_id: string; workspace_id?: string; tokens?: Record<string, string | null> }> }>
  paneRead: (request: { pane_id: string; source: 'recent_unwrapped' | 'visible'; lines: number; format: 'ansi' | 'text' }) => Promise<{ text?: string; truncated?: boolean; revision?: number }>
  paneClose: (id: string) => Promise<void>
  workspaceClose: (id: string) => Promise<void>
  paneRename: (id: string, label: string | null) => Promise<void>
  workspaceRename: (id: string, label: string) => Promise<void>
  paneInput: (request: { pane_id: string; text?: string; keys?: string[] }) => Promise<void>
}

const TOPOLOGY_EVENTS = new Set([
  'workspace_created', 'workspace_updated', 'workspace_metadata_updated', 'workspace_renamed', 'workspace_moved',
  'workspace_reordered', 'workspace_closed', 'workspace_focused',
  'tab_created', 'tab_closed', 'tab_renamed', 'tab_moved', 'tab_focused',
  'pane_created', 'pane_closed', 'pane_updated', 'pane_focused', 'pane_moved', 'pane_exited',
  'layout_updated',
])

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function failure(error: unknown): PanelMutationResult {
  return { ok: false, error: error instanceof Error ? error.message : String(error) }
}

export class HerdrPanelService extends TypertRemoteService {
  declare static readonly [Symbol.hasInstance]: (value: unknown) => boolean
  constructor(ctx: Context, private readonly runtime: PanelRuntime) {
    super(ctx, 'herdrPanel', { namespace: 'herdr' })
  }

  async status(request?: unknown): Promise<HerdrStatusSnapshot> {
    const scope = record(request).scope === 'all' ? 'all' : 'project'
    return this.runtime.tracker.snapshot(scope)
  }

  async dashboard(): Promise<HerdrDashboardSnapshot> {
    return this.runtime.dashboard.snapshot()
  }

  async topology(): Promise<PanelTopology> {
    const snap = this.runtime.tracker.snapshot('project')
    return {
      server: snap.server,
      topology: snap.topology,
      filter: snap.filter,
      stale: snap.stale === true,
      last_error: snap.last_error ?? null,
      updated_at: snap.updated_at,
      poll_latency_ms: snap.poll_latency_ms ?? this.runtime.tracker.getDiagnostics().pollLatencyMs,
    }
  }

  async agentOutputs(request?: unknown): Promise<PanelAgentOutputs> {
    const body = record(request)
    const paneIds = String(body.paneIds ?? '').split(',').map(item => item.trim()).filter(Boolean)
    if (paneIds.length === 0) return { outputs: [] }
    const requested = Number(body.lines)
    const lines = Math.min(Math.max(Number.isFinite(requested) && requested > 0 ? requested : 40, 1), 50000)
    const format = body.format === 'plain' ? 'text' : 'ansi'
    const outputs: PanelAgentOutputs['outputs'] = []
    for (const paneId of paneIds) {
      try {
        const result = await this.runtime.paneRead({ pane_id: paneId, source: 'recent_unwrapped', lines, format })
        const text = truncateAnsiTail(result.text ?? '', OUTPUT_CAP)
        outputs.push({
          pane_id: paneId,
          text,
          truncated: Boolean(result.truncated) || (result.text?.length ?? 0) > OUTPUT_CAP,
          ...(result.revision != null ? { revision: result.revision } : {}),
        })
      } catch (error) {
        outputs.push({ pane_id: paneId, error: error instanceof Error ? error.message : String(error) })
      }
    }
    return { outputs }
  }

  async sessionPane(request?: unknown): Promise<PanelSessionPane> {
    const agent = String(record(request).agent ?? '')
    if (!agent) return { pane_id: null }
    const bound = this.runtime ? getBindingRegistry().get(agent)?.pane_id : undefined
    if (bound) return { pane_id: bound }
    try {
      const snap = await this.runtime.snapshot()
      return { pane_id: snap.panes.find(pane => sessionIdFromTokens(pane.tokens) === agent)?.pane_id ?? null }
    } catch {
      return { pane_id: null }
    }
  }

  async paneSession(request?: unknown): Promise<PanelPaneSession> {
    const paneId = String(record(request).pane ?? '')
    if (!paneId) return { session_id: null }
    for (const [sessionId, binding] of getBindingRegistry()) {
      if (binding.pane_id === paneId) return { session_id: sessionId }
    }
    try {
      const snap = await this.runtime.snapshot()
      const pane = snap.panes.find(item => item.pane_id === paneId)
      return { session_id: pane ? sessionIdFromTokens(pane.tokens) ?? null : null }
    } catch {
      return { session_id: null }
    }
  }

  start(): Promise<PanelStartResult> {
    return this.runtime.startServer()
  }

  async close(request?: unknown): Promise<PanelMutationResult> {
    const body = record(request) as Partial<PanelCloseRequest>
    if (body.kind !== 'workspace' && body.kind !== 'pane') return { ok: false, error: "kind must be 'workspace' or 'pane'" }
    if (!body.id?.trim()) return { ok: false, error: 'id must be a non-empty string' }
    const bound = new Set(getBoundPaneIds())
    if (body.kind === 'pane' && bound.has(body.id)) return { ok: false, error: 'cannot close the pane hosting this session' }
    if (body.kind === 'workspace') {
      try {
        const snap = await this.runtime.snapshot()
        if (snap.panes.some(pane => pane.workspace_id === body.id && bound.has(pane.pane_id))) {
          return { ok: false, error: 'cannot close the workspace hosting this session' }
        }
      } catch { /* a snapshot failure does not block close */ }
    }
    try {
      if (body.kind === 'pane') await this.runtime.paneClose(body.id)
      else await this.runtime.workspaceClose(body.id)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async rename(request?: unknown): Promise<PanelMutationResult> {
    const body = record(request) as Partial<PanelRenameRequest>
    if (body.kind !== 'workspace' && body.kind !== 'pane') return { ok: false, error: "kind must be 'workspace' or 'pane'" }
    if (!body.id?.trim()) return { ok: false, error: 'id must be a non-empty string' }
    if (body.kind === 'workspace' && !body.label?.trim()) return { ok: false, error: 'label must be a non-empty string' }
    if (typeof body.label === 'string' && body.label.trim().length > 64) return { ok: false, error: 'label must be at most 64 characters' }
    try {
      if (body.kind === 'pane') await this.runtime.paneRename(body.id, body.label ?? null)
      else await this.runtime.workspaceRename(body.id, body.label as string)
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async paneInput(request?: unknown): Promise<PanelMutationResult> {
    const body = record(request) as Partial<PanelInputRequest>
    if (!body.pane_id?.trim()) return { ok: false, error: 'pane_id must be a non-empty string' }
    if (body.kind !== undefined && body.kind !== 'text' && body.kind !== 'keys') return { ok: false, error: "kind must be 'text' or 'keys'" }
    const hasText = typeof body.text === 'string' && body.text.length > 0
    const hasKeys = Array.isArray(body.keys) && body.keys.length > 0
    if (!hasText && !hasKeys) return { ok: false, error: 'text or keys is required' }
    if (hasText && Buffer.byteLength(body.text!, 'utf8') > 64 * 1024) return { ok: false, error: 'text exceeds 64KB limit' }
    if (hasKeys && body.keys!.length > 32) return { ok: false, error: 'keys array exceeds 32 item limit' }
    if (!(await this.ownsPane(body.pane_id))) return { ok: false, error: 'pane not accessible from this session' }
    try {
      await this.runtime.paneInput({ pane_id: body.pane_id, text: body.text, keys: body.keys })
      return { ok: true }
    } catch (error) {
      return failure(error)
    }
  }

  async terminalBootstrap(request?: unknown): Promise<PanelBootstrapResult> {
    const body = record(request) as Partial<PanelBootstrapRequest>
    if (!body.pane_id?.trim()) return { ok: false, error: 'pane_id query parameter is required' }
    if (!(await this.ownsPane(body.pane_id))) return { ok: false, error: 'pane not accessible from this session' }
    const requested = Number(body.lines ?? 500)
    const lines = Math.min(Math.max(Number.isFinite(requested) ? requested : 500, 100), 50000)
    try {
      const result = await this.runtime.paneRead({
        pane_id: body.pane_id,
        source: body.source === 'recent_unwrapped' ? 'recent_unwrapped' : 'visible',
        lines,
        format: 'ansi',
      })
      return { ok: true, text: result.text, revision: result.revision, truncated: result.truncated }
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) }
    }
  }

  async terminalStart(request?: unknown): Promise<PanelMutationResult> {
    const parsed = validateStart(record(request))
    if (parsed.error || !parsed.value) return { ok: false, error: parsed.error ?? 'invalid request' }
    if (!(await this.ownsPane(parsed.value.pane_id))) return { ok: false, error: 'pane not accessible from this session' }
    if (!(await this.runtime.ensureTerminal())) return { ok: false, error: 'terminal session unavailable' }
    const manager = this.runtime.terminal()
    if (!manager) return { ok: false, error: 'terminal session unavailable' }
    try {
      const started = manager.start(parsed.value)
      return { ok: true, error: undefined, session_id: started.sessionId, generation: started.generation } as PanelMutationResult
    } catch (error) {
      return failure(error)
    }
  }

  async terminalCommand(request?: unknown): Promise<PanelMutationResult> {
    const body = record(request) as Partial<PanelTerminalCommandRequest>
    const parsed = parseCommand({ session_id: body.session_id, command: body.command })
    if (parsed.error || !parsed.value) return { ok: false, error: parsed.error ?? 'invalid command' }
    const manager = this.runtime.terminal()
    if (!manager) return { ok: false, error: 'terminal session unavailable' }
    try {
      if (parsed.value.release) await manager.release(parsed.value.sessionId)
      else manager.writeCommand(parsed.value.sessionId, parsed.value.payload)
      return { ok: true }
    } catch (error) {
      return isTerminalSessionError(error) ? { ok: false, error: error.message } : failure(error)
    }
  }

  async terminalRelease(request?: unknown): Promise<PanelMutationResult> {
    const sessionId = String((record(request) as Partial<PanelTerminalReleaseRequest>).session_id ?? '')
    if (!sessionId.trim()) return { ok: false, error: 'session_id is required' }
    const manager = this.runtime.terminal()
    if (!manager) return { ok: true }
    await manager.release(sessionId)
    return { ok: true }
  }

  terminalStats(): Record<string, unknown> {
    return { ok: true, stats: this.runtime.terminal()?.report() ?? null }
  }

  async *events(request?: unknown, signal?: AbortSignal): AsyncIterable<PanelEvent> {
    const abortSignal = signal ?? (this.ctx as { invocation?: { signal?: AbortSignal } }).invocation?.signal
    const after = Number(record(request as PanelEventsRequest).after_revision)
    if (Number.isSafeInteger(after) && after >= 0) {
      const snap = this.runtime.tracker.snapshot('project')
      yield { type: 'topology', topology: snap.topology, filter: snap.filter }
    }
    const queue: PanelEvent[] = []
    let wake: (() => void) | null = null
    const push = (event: PanelEvent) => {
      queue.push(event)
      wake?.()
      wake = null
    }
    const manager = this.runtime.terminal()
    const stops = [
      this.ctx.on('herdr/agent-state', (info: { pane_id: string; agent: string; status: string; message?: string }) => {
        push({ type: 'agent_status', pane_id: info.pane_id, agent: info.agent, status: info.status, ...(info.message ? { message: info.message } : {}) })
      return true
      }),
      this.ctx.on('herdr/resource-changed', () => {
        const snap = this.runtime.tracker.snapshot('project')
        push({ type: 'topology', topology: snap.topology, filter: snap.filter })
        return true
      }),
    ]
    const client = this.ctx.herdr as { onEvent?: (handler: (event: unknown) => void) => () => void }
    let stopClient: (() => void) | null = null
    if (typeof client.onEvent === 'function') {
      stopClient = client.onEvent(raw => {
        const data = record(record(raw).data)
        const type = typeof data.type === 'string' ? data.type : String(record(raw).event ?? '')
        if (type === 'pane_output_changed') {
          const paneId = String(data.pane_id ?? '')
          if (paneId) push({ type: 'output', pane_id: paneId, revision: typeof data.revision === 'number' ? data.revision : 0 })
        } else if (TOPOLOGY_EVENTS.has(type)) {
          const snap = this.runtime.tracker.snapshot('project')
          push({ type: 'topology', topology: snap.topology, filter: snap.filter })
        }
      })
    }
    let stopTerminal: (() => void) | null = null
    if (manager) {
      manager.onGlobalClientConnect()
      stopTerminal = manager.addGlobalListener((sessionId, paneId, event) => push({ type: 'term', session_id: sessionId, pane_id: paneId, event }))
      for (const live of manager.liveSessions()) {
        const full = manager.replayLatestFull(live.sessionId)
        if (!full) continue
        push({ type: 'term', session_id: live.sessionId, pane_id: live.paneId, event: { type: 'ready', sessionId: live.sessionId, mode: live.mode, generation: live.generation, resumed: true, afterSeq: full.seq } })
        push({ type: 'term', session_id: live.sessionId, pane_id: live.paneId, event: full })
      }
    }
    const heartbeat = setInterval(() => {
      const snap = this.runtime.tracker.snapshot('project')
      push({ type: 'heartbeat', stale: snap.stale === true, last_error: snap.last_error ?? null })
    }, 10000)
    const onAbort = () => { wake?.(); wake = null }
    abortSignal?.addEventListener('abort', onAbort, { once: true })
    try {
      while (!abortSignal?.aborted) {
        while (queue.length > 0) yield queue.shift()!
        if (abortSignal?.aborted) break
        await new Promise<void>(resolve => { wake = resolve })
      }
    } finally {
      clearInterval(heartbeat)
      abortSignal?.removeEventListener('abort', onAbort)
      for (const stop of stops) stop()
      stopClient?.()
      stopTerminal?.()
      if (manager) manager.onGlobalClientDisconnect()
    }
  }

  private async ownsPane(paneId: string): Promise<boolean> {
    const workspaces = new Set(getBoundWorkspaceIds())
    if (workspaces.size === 0) return true
    try {
      const snap = await this.runtime.snapshot()
      const workspace = snap.panes.find(pane => pane.pane_id === paneId)?.workspace_id
      return !!workspace && workspaces.has(workspace)
    } catch {
      return false
    }
  }
}

// Node 24 leaves stage-3 decorators off unless --js-decorators is set, and the
// desktop host does not pass that flag. Register the same markers Remote()
// would attach, so the shipped bundle stays plain JavaScript.
const PANEL_REMOTE_METHODS = [
  'status', 'dashboard', 'topology', 'agentOutputs', 'sessionPane', 'paneSession',
  'start', 'close', 'rename', 'paneInput', 'terminalBootstrap', 'terminalStart',
  'terminalCommand', 'terminalRelease', 'terminalStats',
] as const

function installRemote(name: string, mode?: 'stream') {
  const decorator = mode === undefined ? Remote : Remote({ mode })
  const proto = HerdrPanelService.prototype as unknown as Record<string, unknown>
  const method = proto[name]
  if (typeof method !== 'function') throw new Error(`herdr panel method ${name} is missing`)
  const context = {
    kind: 'method' as const,
    name,
    static: false,
    private: false,
    addInitializer(fn: (this: unknown) => void) {
      fn.call(Object.create(proto))
    },
  }
  ;(decorator as (method: unknown, context: object) => void)(method, context)
}

for (const name of PANEL_REMOTE_METHODS) installRemote(name)
installRemote('events', 'stream')

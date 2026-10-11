import { TOPOLOGY_EVENTS } from '../../contracts/events.ts'
/** Thin RPC adapter: validate at the boundary, reuse application policies. */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { getBindingRegistry, sessionIdFromTokens } from '../binding-registry.ts'
import { assertCanClose, canWritePane } from '../application/resources.ts'
import { truncateAnsiTail } from '../../core/ansi.ts'
import { BoundedAsyncQueue } from '../../core/async-queue.ts'
import { PANEL_DEFINITIONS, PANEL_METHODS, type PanelMethod } from '../../contracts/panel-schemas.ts'
import { OUTPUT_CAP, type HerdrStatusTracker } from '../status.ts'
import type { HerdrDashboardTracker } from '../dashboard.ts'
import type { TerminalSessionManager } from '../terminal-session/manager.ts'
import type { TerminalAttachResult } from '../../contracts/terminal.ts'
import { isTerminalSessionError } from '../terminal-session/errors.ts'
import { parseCommand, validateStart } from '../terminal-session/routes.ts'
import type {
  PanelAgentOutputs, PanelBootstrapResult, PanelEvent, PanelMutationResult,
  PanelPaneSession, PanelSessionPane, PanelStartResult, PanelTopology,
  HerdrDashboardSnapshot, HerdrStatusSnapshot,
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

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}
function failure(error: unknown): PanelMutationResult {
  const message = error instanceof Error ? error.message : String(error)
  return { ok: false, error: message, ...(isTerminalSessionError(error) ? { code: error.code } : {}) }
}
const UNAVAILABLE: PanelMutationResult = { ok: false, error: 'terminal session unavailable', code: 'terminal_session_unavailable' }

export class HerdrPanelService extends TypertRemoteService {
  declare static readonly [Symbol.hasInstance]: (value: unknown) => boolean
  constructor(ctx: Context, private readonly runtime: PanelRuntime) { super(ctx, 'herdrPanel', { namespace: 'herdr' }) }
  async status(request?: unknown): Promise<HerdrStatusSnapshot> { return this.runtime.tracker.snapshot(record(request).scope === 'all' ? 'all' : 'project') }
  async dashboard(): Promise<HerdrDashboardSnapshot> { return this.runtime.dashboard.snapshot() }
  async topology(): Promise<PanelTopology> {
    const snap = this.runtime.tracker.snapshot('project')
    return { server: snap.server, topology: snap.topology, filter: snap.filter, stale: snap.stale, last_error: snap.last_error, updated_at: snap.updated_at, poll_latency_ms: snap.poll_latency_ms ?? this.runtime.tracker.getDiagnostics().pollLatencyMs }
  }
  async agentOutputs(request?: unknown): Promise<PanelAgentOutputs> {
    const body = record(request)
    const paneIds = [...new Set(String(body.paneIds ?? '').split(',').map(id => id.trim()).filter(Boolean))]
    const outputs: PanelAgentOutputs['outputs'] = []
    for (const paneId of paneIds) {
      try {
        const result = await this.runtime.paneRead({ pane_id: paneId, source: 'recent_unwrapped', lines: Number(body.lines ?? 40), format: body.format === 'plain' ? 'text' : 'ansi' })
        outputs.push({ pane_id: paneId, text: truncateAnsiTail(result.text ?? '', OUTPUT_CAP), truncated: result.truncated === true || (result.text?.length ?? 0) > OUTPUT_CAP, ...(result.revision == null ? {} : { revision: result.revision }) })
      } catch (error) { outputs.push({ pane_id: paneId, error: error instanceof Error ? error.message : String(error) }) }
    }
    return { outputs }
  }
  async sessionPane(request?: unknown): Promise<PanelSessionPane> {
    const agent = String(record(request).agent ?? '')
    if (!agent) return { pane_id: null }
    const bound = getBindingRegistry().get(agent)
    if (bound) return { pane_id: bound.pane_id }
    try { return { pane_id: (await this.runtime.snapshot()).panes.find(p => sessionIdFromTokens(p.tokens) === agent)?.pane_id ?? null } }
    catch { return { pane_id: null } }
  }
  async paneSession(request?: unknown): Promise<PanelPaneSession> {
    const paneId = String(record(request).pane ?? '')
    for (const [sessionId, binding] of getBindingRegistry()) if (binding.pane_id === paneId) return { session_id: sessionId }
    try { return { session_id: sessionIdFromTokens((await this.runtime.snapshot()).panes.find(p => p.pane_id === paneId)?.tokens) ?? null } }
    catch { return { session_id: null } }
  }
  async start(): Promise<PanelStartResult> {
    try { return await this.runtime.startServer() } catch (error) { return failure(error) }
  }
  async close(request?: unknown): Promise<PanelMutationResult> {
    const { kind, id } = PANEL_DEFINITIONS.close.request.parse(request)
    try {
      await assertCanClose(kind, id, () => this.runtime.snapshot())
      if (kind === 'pane') await this.runtime.paneClose(id)
      else await this.runtime.workspaceClose(id)
      return { ok: true }
    } catch (error) { return failure(error) }
  }
  async rename(request?: unknown): Promise<PanelMutationResult> {
    const { kind, id, label } = PANEL_DEFINITIONS.rename.request.parse(request)
    try {
      if (kind === 'pane') await this.runtime.paneRename(id, label || null)
      else await this.runtime.workspaceRename(id, label!)
      return { ok: true }
    } catch (error) { return failure(error) }
  }
  async paneInput(request?: unknown): Promise<PanelMutationResult> {
    const body = PANEL_DEFINITIONS.paneInput.request.parse(request)
    if (!(await canWritePane(body.pane_id, () => this.runtime.snapshot()))) return { ok: false, error: 'pane not accessible from this profile', code: 'terminal_session_forbidden' }
    try { await this.runtime.paneInput(body); return { ok: true } } catch (error) { return failure(error) }
  }
  async terminalBootstrap(request?: unknown): Promise<PanelBootstrapResult> {
    const body = PANEL_DEFINITIONS.terminalBootstrap.request.parse(request)
    if (!(await canWritePane(body.pane_id, () => this.runtime.snapshot()))) return { ok: false, error: 'pane not accessible from this profile' }
    try {
      const result = await this.runtime.paneRead({ pane_id: body.pane_id, source: body.source ?? 'visible', lines: body.lines ?? 500, format: 'ansi' })
      return { ok: true, ...result }
    } catch (error) { return failure(error) }
  }
  async terminalStart(request?: unknown): Promise<PanelMutationResult & { session_id?: string; generation?: number }> {
    const parsed = validateStart(record(request))
    if (!parsed.value) return { ok: false, error: parsed.error }
    if (!(await canWritePane(parsed.value.pane_id, () => this.runtime.snapshot()))) return { ok: false, error: 'pane not accessible from this profile', code: 'terminal_session_forbidden' }
    try {
      if (!(await this.runtime.ensureTerminal())) return { ...UNAVAILABLE }
      const manager = this.runtime.terminal()
      if (!manager) return { ...UNAVAILABLE }
      if (parsed.value.takeover) await manager.releaseControllers(parsed.value.pane_id)
      const started = manager.start(parsed.value)
      return { ok: true, session_id: started.sessionId, generation: started.generation }
    } catch (error) { return failure(error) }
  }
  async terminalAttach(request?: unknown): Promise<TerminalAttachResult> {
    const body = PANEL_DEFINITIONS.terminalAttach.request.parse(request)
    const manager = this.runtime.terminal()
    if (!manager) return { ...UNAVAILABLE }
    try {
      const events = manager.attach(body.session_id, body.generation === undefined ? undefined : { generation: body.generation, afterSeq: body.after_seq! })
      return { ok: true, events }
    } catch (error) { return failure(error) }
  }
  async terminalCommand(request?: unknown): Promise<PanelMutationResult> {
    const parsed = parseCommand(record(request))
    if (!parsed.value) return { ok: false, error: parsed.error }
    const manager = this.runtime.terminal()
    if (!manager) return { ...UNAVAILABLE }
    try {
      if (parsed.value.release) await manager.release(parsed.value.sessionId)
      else manager.writeCommand(parsed.value.sessionId, parsed.value.payload)
      return { ok: true }
    } catch (error) { return failure(error) }
  }
  async terminalRelease(request?: unknown): Promise<PanelMutationResult> {
    const body = PANEL_DEFINITIONS.terminalRelease.request.parse(request)
    try { await this.runtime.terminal()?.release(body.session_id); return { ok: true } } catch (error) { return failure(error) }
  }
  terminalStats(): Record<string, unknown> { return { ok: true, stats: this.runtime.terminal()?.report() ?? null } }

  async *events(_request?: unknown, signal?: AbortSignal): AsyncIterable<PanelEvent> {
    const abort = signal ?? (this.ctx as { invocation?: { signal?: AbortSignal } }).invocation?.signal
    if (abort?.aborted) return
    const queue = new BoundedAsyncQueue<PanelEvent>(256, 64 * 1024 * 1024, value => Buffer.byteLength(JSON.stringify(value)))
    const push = (event: PanelEvent) => { queue.push(event) }
    const stops: Array<() => void> = []
    const manager = this.runtime.terminal()
    let connected = false
    let heartbeat: ReturnType<typeof setInterval> | undefined
    const onAbort = () => queue.close()
    try {
      stops.push(this.ctx.on('herdr/agent-state', (info: { pane_id: string; agent: string; status: string; message?: string }) => { push({ type: 'agent_status', pane_id: info.pane_id, agent: info.agent, status: info.status, ...(info.message === undefined ? {} : { message: info.message }) }); return true }))
      const topology = () => {
        const snap = this.runtime.tracker.snapshot('project')
        push({ type: 'topology', topology: snap.topology, filter: snap.filter })
      }
      stops.push(this.ctx.on('herdr/resource-changed', () => { topology(); return true }))
      const client = this.ctx.herdr as { onEvent?: (handler: (event: unknown) => void) => () => void }
      if (client.onEvent) stops.push(client.onEvent(raw => {
        const data = record(record(raw).data)
        const type = String(data.type ?? record(raw).event ?? '')
        if (type === 'pane_output_changed' && typeof data.pane_id === 'string') push({ type: 'output', pane_id: data.pane_id, revision: Number(data.revision ?? 0) })
        else if (TOPOLOGY_EVENTS.has(type)) topology()
      }))
      if (manager) {
        manager.onGlobalClientConnect()
        connected = true
        stops.push(manager.addGlobalListener((sessionId, paneId, event) => push({ type: 'term', session_id: sessionId, pane_id: paneId, event })))
        for (const live of manager.liveSessions()) {
          for (const event of manager.attach(live.sessionId)) push({ type: 'term', session_id: live.sessionId, pane_id: live.paneId, event })
        }
      }
      topology()
      heartbeat = setInterval(() => {
        const snap = this.runtime.tracker.snapshot('project')
        push({ type: 'heartbeat', stale: snap.stale, last_error: snap.last_error })
      }, 10_000)
      heartbeat.unref?.()
      abort?.addEventListener('abort', onAbort, { once: true })
      if (abort?.aborted) queue.close()
      yield* queue
    } finally {
      queue.close()
      if (heartbeat) clearInterval(heartbeat)
      abort?.removeEventListener('abort', onAbort)
      for (const stop of stops.reverse()) { try { stop() } catch { /* finish all cleanup */ } }
      if (connected) manager!.onGlobalClientDisconnect()
    }
  }
}

// The pinned DSH host loads plain JS without a decorators runtime flag.
// One contract list drives both these markers and the generated gateway face.
const mutations = new Set<PanelMethod>(['start', 'close', 'rename', 'paneInput', 'terminalBootstrap', 'terminalStart', 'terminalAttach', 'terminalCommand', 'terminalRelease'])
for (const name of PANEL_METHODS) {
  const proto = HerdrPanelService.prototype as unknown as Record<string, unknown>
  const original = proto[name]
  if (typeof original !== 'function') throw new Error(`missing panel method ${name}`)
  const checked = function(this: HerdrPanelService, ...args: unknown[]) {
    const parsed = PANEL_DEFINITIONS[name].request.safeParse(args[0])
    if (!parsed.success) {
      const error = parsed.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('; ')
      if (mutations.has(name)) return Promise.resolve({ ok: false, code: 'invalid_request', error })
      throw new Error(`invalid ${name} request: ${error}`)
    }
    return Reflect.apply(original, this, [parsed.data, ...args.slice(1)])
  }
  proto[name] = checked
  const decorator = name === 'events' ? Remote({ mode: 'stream' }) : Remote
  const context = { kind: 'method' as const, name, static: false, private: false, addInitializer(fn: (this: unknown) => void) { fn.call(Object.create(proto)) } }
  ;(decorator as (method: unknown, context: object) => void)(checked, context)
}

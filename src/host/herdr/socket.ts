import type { Socket } from 'node:net'
import type { Context } from '@deepseek-ai/cordis'
import { HerdrClient } from './service.ts'
import type * as API from './service.ts'
import { HerdrError } from '../../core/errors.ts'
import { throwIfAborted, abortableDelay } from '../../core/abort.ts'
import { MAX_OUTPUT_BYTES, truncateUtf8Bytes } from '../../core/output.ts'
import { truncateAnsiTail } from '../../core/ansi.ts'
import { pollPaneUntilStable } from '../../core/poll.ts'
import type { HerdrResultMap } from '../../core/protocol.ts'
import { socketRequest, socketSubscribe, type RequestOptions, type SocketOptions } from './transport.ts'
export { socketPing } from './transport.ts'
export interface SocketAdapterOptions extends SocketOptions {}

function capReadText(read?: { text?: string; truncated?: boolean; revision?: number }) {
  let text = read?.text ?? ''
  let truncated = read?.truncated === true
  if (typeof text !== 'string') throw new HerdrError('HERDR_PROTOCOL', 'pane.read text is not a string')
  if (Buffer.byteLength(text) > MAX_OUTPUT_BYTES) { text = truncateUtf8Bytes(text, MAX_OUTPUT_BYTES); truncated = true }
  if (text.includes('\u001b')) {
    const cleaned = truncateAnsiTail(text, text.length)
    if (cleaned.length < text.length) { text = cleaned; truncated = true }
  }
  return { text, truncated, revision: read?.revision }
}

/** One-shot RPC and a separately owned subscription connection. Mutations never retry. */
export class SocketHerdrClient extends HerdrClient {
  private readonly lifetime = new AbortController()
  private subscription: AbortController | null = null
  private subSocket: Socket | null = null
  private readonly handlers = new Set<(event: unknown) => void>()
  constructor(ctx: Context, private readonly options: SocketAdapterOptions) { super(ctx) }
  get connected(): boolean { return this.subSocket !== null && !this.subSocket.destroyed && !this.lifetime.signal.aborted }
  close(): void {
    this.lifetime.abort()
    this.subscription?.abort()
    this.subscription = null
    this.subSocket = null
    this.handlers.clear()
  }
  private callOnce(method: string, params: unknown, options: RequestOptions = {}) {
    const signal = options.signal ? AbortSignal.any([options.signal, this.lifetime.signal]) : this.lifetime.signal
    return socketRequest(this.options, method, params, { ...options, signal })
  }
  private async read(method: string, params: unknown, signal?: AbortSignal) {
    try { return await this.callOnce(method, params, { signal }) }
    catch (error) {
      if (!(error instanceof HerdrError) || error.code !== 'HERDR_UNAVAILABLE') throw error
      await abortableDelay(300, signal)
      return this.callOnce(method, params, { signal })
    }
  }
  async ping(signal?: AbortSignal): Promise<{ version: string; protocol: number }> {
    const { result } = await this.callOnce('ping', {}, { signal })
    const pong = result as { version?: string; protocol?: number } | undefined
    if (!pong?.version || typeof pong.protocol !== 'number') throw new HerdrError('HERDR_PROTOCOL', 'ping response missing version/protocol')
    return { version: pong.version, protocol: pong.protocol }
  }
  async snapshot(signal?: AbortSignal): Promise<API.HerdrSnapshot> {
    const { result } = await this.read('session.snapshot', {}, signal)
    const raw = (result as HerdrResultMap['session.snapshot'] | undefined)?.snapshot
    if (!raw || !Array.isArray(raw.agents)) throw new HerdrError('HERDR_PROTOCOL', 'session.snapshot response missing snapshot/agents')
    const agents = raw.agents.map(agent => ({ ...agent, status: agent.agent_status ?? (agent as { status?: API.AgentStatus }).status ?? 'unknown' }))
    return { ...raw, agents } as API.HerdrSnapshot
  }
  async listAgents(filter?: API.AgentFilter, signal?: AbortSignal): Promise<API.HerdrAgentInfo[]> {
    const { result } = await this.read('agent.list', {}, signal)
    const raw = (result as HerdrResultMap['agent.list'] | undefined)?.agents ?? []
    const agents = raw.map(agent => ({ ...agent, status: agent.agent_status ?? (agent as { status?: API.AgentStatus }).status ?? 'unknown' }))
    return agents.filter(agent => (!filter?.workspace_id || agent.workspace_id === filter.workspace_id) && (!filter?.status || agent.status === filter.status)) as API.HerdrAgentInfo[]
  }
  async runCommand(req: API.RunCommandRequest, signal: AbortSignal): Promise<API.RunCommandResult> {
    throwIfAborted(signal)
    let paneId = req.pane_id
    let created = false
    let submissionAttempted = false
    try {
      if (!paneId) {
        const pane = await this.paneSplit({ ...req, direction: req.direction ?? 'right' }, signal)
        paneId = pane.pane_id
        created = true
      }
      throwIfAborted(signal)
      let baseline = ''
      try { baseline = (await this.readPaneText(paneId, signal)).text }
      catch (error) { if (signal.aborted) throw error }
      throwIfAborted(signal)
      submissionAttempted = true
      await this.callOnce('pane.send_text', { pane_id: paneId, text: req.command + '\n' }, { signal })
      let truncated = false
      const readPane = async (id: string) => {
        throwIfAborted(signal)
        const result = await this.readPaneText(id, signal)
        truncated ||= result.truncated
        return result.text
      }
      const result = await pollPaneUntilStable(readPane, paneId, req.wait_ms ?? this.options.timeoutMs, signal, { baseline })
      throwIfAborted(signal)
      if (result.status === 'aborted') throw new HerdrError('HERDR_ABORTED', 'runCommand cancelled')
      return { kind: 'completed', pane_id: paneId, exit_code: null, output: result.output, truncated, timed_out: result.status === 'timed_out' }
    } catch (error) {
      // Before submission, a known newly-created pane can safely be compensated.
      // After submission starts, its outcome may be unknown; never kill or retry it.
      if (created && paneId && !submissionAttempted) await this.paneClose(paneId).catch(() => {})
      throw error
    }
  }
  async waitAgent(req: API.WaitAgentRequest, signal: AbortSignal): Promise<API.WaitAgentResult> {
    const started = Date.now()
    const timeout = req.timeout_ms ?? this.options.timeoutMs
    try {
      const { result } = await this.callOnce('agent.wait', { target: req.target, until: req.until, timeout_ms: timeout }, { timeoutMs: timeout + 10_000, signal })
      const agent = (result as HerdrResultMap['agent.wait'] | undefined)?.agent
      if (!agent) throw new HerdrError('HERDR_PROTOCOL', 'agent.wait response missing agent')
      return { kind: 'completed', status: agent.agent_status, agent: agent.name ?? agent.agent ?? undefined, pane_id: agent.pane_id ?? undefined, waited_ms: Date.now() - started }
    } catch (error) {
      if (signal.aborted) throw error
      if (error instanceof HerdrError && (error.serverCode === 'agent_not_found' || /agent_not_found|not found/i.test(error.message))) return { kind: 'not_found', target: req.target }
      if (error instanceof HerdrError && (error.serverCode === 'timeout' || error.code === 'HERDR_TIMEOUT')) return { kind: 'timeout', waited_ms: Date.now() - started }
      throw error
    }
  }
  async workspaceCreate(req: API.WorkspaceCreateRequest, signal?: AbortSignal): Promise<{ workspace_id: string; pane_id?: string }> {
    const { result } = await this.callOnce('workspace.create', { cwd: req.cwd ?? null, label: req.label ?? null, env: req.env }, { signal })
    const value = result as HerdrResultMap['workspace.create'] | undefined
    if (!value?.workspace?.workspace_id) throw new HerdrError('HERDR_PROTOCOL', 'workspace.create response missing workspace_id')
    return { workspace_id: value.workspace.workspace_id, ...(value.root_pane?.pane_id ? { pane_id: value.root_pane.pane_id } : {}) }
  }
  async paneSplit(req: API.PaneSplitRequest, signal?: AbortSignal): Promise<{ pane_id: string }> {
    const { result } = await this.callOnce('pane.split', { direction: req.direction, ratio: req.ratio ?? null, cwd: req.cwd ?? null, env: req.env, target_pane_id: req.pane_id ?? null, workspace_id: req.workspace_id ?? null }, { signal })
    const pane = (result as HerdrResultMap['pane.split'] | undefined)?.pane
    if (!pane?.pane_id) throw new HerdrError('HERDR_PROTOCOL', 'pane.split response missing pane_id')
    return { pane_id: pane.pane_id }
  }
  async paneClose(paneId: string, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.close', { pane_id: paneId }, { signal }) }
  async workspaceClose(workspaceId: string, signal?: AbortSignal): Promise<void> { await this.callOnce('workspace.close', { workspace_id: workspaceId }, { signal }) }
  async workspaceRename(workspaceId: string, label: string, signal?: AbortSignal): Promise<void> { await this.callOnce('workspace.rename', { workspace_id: workspaceId, label }, { signal }) }
  async paneRename(paneId: string, label: string | null, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.rename', { pane_id: paneId, label }, { signal }) }
  async paneSendKeys(req: API.PaneSendKeysRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.send_keys', req, { signal }) }
  async paneSendInput(req: API.PaneSendInputRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.send_input', req, { signal }) }
  async paneRead(req: API.PaneReadRequest, signal?: AbortSignal) {
    const { result } = await this.callOnce('pane.read', { pane_id: req.pane_id, source: req.source ?? 'recent', lines: req.lines ?? null, format: req.format ?? 'text' }, { signal })
    return capReadText((result as HerdrResultMap['pane.read'] | undefined)?.read)
  }
  private async readPaneText(paneId: string, signal?: AbortSignal) {
    const { result } = await this.read('pane.read', { pane_id: paneId, source: 'recent', lines: 500 }, signal)
    return capReadText((result as HerdrResultMap['pane.read'] | undefined)?.read)
  }
  async paneWaitForOutputChange(req: API.PaneOutputChangeRequest, signal?: AbortSignal): Promise<API.PaneOutputChangeResult> {
    const timeout = req.timeout_ms ?? 25_000
    try {
      const { result } = await this.callOnce('events.wait', { match_event: { event: 'pane_output_changed', pane_id: req.pane_id, min_revision: req.min_revision }, timeout_ms: timeout }, { timeoutMs: timeout + 5000, signal })
      const data = (result as HerdrResultMap['events.wait'] | undefined)?.event?.data
      if (data?.type !== 'pane_output_changed' || data.pane_id !== req.pane_id) throw new HerdrError('HERDR_PROTOCOL', 'events.wait response missing matching output event')
      return { changed: true, revision: data.revision }
    } catch (error) {
      if (error instanceof HerdrError && error.serverCode === 'timeout') return { changed: false, revision: req.min_revision }
      throw error
    }
  }
  async paneLayout(req: API.PaneLayoutRequest, signal?: AbortSignal): Promise<unknown> { return (await this.callOnce('pane.layout', { pane_id: req.pane_id ?? null }, { signal })).result }
  async layoutApply(req: API.LayoutApplyRequest, signal?: AbortSignal): Promise<unknown> {
    return (await this.callOnce('layout.apply', { root: req.root, workspace_id: req.workspace_id ?? null, tab_id: req.tab_id ?? null, tab_label: req.tab_label ?? null, focus: req.focus ?? false }, { signal })).result
  }
  async agentPrompt(req: API.AgentPromptRequest, signal: AbortSignal): Promise<API.AgentPromptResult> {
    const started = Date.now()
    const { result } = await this.callOnce('agent.prompt', { target: req.target, text: req.text, wait: req.wait ? { ...(req.until ? { until: req.until } : {}), timeout_ms: req.timeout_ms ?? null } : null }, { signal, ...(req.wait && req.timeout_ms ? { timeoutMs: req.timeout_ms + 10_000 } : {}) })
    const status = (result as HerdrResultMap['agent.prompt'] | undefined)?.agent?.agent_status
    return { submitted: true, ...(status === undefined ? {} : { status }), ...(req.wait ? { waited_ms: Date.now() - started } : {}) }
  }
  async agentStart(req: API.AgentStartRequest, signal?: AbortSignal): Promise<API.AgentInfo> {
    const { result } = await this.callOnce('agent.start', { name: req.name, kind: req.kind, pane_id: req.pane_id, args: req.args, timeout_ms: req.timeout_ms ?? null }, { signal, timeoutMs: (req.timeout_ms ?? this.options.timeoutMs) + 10_000 })
    const agent = (result as HerdrResultMap['agent.start'] | undefined)?.agent
    if (!agent) throw new HerdrError('HERDR_PROTOCOL', 'agent.start response missing agent')
    return agent
  }
  async agentExplain(req: API.AgentExplainRequest, signal?: AbortSignal): Promise<unknown> {
    try { return (await this.callOnce('agent.explain', { target: req.target ?? null }, { signal })).result }
    catch (error) { if (error instanceof HerdrError && error.code === 'HERDR_ERROR') return {}; throw error }
  }
  async agentSendKeys(req: API.AgentSendKeysRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('agent.send_keys', req, { signal }) }
  async showNotification(req: API.NotificationShowRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('notification.show', { title: req.title, body: req.body ?? null, position: req.position ?? null, sound: req.sound ?? 'none' }, { signal }) }
  async reportAgent(req: API.ReportAgentRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.report_agent', { ...req, message: req.message ?? null }, { signal }) }
  async reportMetadata(req: API.ReportMetadataRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.report_metadata', { pane_id: req.pane_id, source: req.source, agent: req.agent ?? null, title: req.title ?? null, tokens: req.tokens, ttl_ms: req.ttl_ms ?? null }, { signal }) }
  async clearAgentAuthority(req: API.ClearAgentAuthorityRequest, signal?: AbortSignal): Promise<void> { await this.callOnce('pane.clear_agent_authority', { pane_id: req.pane_id, source: req.source ?? null }, { signal }) }
  onEvent(handler: (event: unknown) => void): () => void { this.handlers.add(handler); return () => { this.handlers.delete(handler) } }
  async subscribe(subscriptions: Array<{ type: string }>): Promise<void> {
    if (this.lifetime.signal.aborted) throw new HerdrError('HERDR_UNAVAILABLE', 'socket client is closed')
    this.subscription?.abort()
    this.subSocket = null
    const controller = new AbortController()
    this.subscription = controller
    const signal = AbortSignal.any([controller.signal, this.lifetime.signal])
    const socket = await socketSubscribe(this.options, subscriptions, event => {
      for (const handler of [...this.handlers]) { try { handler(event) } catch { /* handler isolation */ } }
    }, signal)
    if (signal.aborted || this.subscription !== controller) { socket.destroy(); return }
    this.subSocket = socket
    socket.once('close', () => { if (this.subSocket === socket) this.subSocket = null })
  }
}

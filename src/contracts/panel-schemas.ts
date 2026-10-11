/** Single runtime contract source for Host registration and generated Typert codecs. */
import { z } from 'zod'
import { isInputBase64, MAX_INPUT_BYTES, MAX_SCROLL_LINES, MAX_TERMINAL_DIMENSION } from './terminal.ts'

const id = z.string().trim().min(1).max(512)
const text = z.string()
const count = z.number().int().nonnegative()
const dimension = z.number().int().min(1).max(MAX_TERMINAL_DIMENSION)
const maybeText = text.nullable()
const empty = z.object({}).strict().optional()
const resource = z.object({ kind: z.enum(['workspace', 'pane']), id }).strict()
const mutation = z.object({ ok: z.boolean(), error: text.optional(), code: text.optional() }).strict()
const input = z.discriminatedUnion('type', [
  z.object({ type: z.literal('input'), bytes: z.string().refine(isInputBase64, 'invalid or oversized canonical Base64') }).strict(),
  z.object({ type: z.literal('resize'), cols: dimension, rows: dimension }).strict(),
  z.object({ type: z.literal('scroll'), direction: z.enum(['up', 'down']), lines: z.number().int().min(1).max(MAX_SCROLL_LINES) }).strict(),
  z.object({ type: z.literal('release') }).strict(),
])
const frame = z.object({ type: z.literal('frame'), generation: count.positive(), seq: count.positive(), full: z.boolean(), width: dimension, height: dimension, bytes: text.max(4 * Math.ceil(33_554_432 / 3)) }).strict()
const terminalEvent = z.discriminatedUnion('type', [
  frame,
  z.object({ type: z.literal('ready'), sessionId: id, mode: z.enum(['observe', 'control']), generation: count.positive(), resumed: z.boolean(), afterSeq: count }).strict(),
  z.object({ type: z.literal('closed'), sessionId: id, reason: text.optional(), generation: count.optional() }).strict(),
  z.object({ type: z.literal('conflict'), sessionId: id, message: text, generation: count.optional() }).strict(),
  z.object({ type: z.literal('error'), sessionId: id, code: text, message: text, retryable: z.boolean(), generation: count.optional() }).strict(),
])
const server = z.object({ status: text, running: z.boolean(), version: maybeText, protocol: z.number().nullable(), socket: maybeText, session: maybeText, checked_at: count, installation: z.enum(['installed', 'missing', 'unknown']).optional() }).strict()
const pane = z.object({ pane_id: id, workspace_id: id, tab_id: text.nullish(), title: text.nullish(), label: text.nullish(), terminal_title_stripped: text.nullish(), display_agent: text.nullish(), cwd: text.nullish(), foreground_cwd: text.nullish(), focused: z.boolean(), agent_status: text.nullish() }).strict()
const topology = z.object({
  workspaces: z.array(z.object({ workspace_id: id, label: text.nullish(), active_tab_id: text.nullish(), checkout_path: text.nullish() }).strict()),
  tabs: z.array(z.object({ tab_id: id, workspace_id: id, label: text.nullish(), active_pane_id: text.nullish(), pane_count: count.optional() }).strict()),
  panes: z.array(pane),
}).strict()
const filter = z.object({ project_root: text, matched: count, total: count, hidden_workspaces: z.array(text) }).strict()
const agent = z.object({ pane_id: id, workspace_id: text.optional(), agent: text, name: text.optional(), kind: text.optional(), status: text, message: text.optional(), output: text, outputTruncated: z.boolean().optional(), updated_at: count }).strict()
const status = z.object({ agents: z.array(agent), updated_at: count, connected: z.boolean(), server, topology, filter, last_error: maybeText, stale: z.boolean(), poll_latency_ms: count.optional() }).strict()
const dashboardAgent = z.object({ pane_id: id, name: text.optional(), kind: text, status: text }).strict()
const dashboard = z.object({
  updated_at: count, stale: z.boolean(), last_error: maybeText, server,
  connection: z.object({ connected: z.boolean(), last_success_at: count, collectors: z.object({ server: z.boolean(), topology: z.boolean(), agents: z.boolean(), host: z.boolean(), process: z.boolean() }).strict() }).strict(),
  host: z.object({ hostname: text, platform: text, arch: text, os_type: text, os_release: text, node_version: text }).strict(),
  process: z.object({ available: z.boolean(), pid: z.number().nullable(), started_at: z.number().nullable(), cpu_percent: z.number().nullable(), rss_bytes: z.number().nullable(), source: maybeText, sampled_at: count, error: maybeText }).strict(),
  summary: z.object({ workspaces: count, tabs: count, panes: count, agents: count, agents_by_status: z.record(z.string(), count) }).strict(),
  workspaces: z.array(z.object({ workspace_id: id, label: maybeText, checkout_path_base: maybeText, tab_count: count, pane_count: count, agent_count: count, agents_working: count, agents_blocked: count, agents: z.array(dashboardAgent), panes: z.array(dashboardAgent.extend({ label: maybeText })) }).strict()),
}).strict()
const event = z.discriminatedUnion('type', [
  z.object({ type: z.literal('output'), pane_id: id, revision: count }).strict(),
  z.object({ type: z.literal('agent_status'), pane_id: id, agent: text, status: text, message: text.optional(), workspace_id: text.optional() }).strict(),
  z.object({ type: z.literal('topology'), topology: topology.optional(), filter: filter.optional() }).strict(),
  z.object({ type: z.literal('heartbeat'), stale: z.boolean(), last_error: maybeText }).strict(),
  z.object({ type: z.literal('term'), session_id: id, pane_id: id, event: terminalEvent }).strict(),
])
const terminalReport = z.object({
  activeProcesses: count, observers: count, controllers: count,
  limits: z.object({ maxObservers: count, maxControllers: count, maxProcesses: count }).strict(),
  sessions: z.array(z.object({ sessionId: id, paneId: id, mode: z.enum(['observe', 'control']), generation: count, lastSeq: count, replayBytes: count }).strict()),
}).strict()

export const PANEL_DEFINITIONS = {
  status: { request: z.object({ scope: z.enum(['project', 'all']).optional() }).strict().optional(), result: status },
  dashboard: { request: empty, result: dashboard },
  topology: { request: empty, result: z.object({ server, topology, filter, stale: z.boolean(), last_error: maybeText, updated_at: count, poll_latency_ms: count }).strict() },
  agentOutputs: { request: z.object({ paneIds: text.max(32768).refine(s => s.split(',').filter(Boolean).length <= 64, 'at most 64 pane IDs'), lines: z.number().int().min(1).max(50000).optional(), format: z.enum(['ansi', 'plain']).optional() }).strict(), result: z.object({ outputs: z.array(z.object({ pane_id: id, text: text.optional(), truncated: z.boolean().optional(), revision: count.optional(), error: text.optional() }).strict()).max(64) }).strict() },
  sessionPane: { request: z.object({ agent: text }).strict(), result: z.object({ pane_id: maybeText }).strict() },
  paneSession: { request: z.object({ pane: text }).strict(), result: z.object({ session_id: maybeText }).strict() },
  start: { request: empty, result: mutation.extend({ server: server.optional() }) },
  close: { request: resource, result: mutation },
  rename: { request: resource.extend({ label: text.trim().max(64).nullable().optional() }).refine(v => v.kind !== 'workspace' || !!v.label, 'workspace label is required'), result: mutation },
  paneInput: { request: z.object({ pane_id: id, kind: z.enum(['text', 'keys']).optional(), text: text.max(MAX_INPUT_BYTES).refine(s => new TextEncoder().encode(s).byteLength <= MAX_INPUT_BYTES, 'text exceeds 64 KiB').optional(), keys: z.array(text.min(1).max(64)).min(1).max(32).optional() }).strict().refine(v => !!v.text || !!v.keys?.length, 'text or keys is required'), result: mutation },
  terminalBootstrap: { request: z.object({ pane_id: id, lines: z.number().int().min(1).max(50000).optional(), source: z.enum(['visible', 'recent_unwrapped']).optional() }).strict(), result: mutation.extend({ text: text.optional(), revision: count.optional(), truncated: z.boolean().optional() }) },
  terminalStart: { request: z.object({ pane_id: id, mode: z.enum(['observe', 'control']), cols: dimension, rows: dimension, takeover: z.boolean().optional() }).strict(), result: mutation.extend({ session_id: id.optional(), generation: count.positive().optional() }) },
  terminalAttach: { request: z.object({ session_id: id, generation: count.positive().optional(), after_seq: count.optional() }).strict().refine(v => (v.generation === undefined) === (v.after_seq === undefined), 'generation and after_seq must be provided together'), result: mutation.extend({ events: z.array(terminalEvent).optional() }) },
  terminalCommand: { request: z.object({ session_id: id, command: input }).strict(), result: mutation },
  terminalRelease: { request: z.object({ session_id: id }).strict(), result: mutation },
  terminalStats: { request: empty, result: z.object({ ok: z.literal(true), stats: terminalReport.nullable() }).strict() },
  events: { request: z.object({ after_revision: count.optional() }).strict().optional(), result: event },
} as const
export type PanelMethod = keyof typeof PANEL_DEFINITIONS
export const PANEL_METHODS: readonly PanelMethod[] = Object.freeze(Object.keys(PANEL_DEFINITIONS) as PanelMethod[])
export type PanelRequest<M extends PanelMethod> = z.input<(typeof PANEL_DEFINITIONS)[M]['request']>
export type PanelResult<M extends PanelMethod> = z.output<(typeof PANEL_DEFINITIONS)[M]['result']>

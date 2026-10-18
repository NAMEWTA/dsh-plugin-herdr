import type { Context } from '@deepseek-ai/cordis'
import type { HerdrClient } from './herdr/service.ts'
import type { HerdrTopology, HerdrFilterInfo } from '../contracts/status.ts'
import { StatusTracker } from './status-tracker.ts'
import { HerdrError } from '../core/errors.ts'
import { truncateAnsiTail } from '../core/ansi.ts'
import { isPathWithinProject } from '../core/paths.ts'
import { getBoundPaneIds } from './binding-registry.ts'
import { createLogger, createRateLimiter } from './log.ts'
import { probeHerdrInstallation, serverInfoFromPing, type PingProbeFn } from './herdr/server.ts'
export type * from '../contracts/status.ts'
export { startHerdrServer, probeHerdrInstallation, serverInfoFromPing, type PingProbeFn, type SpawnFn } from './herdr/server.ts'
export { comparePaneId } from '../core/ids.ts'
export const OUTPUT_CAP = 8000

/** Project grouping is a view filter, not an authorization check. */
export function filterTopology(topology: HerdrTopology, projectRoot: string, boundPaneIds: string[]): { filtered: HerdrTopology; filterInfo: HerdrFilterInfo } {
  const bound = new Set(boundPaneIds)
  const keep = new Set(topology.workspaces.filter(workspace => projectRoot === '' || isPathWithinProject(projectRoot, workspace.checkout_path) || topology.panes.some(pane => pane.workspace_id === workspace.workspace_id && (bound.has(pane.pane_id) || isPathWithinProject(projectRoot, pane.cwd) || isPathWithinProject(projectRoot, pane.foreground_cwd)))).map(workspace => workspace.workspace_id))
  return {
    filtered: { workspaces: topology.workspaces.filter(item => keep.has(item.workspace_id)), tabs: topology.tabs.filter(item => keep.has(item.workspace_id)), panes: topology.panes.filter(item => keep.has(item.workspace_id)) },
    filterInfo: { project_root: projectRoot, matched: keep.size, total: topology.workspaces.length, hidden_workspaces: topology.workspaces.filter(workspace => !keep.has(workspace.workspace_id)).map(workspace => workspace.workspace_id) },
  }
}
const text = (value: unknown): string | undefined => typeof value === 'string' ? value : undefined
export interface HerdrStatusTrackerOptions {
  pollIntervalMs?: number
  staleThresholdMs?: number
  socketPath?: string | null
  session?: string | null
  pingFn?: PingProbeFn
  projectRoot?: string
  getBoundPaneIds?: () => string[]
  binPath?: string
}
/** Cordis supplies event subscriptions; the tested tracker owns reconciliation. */
export class HerdrStatusTracker extends StatusTracker {
  private readonly stops: Array<() => void> = []
  private started = false
  constructor(private readonly ctx: Context, private readonly client: HerdrClient, opts: HerdrStatusTrackerOptions = {}) {
    const logger = createLogger(ctx, 'status')
    const limited = createRateLimiter(10_000)
    const projectRoot = opts.projectRoot ?? process.cwd()
    super({
      server: async signal => {
        let ping
        try { ping = opts.pingFn ? await opts.pingFn() : await client.ping(signal) }
        catch (error) { if (error instanceof HerdrError && error.code === 'HERDR_UNAVAILABLE') ping = null; else throw error }
        const installation = ping ? 'installed' as const : await probeHerdrInstallation(opts.binPath)
        return serverInfoFromPing(ping, opts.socketPath ?? null, opts.session ?? null, ping ? 'running' : 'not_running', installation)
      },
      topology: async signal => {
        const snapshot = await client.snapshot(signal)
        return {
          workspaces: snapshot.workspaces.map(workspace => ({ workspace_id: workspace.workspace_id, label: text(workspace.label), active_tab_id: text(workspace.active_tab_id), checkout_path: text((workspace as { worktree?: { checkout_path?: string } | null }).worktree?.checkout_path) })),
          tabs: snapshot.tabs.map(tab => ({ tab_id: tab.tab_id, workspace_id: tab.workspace_id, label: text(tab.label), active_pane_id: text((tab as { active_pane_id?: string }).active_pane_id), pane_count: tab.pane_count })),
          panes: snapshot.panes.map(pane => ({ pane_id: pane.pane_id, workspace_id: pane.workspace_id, tab_id: text(pane.tab_id), label: text(pane.label), title: text((pane as { title?: string }).title ?? pane.terminal_title), terminal_title_stripped: text(pane.terminal_title_stripped), display_agent: text(pane.display_agent), cwd: text(pane.cwd), foreground_cwd: text(pane.foreground_cwd), focused: pane.focused === true, agent_status: text(pane.agent_status) })),
        }
      },
      agents: async signal => (await client.listAgents(undefined, signal)).filter(agent => !!agent.pane_id).map(agent => {
        const raw = agent as { name?: string | null; kind?: string | null }
        return { pane_id: agent.pane_id!, workspace_id: text(agent.workspace_id), agent: agent.agent ?? 'unknown', name: raw.name ?? undefined, kind: raw.kind ?? agent.agent ?? undefined, status: agent.status ?? 'unknown', message: agent.message ?? undefined }
      }),
      output: async (paneId, signal) => {
        const { text, truncated } = await client.paneRead({ pane_id: paneId, source: 'recent_unwrapped', lines: 300, format: 'ansi' }, signal)
        return { output: truncateAnsiTail(text, OUTPUT_CAP), outputTruncated: truncated || text.length > OUTPUT_CAP }
      },
      filter: topology => filterTopology(topology, projectRoot, (opts.getBoundPaneIds ?? getBoundPaneIds)()),
      warn: message => limited(message, () => logger.warn('%s', message)),
    }, opts)
  }
  override start(): void {
    if (this.started) return
    this.started = true
    this.stops.push(this.ctx.on('herdr/agent-state', info => this.onAgentState(info)))
    this.stops.push(this.ctx.on('herdr/resource-changed', change => this.onResourceChanged(change)))
    const client = this.client as HerdrClient & { onEvent?: (handler: (event: unknown) => void) => () => void }
    if (client.onEvent) this.stops.push(client.onEvent(event => this.onHerdrEvent(event)))
    super.start()
  }
  override stop(): void {
    this.started = false
    for (const stop of this.stops.splice(0)) { try { stop() } catch { /* complete cleanup */ } }
    super.stop()
  }
}

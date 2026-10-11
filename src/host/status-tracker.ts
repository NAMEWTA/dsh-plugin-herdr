import type { HerdrAgentStatus, HerdrFilterInfo, HerdrServerInfo, HerdrStatusSnapshot, HerdrTopology } from '../contracts/status.ts'
import { TOPOLOGY_EVENTS } from '../contracts/events.ts'
import { comparePaneId } from '../core/ids.ts'

export interface StatusPorts {
  server(signal: AbortSignal): Promise<HerdrServerInfo>
  topology(signal: AbortSignal): Promise<HerdrTopology>
  agents(signal: AbortSignal): Promise<Array<Omit<HerdrAgentStatus, 'output' | 'updated_at'>>>
  output(paneId: string, signal: AbortSignal): Promise<{ output: string; outputTruncated: boolean }>
  filter(topology: HerdrTopology): { filtered: HerdrTopology; filterInfo: HerdrFilterInfo }
  warn(message: string): void
}
export interface StatusTrackerOptions { pollIntervalMs?: number; staleThresholdMs?: number; heartbeatIntervalMs?: number; now?: () => number }
const emptyTopology = (): HerdrTopology => ({ workspaces: [], tabs: [], panes: [] })

/** Single-flight reconciliation. Errors belong to collectors, not message strings. */
export class StatusTracker {
  private readonly agents = new Map<string, HerdrAgentStatus>()
  private full = emptyTopology()
  private filtered = emptyTopology()
  private filterInfo: HerdrFilterInfo = { project_root: '', matched: 0, total: 0, hidden_workspaces: [] }
  private serverInfo: HerdrServerInfo = { status: 'unknown', running: false, version: null, protocol: null, socket: null, session: null, checked_at: 0, installation: 'unknown' }
  private revision = 0
  private readonly eventRevisions = new Map<string, number>()
  private readonly errors = new Map<string, string>()
  private readonly successes = new Map<string, number>()
  private dirtyPanes = new Set<string>()
  private dirtyTopology = true
  private timer?: ReturnType<typeof setInterval>
  private debounce?: ReturnType<typeof setTimeout>
  private controller: AbortController | null = null
  private cycle: Promise<void> | null = null
  private lastHeartbeatAt = 0
  private pollLatencyMs = 0
  private updatedAt = 0
  private readonly interval: number
  private readonly heartbeat: number
  private readonly staleThreshold: number
  private readonly now: () => number

  constructor(private readonly ports: StatusPorts, options: StatusTrackerOptions = {}) {
    this.interval = options.pollIntervalMs ?? 2000
    this.heartbeat = options.heartbeatIntervalMs ?? 10000
    this.staleThreshold = options.staleThresholdMs ?? Math.max(this.interval * 3, this.heartbeat * 2)
    this.now = options.now ?? Date.now
  }
  start(): void {
    if (this.controller) return
    this.controller = new AbortController()
    this.lastHeartbeatAt = 0
    this.dirtyTopology = true
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.interval)
    this.timer.unref?.()
  }
  stop(): void {
    if (this.timer) clearInterval(this.timer)
    if (this.debounce) clearTimeout(this.debounce)
    this.timer = this.debounce = undefined
    this.controller?.abort()
    this.controller = null
    this.cycle = null
  }
  /** Also used by event debounce; it must never bypass the cycle's single-flight guard. */
  refresh(): Promise<void> {
    const controller = this.controller
    if (!controller) return Promise.resolve()
    if (this.cycle) return this.cycle
    const signal = controller.signal
    const startedAt = this.now()
    const full = this.lastHeartbeatAt === 0 || startedAt - this.lastHeartbeatAt >= this.heartbeat || ['server', 'topology', 'agents'].some(key => !this.successes.has(key) || this.errors.has(key))
    if (full) this.lastHeartbeatAt = startedAt
    const topology = full || this.dirtyTopology
    if (topology) this.dirtyTopology = false
    // Swap before awaiting: an event for the same pane arriving during I/O is new work.
    const dirty = this.dirtyPanes
    this.dirtyPanes = new Set()
    const active = () => this.controller === controller && !signal.aborted
    const work = (async () => {
      await Promise.all([
        this.collect('server', signal, active, async () => { const server = await this.ports.server(signal); if (active()) this.serverInfo = server }),
        topology ? this.collect('topology', signal, active, async () => {
          const value = await this.ports.topology(signal)
          if (!active()) return
          const filtered = this.ports.filter(value)
          this.full = value
          this.filtered = filtered.filtered
          this.filterInfo = filtered.filterInfo
        }) : Promise.resolve(),
        full ? this.collect('agents', signal, active, async () => {
          const observed = this.revision
          const values = await this.ports.agents(signal)
          if (!active()) return
          const seen = new Set<string>()
          for (const value of values) {
            seen.add(value.pane_id)
            const old = this.agents.get(value.pane_id)
            const changed = (this.eventRevisions.get(value.pane_id) ?? 0) > observed
            if (changed && !old) continue // a close event arrived after the snapshot request
            this.agents.set(value.pane_id, { ...old, ...value, ...(changed && old ? { agent: old.agent, status: old.status, message: old.message } : {}), output: old?.output ?? '', outputTruncated: old?.outputTruncated, updated_at: !old || old.status !== value.status ? this.now() : old.updated_at })
          }
          for (const paneId of this.agents.keys()) if (!seen.has(paneId) && (this.eventRevisions.get(paneId) ?? 0) <= observed) {
            this.agents.delete(paneId)
            this.errors.delete('output:' + paneId)
          }
          for (const [paneId, revision] of this.eventRevisions) if (revision <= observed) this.eventRevisions.delete(paneId)
        }) : Promise.resolve(),
      ])
      if (!active()) return
      if (this.errors.has('topology')) this.dirtyTopology = true
      const panes = [...this.agents.values()].filter(agent => full || dirty.has(agent.pane_id))
        .sort((a, b) => Number(b.status === 'working') - Number(a.status === 'working') || comparePaneId(a.pane_id, b.pane_id))
      let index = 0
      const worker = async () => {
        while (index < panes.length && active()) {
          const paneId = panes[index++]!.pane_id
          await this.collect('output:' + paneId, signal, active, async () => {
            const value = await this.ports.output(paneId, signal)
            if (!active()) return
            // Merge into the current entry, not an object captured before await.
            const current = this.agents.get(paneId)
            if (current) this.agents.set(paneId, { ...current, ...value, updated_at: value.output !== current.output || value.outputTruncated !== current.outputTruncated ? this.now() : current.updated_at })
          })
          if (this.errors.has('output:' + paneId)) this.dirtyPanes.add(paneId)
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, panes.length) }, worker))
      if (active()) this.errors.delete('cycle')
    })().catch(error => { if (active()) this.errors.set('cycle', String(error)) }).finally(() => {
      if (this.cycle !== work) return
      this.cycle = null
      if (active()) this.pollLatencyMs = this.now() - startedAt
    })
    this.cycle = work
    return work
  }
  private async collect(key: string, _signal: AbortSignal, active: () => boolean, run: () => Promise<void>): Promise<void> {
    try {
      await run()
      if (!active()) return
      this.errors.delete(key)
      this.successes.set(key, this.now())
      this.updatedAt = this.now()
    } catch (error) {
      if (!active()) return
      const message = `${key === 'topology' ? 'topology poll' : key === 'agents' ? 'agent poll' : key === 'server' ? 'server probe' : 'pane read'} failed: ${error instanceof Error ? error.message : String(error)}`
      this.errors.set(key, message)
      this.ports.warn(message)
    }
  }
  snapshot(scope: 'all' | 'project' = 'project'): HerdrStatusSnapshot {
    const stale = !this.serverInfo.running || this.errors.size > 0 || ['server', 'topology', 'agents'].some(key => {
      const last = this.successes.get(key)
      return last === undefined || this.now() - last > this.staleThreshold
    })
    const topology = scope === 'all' ? this.full : this.filtered
    return {
      agents: [...this.agents.values()].sort((a, b) => comparePaneId(a.pane_id, b.pane_id)).map(agent => ({ ...agent })),
      updated_at: this.updatedAt,
      connected: this.serverInfo.running,
      server: { ...this.serverInfo },
      topology: { workspaces: topology.workspaces.map(item => ({ ...item })), tabs: topology.tabs.map(item => ({ ...item })), panes: topology.panes.map(item => ({ ...item })), },
      filter: { ...this.filterInfo, hidden_workspaces: [...this.filterInfo.hidden_workspaces] },
      stale,
      last_error: this.errors.values().next().value ?? null,
      poll_latency_ms: this.pollLatencyMs,
    }
  }
  onAgentState(info: { pane_id: string; agent: string; status: string; message?: string }): void {
    this.eventRevisions.set(info.pane_id, ++this.revision)
    const old = this.agents.get(info.pane_id)
    this.agents.set(info.pane_id, { ...old, ...info, output: old?.output ?? '', updated_at: this.now() })
  }
  onResourceChanged(change: { type: string; action: string; id: string }): void {
    if (change.type === 'pane' && change.action === 'closed') {
      this.eventRevisions.set(change.id, ++this.revision)
      this.agents.delete(change.id)
      this.errors.delete('output:' + change.id)
    }
    if (['workspace', 'tab', 'pane'].includes(change.type)) this.invalidateTopology()
  }
  onHerdrEvent(event: unknown): void {
    const raw = event as { event?: string; data?: Record<string, unknown> } | undefined
    const data = raw?.data ?? {}
    const type = String(data.type ?? raw?.event ?? '')
    if (type === 'pane_output_changed' && typeof data.pane_id === 'string') this.dirtyPanes.add(data.pane_id)
    else if ((type === 'pane_agent_status_changed' || type === 'pane_agent_detected') && typeof data.pane_id === 'string') {
      this.onAgentState({ pane_id: data.pane_id, agent: String(data.agent ?? 'unknown'), status: String(data.agent_status ?? data.status ?? 'unknown'), ...(data.message == null ? {} : { message: String(data.message) }) })
    } else if (TOPOLOGY_EVENTS.has(type)) this.invalidateTopology()
  }
  private invalidateTopology(): void {
    this.dirtyTopology = true
    if (this.debounce) clearTimeout(this.debounce)
    this.debounce = setTimeout(() => { this.debounce = undefined; void this.refresh() }, 200)
    this.debounce.unref?.()
  }
  getDiagnostics() { return { pollLatencyMs: this.pollLatencyMs, dirtyPaneIdsSize: this.dirtyPanes.size, dirtyTopology: this.dirtyTopology, lastHeartbeatAt: this.lastHeartbeatAt } }
}

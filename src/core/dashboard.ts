import { comparePaneId, compareWorkspaceId } from './ids.ts'
import type { HerdrDashboardWorkspace, HerdrDashboardSummary, HerdrDashboardAgent } from '../contracts/dashboard.ts'
export type DashboardWorkspaceAgg = HerdrDashboardWorkspace
export type DashboardSummaryLike = HerdrDashboardSummary
export interface DashboardAgentLike { pane_id?: string | null; workspace_id?: string | null; name?: string | null; kind?: string | null; agent?: string | null; status?: string | null }
export interface DashboardTopologyLike {
  workspaces: ReadonlyArray<{ workspace_id?: string; label?: string | null; checkout_path?: string | null }>
  tabs: ReadonlyArray<{ workspace_id?: string }>
  panes: ReadonlyArray<{ pane_id?: string; workspace_id?: string; label?: string | null; agent_status?: string }>
}
export function pathBase(path: string | null | undefined): string | null {
  const cleaned = path?.replace(/[\\/]+$/, '')
  if (!cleaned) return null
  return cleaned.slice(Math.max(cleaned.lastIndexOf('/'), cleaned.lastIndexOf('\\')) + 1) || null
}
export const deriveStale = (updatedAt: number, now: number, thresholdMs: number): boolean => updatedAt === 0 || now - updatedAt > thresholdMs
export const shouldProbeNow = (last: number, now: number, interval: number): boolean => last === 0 || now - last >= interval
export function agentStatusCounts(agents: ReadonlyArray<{ status?: string | null }>): Record<string, number> {
  // A Map treats upstream strings such as '__proto__' as data, not object keys.
  const counts = new Map<string, number>()
  for (const agent of agents) { const key = agent.status || 'unknown'; counts.set(key, (counts.get(key) ?? 0) + 1) }
  return Object.fromEntries(counts)
}
export function aggregateDashboardWorkspaces(topology: DashboardTopologyLike, agents: ReadonlyArray<DashboardAgentLike>): DashboardWorkspaceAgg[] {
  const tabCounts = new Map<string, number>()
  const panesByWorkspace = new Map<string, Array<DashboardTopologyLike['panes'][number]>>()
  const workspaceByPane = new Map<string, string>()
  const agentsByWorkspace = new Map<string, HerdrDashboardAgent[]>()
  for (const tab of topology.tabs) if (tab.workspace_id) tabCounts.set(tab.workspace_id, (tabCounts.get(tab.workspace_id) ?? 0) + 1)
  for (const pane of topology.panes) {
    if (!pane.workspace_id) continue
    const group = panesByWorkspace.get(pane.workspace_id) ?? []
    group.push(pane)
    panesByWorkspace.set(pane.workspace_id, group)
    if (pane.pane_id) workspaceByPane.set(pane.pane_id, pane.workspace_id)
  }
  for (const agent of agents) {
    if (!agent.pane_id) continue
    const workspace = agent.workspace_id ?? workspaceByPane.get(agent.pane_id)
    if (!workspace) continue
    const group = agentsByWorkspace.get(workspace) ?? []
    group.push({ pane_id: agent.pane_id, name: agent.name ?? undefined, kind: agent.kind?.trim() ? agent.kind : agent.agent?.trim() ? agent.agent : 'unknown', status: agent.status || 'unknown' })
    agentsByWorkspace.set(workspace, group)
  }
  return topology.workspaces.filter((workspace): workspace is DashboardTopologyLike['workspaces'][number] & { workspace_id: string } => !!workspace.workspace_id).map(workspace => {
    const panes = panesByWorkspace.get(workspace.workspace_id) ?? []
    const members = agentsByWorkspace.get(workspace.workspace_id) ?? []
    const counts = agentStatusCounts(members)
    const byPane = new Map(members.map(agent => [agent.pane_id, agent]))
    return {
      workspace_id: workspace.workspace_id, label: workspace.label ?? null,
      checkout_path_base: pathBase(workspace.checkout_path), tab_count: tabCounts.get(workspace.workspace_id) ?? 0,
      pane_count: panes.length, agent_count: members.length, agents_working: counts.working ?? 0,
      agents_blocked: counts.blocked ?? 0, agents: members,
      panes: panes.filter((pane): pane is typeof pane & { pane_id: string } => !!pane.pane_id).map(pane => {
        const agent = byPane.get(pane.pane_id)
        return { pane_id: pane.pane_id, label: pane.label ?? null, name: agent?.name, kind: agent?.kind ?? 'unknown', status: agent?.status ?? pane.agent_status ?? 'unknown' }
      }).sort((a, b) => comparePaneId(a.pane_id, b.pane_id)),
    }
  }).sort((a, b) => compareWorkspaceId(a.workspace_id, b.workspace_id))
}
export function buildDashboardSummary(workspaces: ReadonlyArray<Pick<DashboardWorkspaceAgg, 'tab_count' | 'pane_count'>>, agents: ReadonlyArray<DashboardAgentLike>): DashboardSummaryLike {
  return { workspaces: workspaces.length, tabs: workspaces.reduce((sum, workspace) => sum + workspace.tab_count, 0), panes: workspaces.reduce((sum, workspace) => sum + workspace.pane_count, 0), agents: agents.length, agents_by_status: agentStatusCounts(agents) }
}

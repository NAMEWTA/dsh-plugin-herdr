/** Dashboard DTOs are environment-neutral and shared by Host and Web. */
export interface HerdrDashboardHost { hostname: string; platform: string; arch: string; os_type: string; os_release: string; node_version: string }
export interface HerdrDashboardProcess { available: boolean; pid: number | null; started_at: number | null; cpu_percent: number | null; rss_bytes: number | null; source: string | null; sampled_at: number; error: string | null }
export interface HerdrDashboardServerInfo { status: string; running: boolean; version: string | null; protocol: number | null; socket: string | null; session: string | null; checked_at: number; installation: 'installed' | 'missing' | 'unknown' }
export interface HerdrDashboardConnection { connected: boolean; last_success_at: number; collectors: { server: boolean; topology: boolean; agents: boolean; host: boolean; process: boolean } }
export interface HerdrDashboardAgent { pane_id: string; name?: string; kind: string; status: string }
export interface HerdrDashboardPaneRef { pane_id: string }
export interface HerdrDashboardPane extends HerdrDashboardAgent { label: string | null }
export interface HerdrDashboardWorkspace {
  workspace_id: string
  label: string | null
  checkout_path_base: string | null
  tab_count: number
  pane_count: number
  agent_count: number
  agents_working: number
  agents_blocked: number
  agents: HerdrDashboardAgent[]
  panes: HerdrDashboardPane[]
}
export interface HerdrDashboardSummary { workspaces: number; tabs: number; panes: number; agents: number; agents_by_status: Record<string, number> }
export interface HerdrDashboardSnapshot { updated_at: number; stale: boolean; last_error: string | null; server: HerdrDashboardServerInfo; connection: HerdrDashboardConnection; host: HerdrDashboardHost; process: HerdrDashboardProcess; summary: HerdrDashboardSummary; workspaces: HerdrDashboardWorkspace[] }

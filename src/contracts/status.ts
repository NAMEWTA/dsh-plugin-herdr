/** Environment-neutral status DTOs shared by the Host and Remote contract. */
export interface HerdrAgentStatus {
  pane_id: string
  workspace_id?: string
  agent: string
  name?: string
  kind?: string
  status: string
  message?: string
  output: string
  outputTruncated?: boolean
  updated_at: number
}
export interface HerdrWorkspaceView { workspace_id: string; label?: string; active_tab_id?: string; checkout_path?: string }
export interface HerdrTabView { tab_id: string; workspace_id: string; label?: string; active_pane_id?: string; pane_count?: number }
export interface HerdrPaneView {
  pane_id: string
  workspace_id: string
  tab_id?: string
  title?: string
  terminal_title_stripped?: string
  display_agent?: string
  label?: string
  cwd?: string
  foreground_cwd?: string
  focused: boolean
  agent_status?: string
}
export interface HerdrTopology { workspaces: HerdrWorkspaceView[]; tabs: HerdrTabView[]; panes: HerdrPaneView[] }
export interface HerdrFilterInfo { project_root: string; matched: number; total: number; hidden_workspaces: string[] }
export type HerdrInstallation = 'installed' | 'missing' | 'unknown'
export interface HerdrServerInfo {
  status: string
  running: boolean
  version: string | null
  protocol: number | null
  socket: string | null
  session: string | null
  checked_at: number
  installation: HerdrInstallation
}
export interface HerdrStatusSnapshot {
  agents: HerdrAgentStatus[]
  updated_at: number
  connected: boolean
  server: HerdrServerInfo
  topology: HerdrTopology
  filter: HerdrFilterInfo
  last_error: string | null
  stale: boolean
  poll_latency_ms?: number
}

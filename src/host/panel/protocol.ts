/** Legacy import path for neutral panel DTOs. Runtime validation lives in contracts/panel-schemas. */
import type { HerdrDashboardSnapshot } from '../../contracts/dashboard.ts'
import type { HerdrStatusSnapshot } from '../../contracts/status.ts'
import type { BrowserTerminalCommand, BrowserTerminalEvent, TerminalSessionStartRequest } from '../../contracts/terminal.ts'
export type { HerdrDashboardSnapshot, HerdrStatusSnapshot }
export type PanelScope = 'project' | 'all'
export type PanelResourceKind = 'workspace' | 'pane'
export type PanelOutputFormat = 'ansi' | 'plain'
export type PanelTerminalSource = 'visible' | 'recent_unwrapped'
export interface PanelOutputEntry { pane_id: string; text?: string; truncated?: boolean; revision?: number; error?: string }
export interface PanelAgentOutputs { outputs: PanelOutputEntry[] }
export interface PanelSessionPane { pane_id: string | null }
export interface PanelPaneSession { session_id: string | null }
export interface PanelMutationResult { ok: boolean; error?: string; code?: string }
export interface PanelStartResult extends PanelMutationResult { server?: HerdrStatusSnapshot['server'] }
export interface PanelCloseRequest { kind: PanelResourceKind; id: string }
export interface PanelRenameRequest extends PanelCloseRequest { label?: string | null }
export interface PanelInputRequest { pane_id: string; kind?: 'text' | 'keys'; text?: string; keys?: string[] }
export interface PanelBootstrapRequest { pane_id: string; lines?: number; source?: PanelTerminalSource }
export interface PanelBootstrapResult extends PanelMutationResult { text?: string; revision?: number; truncated?: boolean }
export type PanelTerminalStartRequest = TerminalSessionStartRequest
export interface PanelTerminalCommandRequest { session_id: string; command: BrowserTerminalCommand }
export interface PanelTerminalReleaseRequest { session_id: string }
export interface PanelTopology { server: HerdrStatusSnapshot['server']; topology: HerdrStatusSnapshot['topology']; filter: HerdrStatusSnapshot['filter']; stale: boolean; last_error: string | null; updated_at: number; poll_latency_ms: number }
export type PanelEvent =
  | { type: 'output'; pane_id: string; revision: number }
  | { type: 'agent_status'; pane_id: string; agent: string; status: string; message?: string; workspace_id?: string }
  | { type: 'topology'; topology?: HerdrStatusSnapshot['topology']; filter?: HerdrStatusSnapshot['filter'] }
  | { type: 'heartbeat'; stale: boolean; last_error: string | null }
  | { type: 'term'; session_id: string; pane_id: string; event: BrowserTerminalEvent }
export interface PanelEventsRequest { after_revision?: number }

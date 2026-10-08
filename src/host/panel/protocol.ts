// Panel wire contract shared by the Host Remote service and the Web client.
// Values are plain JSON so Typert strict codecs can validate them.

import type { HerdrDashboardSnapshot } from '../../web/dashboard-types.ts'
import type { HerdrStatusSnapshot } from '../../web/types.ts'

export type PanelScope = 'project' | 'all'
export type PanelResourceKind = 'workspace' | 'pane'
export type PanelOutputFormat = 'ansi' | 'plain'
export type PanelTerminalSource = 'visible' | 'recent_unwrapped'

export interface PanelOutputEntry {
  pane_id: string
  text?: string
  truncated?: boolean
  revision?: number
  error?: string
}

export interface PanelAgentOutputs {
  outputs: PanelOutputEntry[]
}

export interface PanelSessionPane {
  pane_id: string | null
}

export interface PanelPaneSession {
  session_id: string | null
}

export interface PanelStartResult {
  ok: boolean
  error?: string
  server?: HerdrStatusSnapshot['server']
}

export interface PanelMutationResult {
  ok: boolean
  error?: string
  /** Structured error code (terminal session errors); the web localizes by code. */
  code?: string
}

export interface PanelCloseRequest {
  kind: PanelResourceKind
  id: string
}

export interface PanelRenameRequest {
  kind: PanelResourceKind
  id: string
  label?: string | null
}

export interface PanelInputRequest {
  pane_id: string
  kind?: 'text' | 'keys'
  text?: string
  keys?: string[]
}

export interface PanelBootstrapRequest {
  pane_id: string
  lines?: number
  source?: PanelTerminalSource
}

export interface PanelBootstrapResult {
  ok: boolean
  text?: string
  revision?: number
  truncated?: boolean
  error?: string
}

export interface PanelTerminalStartRequest {
  pane_id: string
  mode: 'observe' | 'control'
  cols: number
  rows: number
  takeover?: boolean
  generation?: number
}

export interface PanelTerminalCommandRequest {
  session_id: string
  command: Record<string, unknown>
}

export interface PanelTerminalReleaseRequest {
  session_id: string
}

export interface PanelTopology {
  server: HerdrStatusSnapshot['server']
  topology: HerdrStatusSnapshot['topology']
  filter: HerdrStatusSnapshot['filter']
  stale: boolean
  last_error: string | null
  updated_at: number
  poll_latency_ms: number
}

export type PanelEvent =
  | { type: 'output'; pane_id: string; revision: number }
  | { type: 'agent_status'; pane_id: string; agent: string; status: string; message?: string; workspace_id?: string }
  | { type: 'topology'; topology?: HerdrStatusSnapshot['topology']; filter?: HerdrStatusSnapshot['filter'] }
  | { type: 'heartbeat'; stale: boolean; last_error: string | null }
  | { type: 'term'; session_id: string; pane_id: string; event: unknown }

export interface PanelEventsRequest {
  after_revision?: number
}

export type { HerdrDashboardSnapshot, HerdrStatusSnapshot }

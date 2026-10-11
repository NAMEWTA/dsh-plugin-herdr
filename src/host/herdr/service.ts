import { Service, type Context } from '@deepseek-ai/cordis'
import type { AgentInfo, AgentStatus, PaneInfo, PaneLayoutSnapshot, SessionSnapshot, TabInfo, WorkspaceInfo } from '../../core/protocol.js'
export type { AgentInfo, AgentStatus, PaneAgentState, SplitDirection, ReadSource } from '../../core/protocol.js'
declare module '@deepseek-ai/cordis' { interface Context { herdr: HerdrClient } }

export interface HerdrSnapshot extends Omit<SessionSnapshot, 'agents' | 'panes' | 'workspaces' | 'tabs' | 'layouts'> {
  agents: HerdrAgentInfo[]
  panes: PaneInfo[]
  workspaces: WorkspaceInfo[]
  tabs: TabInfo[]
  layouts: PaneLayoutSnapshot[]
}
export interface HerdrPaneInfo {
  pane_id: string; workspace_id: string; tab_id: string; cwd?: string; foreground_cwd?: string | null
  focused: boolean; agent_status?: string; revision?: number; [key: string]: unknown
}
export interface HerdrAgentInfo {
  pane_id?: string; workspace_id?: string; tab_id?: string; agent?: string | null; status?: AgentStatus
  message?: string | null; foreground_cwd?: string | null; [key: string]: unknown
}
export interface AgentFilter { workspace_id?: string; status?: AgentStatus }
export interface RunCommandRequest {
  command: string; pane_id?: string; workspace_id?: string; direction?: 'right' | 'down'; ratio?: number
  cwd?: string; env?: Record<string, string>; wait_ms?: number
}
export type RunCommandResult =
  | { kind: 'completed'; pane_id: string; exit_code: number | null; output: string; truncated: boolean; timed_out?: boolean }
  | { kind: 'background'; jobId: string }
export interface WaitAgentRequest { target: string; until: AgentStatus[]; timeout_ms?: number }
export type WaitAgentResult =
  | { kind: 'completed'; pane_id?: string; agent?: string; status: AgentStatus; message?: string; waited_ms: number }
  | { kind: 'timeout'; pane_id?: string; agent?: string; status?: AgentStatus; waited_ms: number }
  | { kind: 'not_found'; target: string }
export interface WorkspaceCreateRequest { cwd?: string; label?: string; env?: Record<string, string> }
export interface PaneSplitRequest { pane_id?: string; workspace_id?: string; direction: 'right' | 'down'; ratio?: number; cwd?: string; env?: Record<string, string> }
export interface PaneSendKeysRequest { pane_id: string; keys: string[] }
export interface PaneSendInputRequest { pane_id: string; text?: string; keys?: string[] }
export interface PaneReadRequest { pane_id: string; source?: 'visible' | 'recent' | 'recent_unwrapped' | 'detection'; lines?: number; format?: 'text' | 'ansi' }
export interface PaneOutputChangeRequest { pane_id: string; min_revision: number; timeout_ms?: number }
export interface PaneOutputChangeResult { changed: boolean; revision: number }
export interface PaneLayoutRequest { pane_id?: string }
export interface LayoutApplyRequest { root: unknown; workspace_id?: string; tab_id?: string; tab_label?: string; focus?: boolean }
export interface AgentPromptRequest { target: string; text: string; wait?: boolean; until?: AgentStatus[]; timeout_ms?: number }
export interface AgentStartRequest { name: string; kind: string; pane_id: string; args?: string[]; timeout_ms?: number }
export interface AgentExplainRequest { target?: string }
export interface AgentSendKeysRequest { target: string; keys: string[] }
export interface NotificationShowRequest { title: string; body?: string; position?: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right'; sound?: 'none' | 'done' | 'request' }
export interface AgentPromptResult { submitted: true; status?: string; message?: string; waited_ms?: number }
export type PaneReportState = 'idle' | 'working' | 'blocked' | 'unknown'
export interface ReportAgentRequest { pane_id: string; source: string; agent: string; state: PaneReportState; message?: string }
export interface ReportMetadataRequest { pane_id: string; source: string; agent?: string; title?: string | null; tokens?: Record<string, string | null>; ttl_ms?: number | null }
export interface ClearAgentAuthorityRequest { pane_id: string; source?: string; agent?: string }

/** Socket-facing application port. Optional cancellation is propagated to I/O. */
export abstract class HerdrClient extends Service {
  constructor(ctx: Context) { super(ctx, 'herdr') }
  abstract ping(signal?: AbortSignal): Promise<{ version: string; protocol: number }>
  abstract snapshot(signal?: AbortSignal): Promise<HerdrSnapshot>
  abstract listAgents(filter?: AgentFilter, signal?: AbortSignal): Promise<HerdrAgentInfo[]>
  abstract runCommand(req: RunCommandRequest, signal: AbortSignal): Promise<RunCommandResult>
  abstract waitAgent(req: WaitAgentRequest, signal: AbortSignal): Promise<WaitAgentResult>
  abstract workspaceCreate(req: WorkspaceCreateRequest, signal?: AbortSignal): Promise<{ workspace_id: string; pane_id?: string }>
  abstract paneSplit(req: PaneSplitRequest, signal?: AbortSignal): Promise<{ pane_id: string }>
  abstract paneClose(paneId: string, signal?: AbortSignal): Promise<void>
  abstract workspaceClose(workspaceId: string, signal?: AbortSignal): Promise<void>
  abstract workspaceRename(workspaceId: string, label: string, signal?: AbortSignal): Promise<void>
  abstract paneRename(paneId: string, label: string | null, signal?: AbortSignal): Promise<void>
  abstract paneSendKeys(req: PaneSendKeysRequest, signal?: AbortSignal): Promise<void>
  abstract paneSendInput(req: PaneSendInputRequest, signal?: AbortSignal): Promise<void>
  abstract paneRead(req: PaneReadRequest, signal?: AbortSignal): Promise<{ text: string; truncated: boolean; revision?: number }>
  abstract paneWaitForOutputChange(req: PaneOutputChangeRequest, signal?: AbortSignal): Promise<PaneOutputChangeResult>
  abstract paneLayout(req: PaneLayoutRequest, signal?: AbortSignal): Promise<unknown>
  abstract layoutApply(req: LayoutApplyRequest, signal?: AbortSignal): Promise<unknown>
  abstract agentPrompt(req: AgentPromptRequest, signal: AbortSignal): Promise<AgentPromptResult>
  abstract agentStart(req: AgentStartRequest, signal?: AbortSignal): Promise<AgentInfo>
  abstract agentExplain(req: AgentExplainRequest, signal?: AbortSignal): Promise<unknown>
  abstract agentSendKeys(req: AgentSendKeysRequest, signal?: AbortSignal): Promise<void>
  abstract showNotification(req: NotificationShowRequest, signal?: AbortSignal): Promise<void>
  abstract reportAgent(req: ReportAgentRequest, signal?: AbortSignal): Promise<void>
  abstract reportMetadata(req: ReportMetadataRequest, signal?: AbortSignal): Promise<void>
  abstract clearAgentAuthority(req: ClearAgentAuthorityRequest, signal?: AbortSignal): Promise<void>
}

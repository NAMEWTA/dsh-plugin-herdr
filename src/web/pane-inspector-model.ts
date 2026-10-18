import type { HerdrDashboardSnapshot } from './dashboard-types.ts'
import type { HerdrTopology, HerdrStatusSnapshot } from './types.ts'
import type { HerdrEnvironmentReport } from '../core/environment.ts'

export function findInspectedPane(snapshot: HerdrDashboardSnapshot | null, paneId: string | null,
  hiddenPanes: ReadonlySet<string> = new Set(), hiddenWorkspaces: ReadonlySet<string> = new Set(), topology?: HerdrTopology) {
  if (!paneId || hiddenPanes.has(paneId)) return null
  for (const workspace of snapshot?.workspaces ?? []) {
    if (hiddenWorkspaces.has(workspace.workspace_id)) continue
    const pane = workspace.panes.find(p => p.pane_id === paneId)
    if (!pane) continue
    const detail = topology?.panes.find(p => p.pane_id === paneId && p.workspace_id === workspace.workspace_id)
    return { pane, workspace, socket: null as string | null, session: null as string | null, cwd: detail?.foreground_cwd || detail?.cwd || null, tabId: detail?.tab_id ?? null }
  }
  return null
}
export type InspectedPane = NonNullable<ReturnType<typeof findInspectedPane>>

/** POSIX shell literal. Reject control characters rather than producing misleading multiline commands. */
export function shellQuote(value: string): string {
  if (/[\u0000-\u001f\u007f]/.test(value)) throw new Error('invalid_shell_argument')
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export type InspectorCommandId = 'snapshot' | 'pane' | 'layout' | 'process' | 'output' | 'agent'
export interface InspectorCommand { id: InspectorCommandId; command: string }

/** Herdr 0.9 CLI: explicit --session overrides the socket, so never combine them. */
export function inspectorCommands(report: HerdrEnvironmentReport | null, paneId: string, target?: { socket: string | null; session: string | null }): InspectorCommand[] {
  if (!report?.supported || report.cli.state !== 'available' || !report.cli.path || !paneId) return []
  const socket = report.connection.socketPath
  const session = report.connection.session
  if (target && (target.socket ? target.socket !== socket : !!socket || !target.session || target.session !== session)) return []
  // Do not silently target a default server when its endpoint is unknown.
  if (!socket && !session) return []
  try {
    const executable = shellQuote(report.cli.path)
    const prefix = socket
      ? `HERDR_SOCKET_PATH=${shellQuote(socket)} ${executable}`
      : `${executable} --session ${shellQuote(session!)}`
    const pane = shellQuote(paneId)
    return [
      { id: 'snapshot', command: `${prefix} api snapshot` },
      { id: 'pane', command: `${prefix} pane get ${pane}` },
      { id: 'layout', command: `${prefix} pane layout --pane ${pane}` },
      { id: 'process', command: `${prefix} pane process-info --pane ${pane}` },
      { id: 'output', command: `${prefix} pane read ${pane} --source visible --lines 80 --format text` },
      { id: 'agent', command: `${prefix} agent get ${pane}` },
    ]
  } catch {
    return []
  }
}

export type PaneBinding = { state: 'checking' | 'unbound' | 'error'; sessionId?: never }
  | { state: 'bound'; sessionId: string }
export async function lookupPaneBinding(lookup: () => Promise<unknown>): Promise<PaneBinding> {
  try {
    const result = await lookup() as { session_id?: unknown } | null
    return typeof result?.session_id === 'string' && result.session_id.trim()
      ? { state: 'bound', sessionId: result.session_id }
      : { state: 'unbound' }
  } catch { return { state: 'error' } }
}

export async function copyInspectorCommand(command: string, clipboard?: { writeText(text: string): Promise<void> }): Promise<boolean> {
  try {
    if (!clipboard) return false
    await clipboard.writeText(command)
    return true
  } catch { return false }
}

/** Dashboard socket is a display basename. Only all-scope status supplies endpoint identity. */
export function enrichInspectedPane(selected: InspectedPane, status: HerdrStatusSnapshot | null, report: HerdrEnvironmentReport | null): InspectedPane | null {
  if (!status?.connected || status.stale || !status.server || !report) return null
  const socket = status.server.socket
  const session = status.server.session
  if (socket ? socket !== report.connection.socketPath : !!report.connection.socketPath || !session || session !== report.connection.session) return null
  const pane = status.topology?.panes.find(p => p.pane_id === selected.pane.pane_id && p.workspace_id === selected.workspace.workspace_id)
  if (!pane) return null
  return { ...selected, socket, session, cwd: pane.foreground_cwd || pane.cwd || null, tabId: pane.tab_id ?? null }
}
export function sameInspectorEndpoint(left: InspectedPane, right: InspectedPane): boolean {
  return left.socket ? left.socket === right.socket : !!left.session && !right.socket && left.session === right.session
}

/** Keep live dashboard facts while retaining only verified detail metadata from the explicit check. */
export function mergeInspectorDetails(selected: InspectedPane, details: InspectedPane | null): InspectedPane {
  return details ? { ...selected, socket: details.socket, session: details.session, cwd: details.cwd, tabId: details.tabId } : selected
}

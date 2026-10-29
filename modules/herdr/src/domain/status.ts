/**
 * Herdr 0.9.3 reports AgentStatus as idle | working | blocked | done | unknown.
 * `unknown` is the daemon's value for a plain shell and for an agent whose
 * lifecycle it cannot classify. Aliases below are accepted from older or
 * partial payloads (`state_labels`, nested status objects) before display.
 * The stored snapshot keeps a truly unclassified value as `unknown` so the
 * attention inbox never treats it as done.
 */
export type AgentState = 'working' | 'blocked' | 'idle' | 'done' | 'unknown'

const SHELL_NAMES = new Set(['shell', 'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'terminal', 'pty', 'pts'])

export function isShellName(value: string | null | undefined): boolean {
  return SHELL_NAMES.has((value ?? '').trim().toLowerCase())
}

/** First candidate that names a program. Shell program names are not agents. */
export function agentName(candidates: ReadonlyArray<string | null | undefined>): string | null {
  for (const candidate of candidates) {
    const text = candidate?.trim()
    if (text && !isShellName(text)) return text
  }
  return null
}

/** `agent_session.agent` is where Herdr 0.9.3 records a detected program when `agent` is empty. */
export function sessionAgentName(session: unknown): string | null {
  if (!session || typeof session !== 'object' || !('agent' in session)) return null
  const agent = (session as {agent?: unknown}).agent
  return typeof agent === 'string' ? agent : null
}

/**
 * `launch_pending` and `interactive_ready` are booleans beside `agent_status`.
 * A truly unclassified value stays `unknown` so the attention inbox does not treat it as done.
 */
export function refineLiveStatus(state: AgentState, flags?: {launchPending?: boolean; interactiveReady?: boolean} | null): AgentState {
  if (state !== 'unknown' || !flags) return state
  if (flags.launchPending) return 'working'
  if (flags.interactiveReady) return 'idle'
  return state
}

export function canonicalizeStatus(value: unknown, depth = 0): AgentState {
  if (depth > 2) return 'unknown'
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    if ('status' in record) return canonicalizeStatus(record.status, depth + 1)
    if ('state' in record) return canonicalizeStatus(record.state, depth + 1)
    if ('agent_status' in record) return canonicalizeStatus(record.agent_status, depth + 1)
    return 'unknown'
  }
  if (typeof value !== 'string' && typeof value !== 'number') return 'unknown'
  const text = String(value).trim().toLowerCase().replace(/[\s-]+/g, '_')
  if (text === 'idle' || text === 'ready' || text === 'inactive' || text === 'waiting' || text === 'none' || text === 'sleeping') return 'idle'
  if (text === 'working' || text === 'running' || text === 'busy' || text === 'active' || text === 'generating') return 'working'
  if (text === 'blocked' || text === 'needs_input' || text === 'need_input' || text === 'approval' || text === 'needs_approval' || text === 'waiting_input' || text === 'awaiting_input') return 'blocked'
  if (text === 'done' || text === 'completed' || text === 'finished' || text === 'complete') return 'done'
  return 'unknown'
}

/** Prefer the pane status. When it is unknown, accept a label that names a real status. */
export function resolvePaneStatus(agentStatus: unknown, stateLabels?: Record<string, string> | null): AgentState {
  const direct = canonicalizeStatus(agentStatus)
  if (direct !== 'unknown') return direct
  if (!stateLabels) return 'unknown'
  const preferred = ['status', 'state', 'agent_status', 'lifecycle', 'phase']
  for (const key of preferred) {
    if (key in stateLabels) {
      const mapped = canonicalizeStatus(stateLabels[key])
      if (mapped !== 'unknown') return mapped
    }
  }
  for (const value of Object.values(stateLabels)) {
    const mapped = canonicalizeStatus(value)
    if (mapped !== 'unknown') return mapped
  }
  return 'unknown'
}

/** A numeric Herdr tab label (`"1"`) is the tab index, not a name. */
export function tabHeading(label: string, word: string): string {
  const trimmed = label.trim()
  if (/^\d+$/.test(trimmed)) return `${word} ${trimmed}`
  return trimmed
}

/** Drop ids, bare numbers and shell program names so the row can say "Shell". */
export function terminalTitle(input: {label?: string | null; title?: string | null; id?: string | null}): string | null {
  const label = (input.label ?? '').trim()
  const title = (input.title ?? '').trim()
  const generic = (value: string) => !value || value === (input.id ?? '') || isShellName(value) || /^\d+$/.test(value)
  if (!generic(label)) return label
  if (!generic(title)) return title
  return null
}

export interface TerminalFace {
  /** Glyph to draw. `unreported` is a calm circle, never a question mark. */
  mark: AgentState | 'unreported'
  /** Message key. A plain shell whose daemon status is unknown reads as idle. */
  statusKey: 'idle' | 'working' | 'blocked' | 'done' | 'statusUnreported'
  agent: string | null
}

export function presentTerminal(input: {state: AgentState; agent: string | null}): TerminalFace {
  const agent = input.agent && !isShellName(input.agent) ? input.agent : null
  if (!agent && (input.state === 'unknown' || input.state === 'idle')) return {mark: 'idle', statusKey: 'idle', agent: null}
  if (input.state === 'unknown') return {mark: 'unreported', statusKey: 'statusUnreported', agent}
  return {mark: input.state, statusKey: input.state, agent}
}

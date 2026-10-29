import { randomUUID } from 'node:crypto'
import { WorkbenchError } from '@workbench/contracts'

/** Canonical Herdr kinds. `claude-code` is the same executable as `claude`. */
const COMMANDS = {
  codex: {kind: 'codex', command: 'codex'},
  claude: {kind: 'claude', command: 'claude'},
  'claude-code': {kind: 'claude', command: 'claude'},
} as const

export type AgentCommand = 'claude' | 'codex'
export interface PlannedAgent { kind: AgentCommand; command: AgentCommand; count: number }
export interface WorkspaceCwdCandidate { id: string; label: string; cwds: readonly string[] }

const LAUNCH_EXAMPLE = '{"agents":[{"kind":"codex","count":4},{"kind":"claude","count":4}],"send":false}'

export function resolveAgentKind(input: string): {kind: AgentCommand; command: AgentCommand} | null {
  const key = input.trim().toLowerCase()
  return COMMANDS[key as keyof typeof COMMANDS] ?? null
}

/** Herdr accepts `[a-z][a-z0-9_-]{0,31}` and rejects anything else as invalid_agent_name. */
export function agentInstanceName(kind: string, index: number): string {
  const slug = kind.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 10) || 'agent'
  const suffix = randomUUID().replace(/-/g, '').slice(0, 4)
  const name = `${slug}-${index}-${suffix}`.slice(0, 32)
  return /^[a-z][a-z0-9_-]{0,31}$/.test(name) ? name : `a${name}`.replace(/[^a-z0-9_-]/g, '').slice(0, 32)
}

/**
 * Reuse one workspace whose pane cwd realpath is the project path.
 * Several matches are reused only when exactly one label equals the directory name.
 * Anything still ambiguous returns null so the caller creates a new workspace
 * instead of guessing, including the focused workspace.
 */
export function selectWorkspaceForCwd(workspaces: readonly WorkspaceCwdCandidate[], wanted: string, base: string): string | null {
  const matches = workspaces.filter(workspace => workspace.cwds.includes(wanted))
  if (matches.length === 1) return matches[0]!.id
  if (matches.length > 1) {
    const labeled = matches.filter(workspace => workspace.label === base)
    if (labeled.length === 1) return labeled[0]!.id
  }
  return null
}

export function planLaunch(agents: readonly {kind: string; count: number}[], allowed: readonly string[]): PlannedAgent[] {
  if (agents.length < 1 || agents.length > 8) {
    throw new WorkbenchError('INVALID_REQUEST', `field agents must contain 1 to 8 groups. Example: ${LAUNCH_EXAMPLE}`)
  }
  let total = 0
  const planned: PlannedAgent[] = []
  agents.forEach((agent, index) => {
    const resolved = resolveAgentKind(agent.kind)
    if (!resolved) {
      throw new WorkbenchError('INVALID_REQUEST', `field agents[${index}].kind must be one of codex, claude, claude-code. Received ${JSON.stringify(agent.kind)}. codex runs the codex command; claude and claude-code both run the claude command.`)
    }
    if (!allowed.includes(resolved.kind)) {
      throw new WorkbenchError('INVALID_REQUEST', `field agents[${index}].kind ${resolved.kind} is not in the administrator allow-list (${allowed.join(', ') || 'none'}).`)
    }
    if (!Number.isInteger(agent.count) || agent.count < 1 || agent.count > 8) {
      throw new WorkbenchError('INVALID_REQUEST', `field agents[${index}].count must be an integer from 1 to 8. Received ${JSON.stringify(agent.count)}.`)
    }
    total += agent.count
    planned.push({kind: resolved.kind, command: resolved.command, count: agent.count})
  })
  if (total > 8) {
    throw new WorkbenchError('INVALID_REQUEST', `field agents total count is ${total}; expected an integer from 1 to 8. Example: ${LAUNCH_EXAMPLE}`)
  }
  return planned
}

export const LAUNCH_ARGUMENT_EXAMPLE = LAUNCH_EXAMPLE

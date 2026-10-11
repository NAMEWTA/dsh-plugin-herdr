/** Shared between the independent Host and preset bundle entry points. */
const KEY = Symbol.for('dsh-plugin-herdr.bindings')
export interface HerdrSessionBinding {
  pane_id: string
  /** The plugin may clean up this pane; this does NOT imply workspace ownership. */
  created: boolean
  workspace_id?: string
  /** Explicit, verified ownership of the entire workspace. */
  workspace_owned?: boolean
}
export function getBindingRegistry(): Map<string, HerdrSessionBinding> {
  const global = globalThis as Record<symbol, Map<string, HerdrSessionBinding> | undefined>
  return (global[KEY] ??= new Map())
}
export function getBoundPaneIds(): string[] {
  return [...new Set([...getBindingRegistry().values()].map(binding => binding.pane_id))]
}
export function getBoundWorkspaceIds(): string[] {
  return [...new Set([...getBindingRegistry().values()].map(binding => binding.workspace_id).filter((id): id is string => !!id))]
}
export function sessionShortId(sessionId: string): string {
  const body = sessionId.replace(/^session-/, '')
  return body.length > 8 ? body.slice(-8) : body
}
export function projectName(cwd: string | undefined): string | undefined {
  if (!cwd) return undefined
  const base = cwd.replace(/[\\/]+$/, '').split(/[\\/]/).at(-1)
  return base && base !== '.' ? base : undefined
}
export function displayLabel(cwd: string | undefined, sessionId: string): string {
  const name = projectName(cwd)
  return 'dsh:' + (name ? `${name}-${sessionShortId(sessionId)}` : sessionShortId(sessionId))
}
export const SESSION_TOKEN_KEY = 'dsh_session'
export const WORKSPACE_TOKEN_KEY = 'dsh_workspace'
export function sessionToken(agentId: string, workspaceId?: string): Record<string, string> {
  return { [SESSION_TOKEN_KEY]: agentId, ...(workspaceId ? { [WORKSPACE_TOKEN_KEY]: workspaceId } : {}) }
}
export function sessionIdFromTokens(tokens: Record<string, string | null> | undefined): string | undefined {
  return tokens?.[SESSION_TOKEN_KEY] ?? undefined
}
export function ownsMarkedWorkspace(pane: { workspace_id?: string; tokens?: Record<string, string | null> }, agentId: string): boolean {
  return !!pane.workspace_id && sessionIdFromTokens(pane.tokens) === agentId && pane.tokens?.[WORKSPACE_TOKEN_KEY] === pane.workspace_id
}
/** Compare-and-delete avoids unloading an old mount's replacement binding. */
export function removeOwnedBinding(sessionId: string, binding: HerdrSessionBinding): boolean {
  const registry = getBindingRegistry()
  if (registry.get(sessionId) !== binding) return false
  registry.delete(sessionId)
  return true
}

import { abortableDelay, throwIfAborted } from '../../core/abort.ts'
import { HerdrError } from '../../core/errors.ts'
export interface LaunchRequest { kind: string; name?: string; pane_id?: string; args?: string[]; timeout_ms?: number }
export interface LaunchInfo { name?: string | null; pane_id?: string; workspace_id?: string; agent?: string | null; display_agent?: string | null; agent_status?: string; interactive_ready?: boolean }
export interface LaunchClient {
  snapshot(signal?: AbortSignal): Promise<{ agents: Array<{ name?: unknown; agent?: unknown }> }>
  paneSplit(request: { pane_id: string; direction: 'right' }, signal?: AbortSignal): Promise<{ pane_id: string }>
  paneClose(id: string, signal?: AbortSignal): Promise<void>
  agentStart(request: LaunchRequest & { name: string; pane_id: string }, signal?: AbortSignal): Promise<LaunchInfo>
}
const reservations = new WeakMap<LaunchClient, Set<string>>()
const NAME = /^[a-z][a-z0-9_-]{0,31}$/
const ONESHOT = new Set(['--print', '-p', 'exec', '--execute', '--eval', '-e'])
export function validateLaunch(request: LaunchRequest): void {
  if (!NAME.test(request.kind)) throw new Error('kind must be a lowercase agent kind (1–32 characters)')
  if (request.name !== undefined && !NAME.test(request.name)) throw new Error('name must match [a-z][a-z0-9_-]{0,31}')
  if (request.pane_id !== undefined && !request.pane_id.trim()) throw new Error('pane_id must not be blank')
  if (request.timeout_ms !== undefined && (!Number.isInteger(request.timeout_ms) || request.timeout_ms <= 3000 || request.timeout_ms > 300000)) throw new Error('timeout_ms must be an integer > 3000 and <= 300000')
  if (request.args && (!Array.isArray(request.args) || request.args.some(value => typeof value !== 'string'))) throw new Error('args must contain strings')
  if (request.args?.some(value => ONESHOT.has(value.split('=')[0]!))) throw new Error('one-shot mode is not allowed; start interactively, then use herdr_agent_prompt')
}
/** Validate before creating resources; reserve names across concurrent launches. */
export async function launchAgent(client: LaunchClient, request: LaunchRequest, boundPane: string | undefined, signal: AbortSignal): Promise<LaunchInfo> {
  validateLaunch(request)
  throwIfAborted(signal)
  if (!request.pane_id && !boundPane) throw new Error('no pane_id given and this session has no bound herdr pane; pass pane_id explicitly')
  const snapshot = await client.snapshot(signal)
  throwIfAborted(signal)
  const reserved = reservations.get(client) ?? new Set<string>()
  reservations.set(client, reserved)
  const occupied = new Set(snapshot.agents.map(agent => agent.name).filter((name): name is string => typeof name === 'string'))
  let name = request.name
  if (!name) {
    let index = 1
    do { const suffix = '-' + index++; name = request.kind.slice(0, 32 - suffix.length) + suffix } while (occupied.has(name) || reserved.has(name))
  }
  if (occupied.has(name) || reserved.has(name)) throw new Error(`agent name ${name} is already in use`)
  reserved.add(name)
  let paneId = request.pane_id
  let created = false
  let submitted = false
  const deadline = Date.now() + (request.timeout_ms ?? 30000)
  try {
    if (!paneId) {
      throwIfAborted(signal)
      // Await a submitted creation's receipt so cancellation can compensate it.
      const pane = await client.paneSplit({ pane_id: boundPane!, direction: 'right' })
      paneId = pane.pane_id
      created = true
    }
    for (;;) {
      throwIfAborted(signal)
      const remaining = deadline - Date.now()
      if (remaining <= 3000) throw new HerdrError('HERDR_TIMEOUT', 'agent startup budget exhausted')
      try {
        submitted = true
        return await client.agentStart({ ...request, name, pane_id: paneId, timeout_ms: remaining }, signal)
      } catch (error) {
        // Only an explicit rejection is safe to retry. A lost receipt is not.
        if (!(error instanceof HerdrError) || error.serverCode !== 'agent_pane_busy') throw error
        submitted = false
        await abortableDelay(500, signal)
      }
    }
  } catch (error) {
    if (created && paneId && !submitted) await client.paneClose(paneId).catch(() => {})
    throw error
  } finally {
    reserved.delete(name)
    if (!reserved.size) reservations.delete(client)
  }
}

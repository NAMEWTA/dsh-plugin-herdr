import type { Context } from '@deepseek-ai/cordis'
import Schema from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent'
import { displayLabel } from './binding-registry.ts'
import { SessionBindings } from './application/session-bindings.ts'
import { createLogger, createRateLimiter, errText } from './log.ts'

interface SessionEventLike { type: string; data?: { title?: unknown } }
declare module '@deepseek-ai/cordis' {
  interface Events {
    'session/event'(this: unknown, session: { id: string }, event: SessionEventLike): void
  }
}
export interface Config { paneId?: string; source: string; label: string; cwd?: string }
export const Config: Schema<Config> = Schema.object({
  paneId: Schema.string(),
  source: Schema.string().default('dsh:herdr-session'),
  label: Schema.string().default(''),
  cwd: Schema.string(),
})
export const name = 'dsh-plugin-herdr-session-mode'
export const inject = ['herdr']

function sessionTitle(session: unknown): string | undefined {
  const events = (session as { events?: unknown } | undefined)?.events
  if (!Array.isArray(events)) return undefined
  for (let i = events.length - 1; i >= 0; i--) {
    const event = events[i] as SessionEventLike
    if (event?.type !== 'session/title') continue
    const title = event.data?.title
    return typeof title === 'string' && title.trim() ? title.trim() : undefined
  }
}
function labelWithinLimit(label: string): string { return Array.from(label.trim()).slice(0, 64).join('') }

/** Thin Cordis adapter; resource ownership and delayed cleanup are independently tested. */
export function apply(ctx: Context, config: Config) {
  const logger = createLogger(ctx, 'session-mode')
  const limited = createRateLimiter(10_000)
  const bindings = new SessionBindings(ctx.herdr, {
    source: config.source,
    fixedPaneId: config.paneId,
    warn: (message, error) => limited(message, () => logger.warn('%s: %s', message, errText(error))),
  })
  let stopped = false
  // Turns that already finished must not be overwritten by a late bind report.
  const turnStopped = new Set<string>()
  const reports = new Map<string, Promise<void>>()
  const labels = new Map<string, string>()
  const labelFor = (id: string, session: unknown) => {
    const cwd = (session as { header?: { cwd?: string } } | undefined)?.header?.cwd ?? config.cwd
    return { cwd, label: labelWithinLimit(config.label || labels.get(id) || sessionTitle(session) || displayLabel(cwd, id)) }
  }
  // Reports are queued per agent and carry their state explicitly, so a later
  // event cannot rewrite a transition that is still waiting for its turn.
  const report = (id: string, state: 'idle' | 'working') => {
    const prior = reports.get(id) ?? Promise.resolve()
    const work = prior.catch(() => {}).then(async () => {
      if (stopped) return
      const binding = bindings.get(id)
      // Not bound yet: bind() re-reports the current state once it lands.
      if (!binding) return
      await ctx.herdr.reportAgent({
        pane_id: binding.pane_id, source: config.source, agent: 'dsh', state,
        message: state === 'working' ? 'model request in progress' : 'herdr session ready',
      })
    }).catch(error => limited('report-agent', () => logger.warn('report-agent failed: %s', errText(error))))
    reports.set(id, work)
    void work.finally(() => { if (reports.get(id) === work) reports.delete(id) })
  }
  // The pinned host's scoped event payload is adapted only at this boundary.
  // A bind that completes after the turn ended keeps the idle state and does not
  // report over it; otherwise the request's working state is reported now.
  // Concurrent bind() calls for one agent share a single in-flight create; only
  // the call that owns it reports, so duplicates cannot double-report.
  const bindingOwners = new Map<string, object>()
  const bind = (agent: { id: string; session?: unknown }, then: (binding: boolean) => void) => {
    const owned = bindings.get(agent.id) === undefined && !bindingOwners.has(agent.id)
    const token = {}
    if (owned) bindingOwners.set(agent.id, token)
    const { label, cwd } = labelFor(agent.id, agent.session)
    void bindings.bind(agent.id, label, cwd).then(binding => {
      if (bindingOwners.get(agent.id) === token) bindingOwners.delete(agent.id)
      if (!binding || stopped) { then(false); return }
      const latest = labelFor(agent.id, agent.session).label
      if (latest !== label) void bindings.rename(agent.id, latest)
      then(owned)
    })
  }
  const stops = [
    ctx.on('agent/created', (payload: any): undefined => {
      if (stopped) return
      bind(payload.agent, bound => { if (bound && !turnStopped.has(payload.agent.id)) report(payload.agent.id, 'idle') })
    }),
    ctx.on('agent/request', async (payload: any, next: any) => {
      if (!stopped) {
        turnStopped.delete(payload.agent.id)
        // Bind is fire-and-forget: it must not block the waterfall chain. When
        // the agent was not bound yet the working report is deferred to bind.
        bind(payload.agent, bound => { if (bound && !turnStopped.has(payload.agent.id)) report(payload.agent.id, 'working') })
        report(payload.agent.id, 'working')
      }
      return next()
    }),
    ctx.on('agent/turn-stopping', (payload: any) => {
      if (stopped) return
      turnStopped.add(payload.agent.id)
      report(payload.agent.id, 'idle')
    }),
    ctx.on('agent/disposed', (payload: any) => {
      const id = payload.agent.id as string
      labels.delete(id)
      turnStopped.delete(id)
      void bindings.unbind(id).catch(error => logger.warn('unbind failed: %s', errText(error)))
    }),
    ctx.on('session/event', (session, event) => {
      if (stopped || event.type !== 'session/title' || typeof event.data?.title !== 'string' || !event.data.title.trim()) return
      const label = labelWithinLimit(config.label || event.data.title)
      labels.set(session.id, label)
      void bindings.rename(session.id, label)
    }),
  ]
  ctx.effect(() => async () => {
    stopped = true
    for (const stop of stops) stop()
    labels.clear()
    await Promise.allSettled(reports.values())
    await bindings.dispose()
  })
  logger.info('session-mode active (profile-scoped ownership)')
}

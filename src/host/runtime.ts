import type { Context } from '@deepseek-ai/cordis'
import { type Config, resolveSession, resolveSocketPath } from './config.ts'
import { createLogger } from './log.ts'
import { HerdrStatusTracker, startHerdrServer } from './status.ts'
import { HerdrDashboardTracker } from './dashboard.ts'
import { registerHerdrSkill } from './skill.ts'
import { setupHerdrEvents } from './events/index.ts'
import { createTerminalRuntime } from './terminal-session/runtime.ts'
import { registerHerdrTools } from './tools/registry.ts'
import { HerdrPanelService } from './panel/remote.ts'
export { Config } from './config.ts'
export const name = 'dsh-plugin-herdr-runtime'
export const inject = ['tools', 'herdr', 'jobs']

/** Composition root. Adapters share policy, configuration and owned lifetimes. */
export function apply(ctx: Context, config: Config) {
  registerHerdrTools(ctx, { allowBackground: config.allowBackground })
  const tracker = new HerdrStatusTracker(ctx, ctx.herdr, {
    pollIntervalMs: 2000, socketPath: resolveSocketPath(config) ?? null,
    session: resolveSession(config) ?? null, projectRoot: config.projectRoot,
    binPath: config.terminalSession?.binPath ?? process.env.HERDR_BIN_PATH,
  })
  const dashboard = new HerdrDashboardTracker(ctx, { readStatus: () => tracker.snapshot('all') })
  const terminal = createTerminalRuntime(config)
  new HerdrPanelService(ctx, {
    tracker, dashboard, terminal: () => terminal.manager(), ensureTerminal: () => terminal.ensureAvailable(),
    startServer: async () => {
      const socket = resolveSocketPath(config)
      if (!socket) return { ok: false, error: 'Herdr requires a POSIX socket; Windows is not supported' }
      const server = await startHerdrServer(socket, { session: resolveSession(config) ?? null, binPath: config.terminalSession?.binPath })
      return { ok: server.running, server }
    },
    snapshot: () => ctx.herdr.snapshot(), paneRead: request => ctx.herdr.paneRead(request),
    paneClose: id => ctx.herdr.paneClose(id), workspaceClose: id => ctx.herdr.workspaceClose(id),
    paneRename: (id, label) => ctx.herdr.paneRename(id, label), workspaceRename: (id, label) => ctx.herdr.workspaceRename(id, label),
    paneInput: request => ctx.herdr.paneSendInput(request),
  })
  tracker.start()
  dashboard.start()
  const stopSkill = registerHerdrSkill(ctx)
  const stopEvents = setupHerdrEvents(ctx, config, tracker)
  ctx.effect(() => async () => {
    stopEvents()
    tracker.stop()
    dashboard.stop()
    stopSkill()
    await terminal.dispose()
  })
  ctx.effect(() => {
    createLogger(ctx, 'runtime').info('plugin loaded: transport=socket timeoutMs=%d allowBackground=%s', config.timeoutMs, config.allowBackground)
    return () => createLogger(ctx, 'runtime').debug('plugin disposed')
  })
}

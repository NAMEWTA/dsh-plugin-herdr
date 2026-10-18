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
import { createEnvironmentReader } from './environment/service.ts'
import { findHerdrExecutable } from './environment/executable.ts'

// cordis 通过模块导出的 Config 校验插件配置并填充默认值
export { Config } from './config.ts'
export const name = 'dsh-plugin-herdr-runtime'
export const inject = ['tools', 'herdr', 'jobs']

/** Composition root. Adapters share policy, configuration and owned lifetimes. */
export function apply(ctx: Context, config: Config) {
  registerHerdrTools(ctx, { allowBackground: config.allowBackground })
  const tracker = new HerdrStatusTracker(ctx, ctx.herdr, {
    pollIntervalMs: 2000,
    projectRoot: config.projectRoot,
    binPath: config.terminalSession?.binPath ?? process.env.HERDR_BIN_PATH,
    socketPath: resolveSocketPath(config) ?? null,
    session: resolveSession(config) ?? null,
  })
  // Dashboard（design: dashboard §4）：本机只读总览——复用 status tracker 的单飞轮询
  // 快照（全量，不按项目过滤），自身只做 host 采集 / POSIX 进程探测 / DTO 装配。
  const dashboard = new HerdrDashboardTracker(ctx, {
    readStatus: () => tracker.snapshot('all'),
  })
  const terminal = createTerminalRuntime(config)
  const readEnvironment = createEnvironmentReader(config)
  new HerdrPanelService(ctx, {
    tracker,
    environment: async () => {
      const report = await readEnvironment()
      terminal.invalidateProbe()
      return report
    },
    dashboard,
    terminal: () => terminal.manager(),
    ensureTerminal: () => terminal.ensureAvailable(),
    startServer: async () => {
      if (!['linux', 'darwin'].includes(process.platform)) return { ok: false, error: 'native platform unsupported; run DSH and Herdr together in WSL' }
      const socketPath = resolveSocketPath(config)
      if (!socketPath) return { ok: false, error: 'herdr socket path unresolvable (POSIX only; Windows is not supported)' }
      const binPath = findHerdrExecutable({ binPath: config.terminalSession?.binPath })
      if (!binPath) return { ok: false, error: 'herdr executable not found; open installation settings' }
      const server = await startHerdrServer(socketPath, { binPath, session: resolveSession(config) ?? null })
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

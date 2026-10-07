import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType, resolveSession, resolveSocketPath } from './config.ts'
import { createLogger } from './log.ts'
import { HerdrStatusTracker, startHerdrServer } from './status.ts'
import { HerdrDashboardTracker } from './dashboard.ts'
import { registerHerdrSkill } from './skill.ts'
import { setupHerdrEvents } from './events/index.ts'
import { createTerminalRuntime } from './terminal-session/runtime.ts'
import { registerHerdrTools } from './tools/registry.ts'
import { HerdrPanelService } from './panel/remote.ts'

// cordis 通过模块导出的 Config 校验插件配置并填充默认值
export { Config } from './config.ts'

export const name = 'dsh-plugin-herdr-runtime'
export const inject = ['tools', 'herdr', 'jobs']

/**
 * 消费者插件：注册 herdr_* 工具与事件转发。
 * herdr 服务由 provider.ts 提供（index.ts 先装配它）；
 * jobs 由 dsh-base 的 dsh-jobs-local 提供（后台化，§9）。
 * cordis 4 要求访问服务的 fiber 显式 inject（见 index.ts 注释）。
 */
export function apply(ctx: Context, config: ConfigType) {
  registerHerdrTools(ctx, { allowBackground: config.allowBackground })

  // 面板数据源：跟踪器留在 Host，Web 通过 HerdrPanelService 的 Remote 读取。
  const tracker = new HerdrStatusTracker(ctx, ctx.herdr, {
    pollIntervalMs: 2000,
    socketPath: resolveSocketPath(config) ?? null,
    session: resolveSession(config) ?? null,
  })
  // Dashboard（design: dashboard §4）：本机只读总览——复用 status tracker 的单飞轮询
  // 快照（全量，不按项目过滤），自身只做 host 采集 / POSIX 进程探测 / DTO 装配。
  const dashboardTracker = new HerdrDashboardTracker(ctx, {
    readStatus: () => tracker.snapshot('all'),
  })
  const terminal = createTerminalRuntime(config)
  const panel = new HerdrPanelService(ctx, {
    tracker,
    dashboard: dashboardTracker,
    terminal: () => terminal.manager(),
    ensureTerminal: () => terminal.ensureAvailable(),
    startServer: async () => {
      const socketPath = resolveSocketPath(config)
      if (!socketPath) return { ok: false, error: 'herdr socket path unresolvable (POSIX only; Windows is not supported)' }
      const server = await startHerdrServer(socketPath, { session: resolveSession(config) ?? null })
      return { ok: server.running, server }
    },
    snapshot: () => ctx.herdr.snapshot(),
    paneRead: request => ctx.herdr.paneRead(request),
    paneClose: id => ctx.herdr.paneClose(id),
    workspaceClose: id => ctx.herdr.workspaceClose(id),
    paneRename: (id, label) => ctx.herdr.paneRename(id, label),
    workspaceRename: (id, label) => ctx.herdr.workspaceRename(id, label),
    paneInput: request => ctx.herdr.paneSendInput(request),
  })
  void panel
  tracker.start()
  dashboardTracker.start()
  // 会话 skill：启用插件即加载 Herdr 官方 SKILL.md
  const stopSkill = registerHerdrSkill(ctx)

  const stopEvents = setupHerdrEvents(ctx, config, tracker)

  ctx.effect(() => {
    return () => {
      stopEvents()
      tracker.stop()
      dashboardTracker.stop()
      terminal.dispose()
      stopSkill()
    }
  })

  ctx.effect(() => {
    createLogger(ctx, 'index').info(
      'plugin loaded! transport=socket timeoutMs=%d allowBackground=%s events=%s',
      config.timeoutMs, config.allowBackground, config.events.enabled,
    )
    return () => createLogger(ctx, 'index').debug('plugin disposed')
  })
}

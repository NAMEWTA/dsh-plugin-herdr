import type { Context } from '@deepseek-ai/cordis'
import { Config, type Config as ConfigType, resolveSession, resolveSocketPath } from './config.ts'
import { createLogger } from './log.ts'
import { setupEventForwarding } from './events/forward.ts'
import { setupStateReporting } from './events/state-report.ts'
import { HerdrStatusTracker, startHerdrServer } from './status.ts'
import { HerdrDashboardTracker } from './dashboard.ts'
import { registerHerdrSkill } from './skill.ts'
import { registerSnapshot } from './tools/snapshot.ts'
import { registerAgentList } from './tools/agent-list.ts'
import { registerPaneRun } from './tools/pane-run.ts'
import { registerAgentWait } from './tools/agent-wait.ts'
import { registerWorkspaceCreate } from './tools/workspace-create.ts'
import { registerPaneSplit } from './tools/pane-split.ts'
import { registerPaneSendKeys } from './tools/pane-send-keys.ts'
import { registerPaneRead } from './tools/pane-read.ts'
import { registerPaneLayout } from './tools/pane-layout.ts'
import { registerLayoutApply } from './tools/layout-apply.ts'
import { registerAgentPrompt } from './tools/agent-prompt.ts'
import { registerAgentStart } from './tools/agent-start.ts'
import { registerAgentExplain } from './tools/agent-explain.ts'
import { registerAgentSendKeys } from './tools/agent-send-keys.ts'
import { registerNotification } from './tools/notification.ts'
import { registerWorkspaceClose } from './tools/workspace-close.ts'
import { registerPaneClose } from './tools/pane-close.ts'
import { registerWorkspaceRename } from './tools/workspace-rename.ts'
import { registerPaneRename } from './tools/pane-rename.ts'
import { resolveTerminalSessionConfig } from './config.ts'
import { probeTerminalSession, type TerminalSessionCapability } from './terminal-session/capability.ts'
import { resolveSessionConnection } from './terminal-session/process.ts'
import { TerminalSessionManager } from './terminal-session/manager.ts'
import { HerdrPanelService } from './panel/remote.ts'

// cordis 通过模块导出的 Config 校验插件配置并填充默认值
export { Config } from './config.ts'

export const name = 'dsh-plugin-herdr'
export const inject = ['tools', 'herdr', 'jobs']

/**
 * 消费者插件：注册 herdr_* 工具与事件转发。
 * herdr 服务由 dsh-plugin-herdr-client（client-entry.ts）提供；
 * jobs 由 dsh-base 的 dsh-jobs-local 提供（后台化，§9）。
 * cordis 4 要求访问服务的 fiber 显式 inject（见 client-entry.ts 注释）。
 */
export function apply(ctx: Context, config: ConfigType) {
  // M1 MVP 工具
  registerSnapshot(ctx)
  registerAgentList(ctx)
  registerPaneRun(ctx, { allowBackground: config.allowBackground })
  registerAgentWait(ctx, { allowBackground: config.allowBackground })

  // M2 扩展工具
  registerWorkspaceCreate(ctx)
  registerPaneSplit(ctx)
  registerPaneSendKeys(ctx)
  registerPaneRead(ctx)
  registerPaneLayout(ctx)
  // layout.apply 为 socket 协议原生方法（全量迁移后恒注册）
  registerLayoutApply(ctx)
  registerAgentPrompt(ctx)
  registerAgentStart(ctx)
  registerAgentExplain(ctx)
  registerAgentSendKeys(ctx)
  registerNotification(ctx)

  // v2 关闭/重命名工具（FB-01 / FB-04）
  registerWorkspaceClose(ctx)
  registerPaneClose(ctx)
  registerWorkspaceRename(ctx)
  registerPaneRename(ctx)

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
  const offAgentState = ctx.on('herdr/agent-state', (info: { pane_id: string; agent: string; status: string; message?: string }) =>
    tracker.onAgentState(info))
  const offResourceChanged = ctx.on('herdr/resource-changed', (change: { type: string; action: string; id: string }) =>
    tracker.onResourceChanged(change))
  // root ctx 的 get 走注册表宽松路径（fiber store 只含 inject 服务）
  const terminalSessionCfg = resolveTerminalSessionConfig(config)
  let terminalManager: TerminalSessionManager | null = null
  let terminalCapability: TerminalSessionCapability | null = null
  let terminalCapabilityAt = 0
  let terminalCapabilityInflight: Promise<TerminalSessionCapability> | null = null
  const TERMINAL_PROBE_FAILURE_TTL_MS = 30_000
  const ensureTerminalAvailable = async (): Promise<boolean> => {
    if (terminalCapability?.available) return true
    if (terminalCapability && Date.now() - terminalCapabilityAt < TERMINAL_PROBE_FAILURE_TTL_MS) return terminalCapability.available
    if (!terminalCapabilityInflight) {
      terminalCapabilityInflight = probeTerminalSession({ binPath: terminalSessionCfg.binPath })
        .then(cap => {
          terminalCapability = cap
          terminalCapabilityAt = Date.now()
          terminalCapabilityInflight = null
          return cap
        }, err => {
          terminalCapabilityInflight = null
          throw err
        })
    }
    return (await terminalCapabilityInflight).available
  }
  if (terminalSessionCfg.enabled) {
    const conn = resolveSessionConnection(config)
    if (conn.socketPath) {
      terminalManager = new TerminalSessionManager({
        config: terminalSessionCfg,
        ...(terminalSessionCfg.binPath ? { binPath: terminalSessionCfg.binPath } : {}),
        socketPath: conn.socketPath,
        ...(conn.session ? { session: conn.session } : {}),
      })
    }
  }
  const panel = new HerdrPanelService(ctx, {
    tracker,
    dashboard: dashboardTracker,
    terminal: () => terminalManager,
    ensureTerminal: ensureTerminalAvailable,
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
  // Phase3: raw 订阅独立于 events.enabled（Phase1-1 织入），不受 setupEventForwarding 开关影响；脏集路径始终活跃
  const herdrRawSub = (ctx as unknown as { herdr?: { onEvent?: (h: (e: unknown) => void) => () => void } }).herdr?.onEvent
  let offRaw: (() => void) | null = null
  if (typeof herdrRawSub === 'function') {
    try {
      offRaw = herdrRawSub((e: unknown) => {
        try { tracker.onHerdrEvent(e as never) } catch {}
      })
    } catch {}
  }

  // 会话 skill：启用插件即加载 Herdr 官方 SKILL.md
  const stopSkill = registerHerdrSkill(ctx)

  const stopForwarding = setupEventForwarding(ctx, {
    enabled: config.events.enabled,
    maxReconnectMs: config.events.maxReconnectMs,
  })
  const stopReporting = setupStateReporting(ctx, {
    reportState: config.reportState,
    source: 'dsh:herdr-plugin',
  })

  ctx.effect(() => {
    return () => {
      offRaw?.()
      tracker.stop()
      dashboardTracker.stop()
      offAgentState()
      offResourceChanged()
      terminalManager?.dispose()
      terminalManager = null
      stopSkill()
      stopForwarding()
      stopReporting()
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

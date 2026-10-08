import type { Context } from '@deepseek-ai/cordis'
import type { Config } from '../config.ts'
import type { HerdrStatusTracker } from '../status.ts'
import { setupEventForwarding } from './forward.ts'
import { setupStateReporting } from './state-report.ts'

/**
 * Host 侧事件装配：tracker 订阅 herdr/* 事件与原始 socket 事件（脏集路径恒活跃，
 * 不受 events.enabled 影响），并按配置开启事件转发与 agent 状态上报。
 * 返回统一的释放函数。
 */
export function setupHerdrEvents(ctx: Context, config: Config, tracker: HerdrStatusTracker): () => void {
  const offAgentState = ctx.on('herdr/agent-state', (info: { pane_id: string; agent: string; status: string; message?: string }) =>
    tracker.onAgentState(info))
  const offResourceChanged = ctx.on('herdr/resource-changed', (change: { type: string; action: string; id: string }) =>
    tracker.onResourceChanged(change))

  const herdrRawSub = (ctx as unknown as { herdr?: { onEvent?: (h: (e: unknown) => void) => () => void } }).herdr?.onEvent
  let offRaw: (() => void) | null = null
  if (typeof herdrRawSub === 'function') {
    try {
      offRaw = herdrRawSub((e: unknown) => {
        try { tracker.onHerdrEvent(e as never) } catch {}
      })
    } catch {}
  }

  const stopForwarding = setupEventForwarding(ctx, {
    enabled: config.events.enabled,
    maxReconnectMs: config.events.maxReconnectMs,
  })
  const stopReporting = setupStateReporting(ctx, {
    reportState: config.reportState,
    source: 'dsh:herdr-plugin',
  })

  return () => {
    offRaw?.()
    offAgentState()
    offResourceChanged()
    stopForwarding()
    stopReporting()
  }
}

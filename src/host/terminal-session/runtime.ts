import { resolveTerminalSessionConfig, type Config } from '../config.ts'
import { probeTerminalSession, type TerminalSessionCapability } from './capability.ts'
import { resolveSessionConnection } from './process.ts'
import { TerminalSessionManager } from './manager.ts'

/** 探测失败结果的缓存时长：避免面板每次请求都 spawn 探测进程。 */
export const TERMINAL_PROBE_FAILURE_TTL_MS = 30_000

export interface TerminalRuntimeDeps {
  probe?: (opts: { binPath?: string }) => Promise<TerminalSessionCapability>
  now?: () => number
  createManager?: (opts: ConstructorParameters<typeof TerminalSessionManager>[0]) => Pick<TerminalSessionManager, 'dispose'>
}

export interface TerminalRuntime {
  /** 当前 manager；未启用或 socket 路径不可解析时为 null。 */
  manager(): TerminalSessionManager | null
  /** 能力探测：成功结果永久缓存，失败结果缓存 TTL；并发调用共用一次探测。 */
  ensureAvailable(): Promise<boolean>
  dispose(): void
}

export function createTerminalRuntime(config: Config, deps: TerminalRuntimeDeps = {}): TerminalRuntime {
  const cfg = resolveTerminalSessionConfig(config)
  const probe = deps.probe ?? probeTerminalSession
  const now = deps.now ?? Date.now
  let capability: TerminalSessionCapability | null = null
  let capabilityAt = 0
  let inflight: Promise<TerminalSessionCapability> | null = null
  let manager: TerminalSessionManager | null = null

  if (cfg.enabled) {
    const conn = resolveSessionConnection(config)
    if (conn.socketPath) {
      const opts = {
        config: cfg,
        ...(cfg.binPath ? { binPath: cfg.binPath } : {}),
        socketPath: conn.socketPath,
        ...(conn.session ? { session: conn.session } : {}),
      }
      manager = (deps.createManager ? deps.createManager(opts) : new TerminalSessionManager(opts)) as TerminalSessionManager
    }
  }

  return {
    manager: () => manager,
    async ensureAvailable() {
      if (capability?.available) return true
      if (capability && now() - capabilityAt < TERMINAL_PROBE_FAILURE_TTL_MS) return capability.available
      if (!inflight) {
        inflight = probe({ binPath: cfg.binPath }).then(cap => {
          capability = cap
          capabilityAt = now()
          inflight = null
          return cap
        }, err => {
          inflight = null
          throw err
        })
      }
      return (await inflight).available
    },
    dispose() {
      manager?.dispose()
      manager = null
    },
  }
}

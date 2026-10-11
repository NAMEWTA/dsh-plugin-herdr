import { resolveTerminalSessionConfig, type Config } from '../config.ts'
import { probeTerminalSession, type TerminalSessionCapability } from './capability.ts'
import { resolveSessionConnection } from './process.ts'
import { TerminalSessionManager } from './manager.ts'

export const TERMINAL_PROBE_FAILURE_TTL_MS = 30_000
export const TERMINAL_PROBE_SUCCESS_TTL_MS = 300_000
export interface TerminalRuntimeDeps {
  probe?: (opts: { binPath?: string }) => Promise<TerminalSessionCapability>
  now?: () => number
  createManager?: (opts: ConstructorParameters<typeof TerminalSessionManager>[0]) => { dispose(): void | Promise<void> }
}
export interface TerminalRuntime {
  manager(): TerminalSessionManager | null
  ensureAvailable(): Promise<boolean>
  dispose(): Promise<void>
}
export function createTerminalRuntime(config: Config, deps: TerminalRuntimeDeps = {}): TerminalRuntime {
  const cfg = resolveTerminalSessionConfig(config)
  const now = deps.now ?? Date.now
  const probe = deps.probe ?? probeTerminalSession
  const connection = resolveSessionConnection(config)
  let closed = false
  let capability: TerminalSessionCapability | null = null
  let capabilityAt = 0
  let inflight: Promise<boolean> | null = null
  let manager: TerminalSessionManager | null = cfg.enabled && connection.socketPath
    ? (deps.createManager?.({ config: cfg, binPath: cfg.binPath, socketPath: connection.socketPath, session: connection.session })
      ?? new TerminalSessionManager({ config: cfg, binPath: cfg.binPath, socketPath: connection.socketPath, session: connection.session })) as TerminalSessionManager
    : null
  return {
    manager: () => manager,
    async ensureAvailable() {
      if (closed || !manager) return false
      const ttl = capability?.available ? TERMINAL_PROBE_SUCCESS_TTL_MS : TERMINAL_PROBE_FAILURE_TTL_MS
      if (capability && now() - capabilityAt < ttl) return capability.available
      if (!inflight) {
        inflight = probe({ binPath: cfg.binPath }).then(value => {
          if (closed) return false
          capability = value
          capabilityAt = now()
          return value.available
        }).finally(() => { inflight = null })
      }
      return inflight
    },
    async dispose() {
      closed = true
      const current = manager
      manager = null
      await current?.dispose()
    },
  }
}

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
  /** Drop the cached capability probe so the next check re-reads the host. */
  invalidateProbe(): void
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
  let probeRevision = 0
  let inflight: Promise<boolean> | null = null
  let manager: TerminalSessionManager | null = cfg.enabled && connection.socketPath
    ? (deps.createManager?.({ config: cfg, binPath: cfg.binPath, socketPath: connection.socketPath, session: connection.session })
      ?? new TerminalSessionManager({ config: cfg, binPath: cfg.binPath, socketPath: connection.socketPath, session: connection.session })) as TerminalSessionManager
    : null
  return {
    manager: () => manager,
    async ensureAvailable() {
      if (closed) return false
      const ttl = capability?.available ? TERMINAL_PROBE_SUCCESS_TTL_MS : TERMINAL_PROBE_FAILURE_TTL_MS
      if (capability && now() - capabilityAt < ttl) return capability.available
      if (!inflight) {
        const revision = probeRevision
        // Probe errors must propagate so a caller can surface them, and must
        // never be cached: the next call re-probes.
        inflight = probe({ binPath: cfg.binPath }).then(value => {
          if (!closed && revision === probeRevision) {
            capability = value
            capabilityAt = now()
          }
          return value.available
        }).finally(() => { inflight = null })
      }
      return inflight
    },
    invalidateProbe() {
      probeRevision++
      capability = null
      capabilityAt = 0
      inflight = null
    },
    async dispose() {
      // Idempotent: a second dispose must not release the manager again.
      if (closed) return
      closed = true
      capability = null
      capabilityAt = 0
      inflight = null
      const owned = manager
      manager = null
      await owned?.dispose()
    },
  }
}

import { execFile } from 'node:child_process'
import { arch, hostname, release } from 'node:os'
import type { HerdrEnvironmentReport } from '../../core/environment.ts'
import { HERDR_PROTOCOL } from '../../core/protocol.ts'
import { resolveSession, resolveSocketPath, resolveTerminalSessionConfig, type Config } from '../config.ts'
import { socketPing } from '../herdr/socket.ts'
import { findHerdrExecutable, findOnPath } from './executable.ts'

export interface EnvironmentDeps {
  platform?: string
  arch?: string
  hostname?: string
  release?: string
  env?: NodeJS.ProcessEnv
  findHerdr?: (binPath?: string) => string | null
  findTool?: (name: string) => string | null
  run?: (bin: string, args: string[]) => Promise<string | null>
  ping?: (path: string) => Promise<{ version: string; protocol: number } | null>
}

/** Only fixed, non-mutating CLI probes. Bounded output/time; never shell commands from Remote payloads. */
export function runProbe(bin: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<string | null> {
  const childEnv: NodeJS.ProcessEnv = {}
  for (const key of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']) {
    if (env[key] !== undefined) childEnv[key] = env[key]
  }
  return new Promise(resolve => {
    execFile(bin, args, { env: childEnv, timeout: 2500, killSignal: 'SIGKILL', maxBuffer: 8192, windowsHide: true },
      (error, stdout) => resolve(error ? null : stdout.trim()))
  })
}

/** Created once per runtime. Concurrent clicks share probes; later clicks always re-detect installation. */
export function createEnvironmentReader(config: Config, deps: EnvironmentDeps = {}): () => Promise<HerdrEnvironmentReport> {
  let pending: Promise<HerdrEnvironmentReport> | null = null
  const inspect = async (): Promise<HerdrEnvironmentReport> => {
    const platform = deps.platform ?? process.platform
    const hostArch = deps.arch ?? arch()
    const env = deps.env ?? process.env
    const supported = ['linux', 'darwin'].includes(platform) && ['x64', 'arm64'].includes(hostArch)
    const cfg = resolveTerminalSessionConfig(config)
    const find = deps.findHerdr ?? (binPath => findHerdrExecutable({ binPath, env, platform }))
    const path = find(cfg.binPath)
    // Keep an invalid override visible; it is diagnostic data, never an execution fallback.
    const diagnosticPath = path ?? (cfg.binPath || env.HERDR_BIN_PATH || null)
    const run = deps.run ?? ((bin, args) => runProbe(bin, args, env))
    const socketPath = supported ? resolveSocketPath(config, env) ?? null : null
    const ping = deps.ping ?? (path => socketPing(path, 2500))
    const [versionText, help, pong] = await Promise.all([
      supported && path ? run(path, ['--version']) : null,
      supported && path && cfg.enabled ? run(path, ['terminal', 'session', '--help']) : null,
      socketPath ? ping(socketPath).catch(() => null) : null,
    ])
    const version = versionText?.match(/\b\d+\.\d+\.\d+(?:-[\w.-]+)?\b/)?.[0] ?? null
    const findTool = deps.findTool ?? (name => findOnPath(name, { env, platform }))
    return {
      checkedAt: Date.now(),
      host: { platform, arch: hostArch, hostname: deps.hostname ?? hostname(), nodeVersion: process.version,
        wsl: platform === 'linux' && (/microsoft|wsl/i.test(deps.release ?? release()) || !!env.WSL_DISTRO_NAME) },
      supported,
      cli: { path: diagnosticPath, version, state: !supported ? 'unsupported' : !path ? 'missing' : !version ? 'unusable' : 'available' },
      packageManagers: { npm: !!findTool('npm'), pnpm: !!findTool('pnpm') },
      connection: { socketPath, session: resolveSession(config, env) ?? null, running: !!pong, version: pong?.version ?? null, protocol: pong?.protocol ?? null },
      terminal: { enabled: cfg.enabled, available: !!help && /\bobserve\b/.test(help) && /\bcontrol\b/.test(help) },
      verified: { version: '0.9.0', protocol: HERDR_PROTOCOL },
    }
  }
  return () => {
    if (!pending) pending = inspect().finally(() => { pending = null })
    return pending
  }
}

import { spawn, type ChildProcess } from 'node:child_process'
import { findHerdrExecutable } from '../environment/executable.ts'

const ENV_ALLOWLIST = ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM'] as const

export interface TerminalSessionSpawn {
  mode: 'observe' | 'control'
  paneId: string
  cols: number
  rows: number
  takeover?: boolean
}

/** config > trusted HERDR_BIN_PATH > PATH herdr; never a guessed relative binary. */
export function resolveHerdrBin(opts: { binPath?: string; env?: NodeJS.ProcessEnv }): string {
  const env = opts.env ?? process.env
  if (opts.binPath) return opts.binPath
  if (env.HERDR_BIN_PATH) return env.HERDR_BIN_PATH
  return findHerdrExecutable({ env }) ?? 'herdr'
}

/** Only connection/runtime environment is inherited; never invoke a shell. */
export function terminalEnv(env: NodeJS.ProcessEnv = process.env, socketPath: string, session?: string): NodeJS.ProcessEnv {
  const allowed: NodeJS.ProcessEnv = {}
  for (const key of ENV_ALLOWLIST) if (env[key] !== undefined) allowed[key] = env[key]
  allowed.HERDR_SOCKET_PATH = socketPath
  if (session) allowed.HERDR_SESSION = session
  return allowed
}

export function spawnTerminalSession(
  binPath: string,
  req: TerminalSessionSpawn,
  socketPath: string,
  session: string | undefined,
  env?: NodeJS.ProcessEnv,
): ChildProcess {
  const args = ['terminal', 'session', req.mode, req.paneId, '--cols', String(req.cols), '--rows', String(req.rows)]
  if (req.mode === 'control' && req.takeover) args.push('--takeover')
  return spawn(binPath, args, {
    env: terminalEnv(env, socketPath, session),
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })
}

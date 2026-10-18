import { spawn } from 'node:child_process'
import type { HerdrInstallation, HerdrServerInfo } from '../../contracts/status.ts'
import { findHerdrExecutable } from '../environment/executable.ts'
import { socketPing } from './transport.ts'
import { terminalEnv } from '../terminal-session/spawn.ts'

export type PingProbeFn = () => Promise<{ version: string; protocol: number } | null>
export type SpawnFn = (cmd: string, args: string[], options: { detached: boolean; stdio: 'ignore'; env?: NodeJS.ProcessEnv }) => {
  unref(): void
  on(event: 'error', listener: (error: Error) => void): unknown
}
export function serverInfoFromPing(
  ping: { version: string; protocol: number } | null, socketPath: string | null,
  session: string | null, status: 'running' | 'not_running', installation: HerdrInstallation = 'unknown',
): HerdrServerInfo {
  return { status, running: status === 'running', version: ping?.version ?? null, protocol: ping?.protocol ?? null, socket: socketPath, session, checked_at: Date.now(), installation }
}
export async function probeHerdrInstallation(binPath = 'herdr', envPath = process.env.PATH): Promise<HerdrInstallation> {
  // Same resolver as diagnostics, server start and terminal processes.
  const path = findHerdrExecutable({ binPath: binPath === 'herdr' ? undefined : binPath, env: { ...process.env, PATH: envPath } })
  return path ? 'installed' : envPath ? 'missing' : 'unknown'
}
const starting = new Map<string, Promise<HerdrServerInfo>>()
/** The exact target socket/session is inherited by the server process as well as its probe. */
export function startHerdrServer(socketPath: string, opts: { binPath?: string; session?: string | null; timeoutMs?: number; spawnFn?: SpawnFn; probe?: PingProbeFn; env?: NodeJS.ProcessEnv } = {}): Promise<HerdrServerInfo> {
  const bin = opts.binPath ?? opts.env?.HERDR_BIN_PATH ?? process.env.HERDR_BIN_PATH ?? 'herdr'
  const session = opts.session ?? null
  const key = JSON.stringify([bin, socketPath, session])
  const existing = starting.get(key)
  if (existing) return existing
  const deadline = Date.now() + (opts.timeoutMs ?? 15000)
  const probe = async () => {
    const remaining = deadline - Date.now()
    if (remaining <= 0) return null
    const operation = opts.probe ? opts.probe() : socketPing(socketPath, Math.min(1000, remaining))
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([operation, new Promise<null>(resolve => { timer = setTimeout(() => resolve(null), Math.min(1000, remaining)) })]) }
    finally { if (timer) clearTimeout(timer) }
  }
  const work = (async () => {
    const before = await probe()
    if (before) return serverInfoFromPing(before, socketPath, session, 'running', 'installed')
    if (Date.now() >= deadline) return serverInfoFromPing(null, socketPath, session, 'not_running')
    const spawnFn: SpawnFn = opts.spawnFn ?? ((cmd, args, options) => spawn(cmd, args, options))
    const errors: { current?: Error } = {}
    const checkSpawn = () => { if (errors.current) throw new Error(`herdr server spawn failed: ${errors.current.message}`) }
    let child: ReturnType<SpawnFn>
    try { child = spawnFn(bin, ['server'], { detached: true, stdio: 'ignore', env: terminalEnv(opts.env, socketPath, session ?? undefined) }) }
    catch (error) { throw new Error(`herdr server spawn failed: ${String(error)}`) }
    child.on('error', error => { errors.current = error })
    child.unref()
    while (Date.now() < deadline) {
      checkSpawn()
      await new Promise(resolve => setTimeout(resolve, Math.min(100, deadline - Date.now())))
      const pong = await probe()
      checkSpawn()
      if (pong) return serverInfoFromPing(pong, socketPath, session, 'running', 'installed')
    }
    return serverInfoFromPing(null, socketPath, session, 'not_running')
  })().finally(() => { if (starting.get(key) === work) starting.delete(key) })
  starting.set(key, work)
  return work
}

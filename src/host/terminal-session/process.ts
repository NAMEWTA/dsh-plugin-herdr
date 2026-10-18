/**
 * Connection resolution stays outside the dependency-free child-process adapter.
 *
 * - binPath resolution: config.terminalSession.binPath → trusted HERDR_BIN_PATH → PATH herdr;
 * - the final resolveSocketPath() result becomes the child's HERDR_SOCKET_PATH;
 * - HERDR_SESSION is auxiliary context; paneId travels as argv, never through a shell;
 * - the child env is allowlisted so unrelated secrets never leak.
 */
import { resolveSocketPath, resolveSession, type Config } from '../config.ts'
export { resolveHerdrBin, terminalEnv, spawnTerminalSession } from './spawn.ts'
export type { TerminalSessionSpawn } from './spawn.ts'

export function resolveSessionConnection(config: Config): { socketPath?: string; session?: string } {
  return { socketPath: resolveSocketPath(config), session: resolveSession(config) }
}

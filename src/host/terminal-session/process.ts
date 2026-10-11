/** Connection resolution is kept outside the dependency-free child-process adapter. */
import { resolveSocketPath, resolveSession, type Config } from '../config.ts'
export { resolveHerdrBin, spawnTerminalSession } from './spawn.ts'
export type { TerminalSessionSpawn } from './spawn.ts'

export function resolveSessionConnection(config: Config): { socketPath?: string; session?: string } {
  return { socketPath: resolveSocketPath(config), session: resolveSession(config) }
}

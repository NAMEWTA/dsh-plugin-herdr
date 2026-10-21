import { accessSync, constants, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, isAbsolute, join } from 'node:path'

export interface ExecutableOptions {
  binPath?: string
  env?: NodeJS.ProcessEnv
  platform?: string
  home?: string
  executable?: (path: string) => boolean
}

export function isExecutable(path: string): boolean {
  try { accessSync(path, constants.X_OK); return statSync(path).isFile() } catch { return false }
}

/** Do not execute a guessed binary from the current project or relative PATH entries. */
export function findOnPath(name: string, opts: ExecutableOptions = {}): string | null {
  const env = opts.env ?? process.env
  const executable = opts.executable ?? isExecutable
  if (isAbsolute(name)) return executable(name) ? name : null
  if (name.includes('/') || name.includes('\\')) return null
  const windows = (opts.platform ?? process.platform) === 'win32'
  for (const dir of (env.PATH ?? '').split(windows ? ';' : delimiter).filter(isAbsolute)) {
    for (const suffix of windows ? ['', '.exe', '.cmd'] : ['']) {
      const path = join(dir, name + suffix)
      if (executable(path)) return path
    }
  }
  return null
}

/** Same resolver for diagnostics, server start and terminal processes. Explicit overrides never fall back. */
export function findHerdrExecutable(opts: ExecutableOptions = {}): string | null {
  const env = opts.env ?? process.env
  const configured = opts.binPath || env.WORKBENCH_HERDR_BINARY
  if (configured) return findOnPath(configured, opts)
  const onPath = findOnPath('herdr', opts)
  if (onPath) return onPath
  const platform = opts.platform ?? process.platform
  if (platform !== 'linux' && platform !== 'darwin') return null
  const candidates = [join(opts.home ?? homedir(), '.local', 'bin', 'herdr')]
  if (platform === 'darwin') candidates.push('/opt/homebrew/bin/herdr', '/usr/local/bin/herdr')
  return candidates.find(opts.executable ?? isExecutable) ?? null
}

/** Wire-only environment facts. Platform always belongs to the DSH Host, not the browser. */
export interface HerdrEnvironmentReport {
  checkedAt: number
  host: { platform: string; arch: string; hostname: string; nodeVersion: string; wsl: boolean }
  supported: boolean
  cli: { state: 'available' | 'missing' | 'unusable' | 'unsupported'; path: string | null; version: string | null }
  packageManagers: { npm: boolean; pnpm: boolean }
  connection: { socketPath: string | null; session: string | null; running: boolean; version: string | null; protocol: number | null }
  terminal: { enabled: boolean; available: boolean }
  verified: { version: string; protocol: number }
}

export type InstallCommandId = 'official' | 'homebrew' | 'pnpm' | 'dsh' | 'path' | 'wsl'
export interface InstallCommand { id: InstallCommandId; command: string }
export const HERDR_INSTALL_DOCS = 'https://herdr.dev/docs/install/'
export const NODE_INSTALL_DOCS = 'https://nodejs.org/en/download'

/** Official Herdr has no documented npm installer. Do not substitute a same-name package. */
export function environmentCommands(host: { platform: string; arch: string }): InstallCommand[] {
  if (host.platform === 'win32') return [{ id: 'wsl', command: 'wsl --install' }]
  if (!['linux', 'darwin'].includes(host.platform) || !['x64', 'arm64'].includes(host.arch)) return []
  return [
    { id: 'official', command: 'curl -fsSL https://herdr.dev/install.sh | sh' },
    ...(host.platform === 'darwin' ? [{ id: 'homebrew' as const, command: 'brew install herdr' }] : []),
    { id: 'pnpm', command: 'npm install --global pnpm@10.28.2' },
    { id: 'dsh', command: 'npm install --global @deepseek-ai/dsh@0.2.1-alpha.2' },
    { id: 'path', command: 'export PATH="$HOME/.local/bin:$PATH"\nherdr --version' },
  ]
}

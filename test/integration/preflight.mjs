// Real Herdr preflight. Local runs may skip; required CI must never silently skip.
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export function checkPreflight(opts = {}) {
  const { requireServer = true } = opts
  const reasons = []
  if (!existsSync(join(root, 'lib', 'index.js'))) {
    reasons.push('lib/ not built (run: pnpm build)')
  }
  try {
    execFileSync('herdr', ['--version'], { encoding: 'utf8', stdio: 'pipe' })
  } catch {
    reasons.push('herdr CLI not on PATH')
  }
  if (requireServer) {
    try {
      const out = execFileSync('herdr', ['status', 'server', '--json'], { encoding: 'utf8', stdio: 'pipe' })
      const info = JSON.parse(out)
      if (!info.running) reasons.push('herdr server not running (run: herdr server)')
    } catch {
      reasons.push('herdr server status check failed (herdr status server --json)')
    }
  }
  return reasons
}

export function assertPreflight(opts) {
  const reasons = checkPreflight(opts)
  if (reasons.length === 0) return
  const required = process.env.HERDR_REQUIRE_INTEGRATION === '1'
  console.error((required ? 'FAILED: ' : 'SKIPPED: ') + 'integration test preconditions missing -> ' + reasons.join('; '))
  process.exit(required ? 1 : 0)
}

export async function ensureWorkspace(herdr) {
  const snap = await herdr.snapshot()
  if (snap.workspaces.length > 0) return () => {}
  const w = await herdr.workspaceCreate({ label: 'dsh-integration', cwd: process.env.HOME ?? '/' })
  console.log(`  (created workspace ${w.workspace_id} for integration tests)`)
  return () => {
    try { execFileSync('herdr', ['workspace', 'close', w.workspace_id], { encoding: 'utf8' }) } catch { /* already closed */ }
  }
}

export const EXPECTED_PROTOCOL = JSON.parse(readFileSync(join(root, 'test', 'fixtures', 'herdr-api.schema.json'), 'utf8')).protocol

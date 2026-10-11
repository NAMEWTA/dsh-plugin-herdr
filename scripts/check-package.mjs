// Validate the actual tarball, not the developer's working lib/ directory.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

export function exportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(exportTargets)
}

export function checkPackage(tarball) {
  const archive = resolve(tarball)
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 }).trim().split('\n')
  for (const entry of entries) {
    assert.ok(entry.startsWith('package/'), `unexpected tar path: ${entry}`)
    assert.ok(!entry.split('/').includes('..'), `unsafe tar path: ${entry}`)
  }
  const listing = execFileSync('tar', ['-tvzf', archive], { encoding: 'utf8', maxBuffer: 4 * 1024 * 1024 })
  assert.ok(listing.split('\n').filter(Boolean).every(line => line.startsWith('-') || line.startsWith('d')), 'archive must contain only regular files and directories')
  const dir = mkdtempSync(join(tmpdir(), 'herdr-package-'))
  try {
    execFileSync('tar', ['-xzf', archive, '-C', dir], { timeout: 30_000 })
    const root = join(dir, 'package')
    const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
    assert.equal(pkg.name, '@namewta/dsh-plugin-herdr')
    const targets = [...exportTargets(pkg.exports).filter(p => !p.includes('*')),
      pkg.main, pkg.types, pkg.dsh.bundle.patch, pkg.icon,
      'locale/en.json', 'locale/zh.json', 'README.md', 'README.zh-CN.md', 'LICENSE', 'COMPATIBILITY.md']
    for (const target of targets) {
      assert.equal(typeof target, 'string')
      const path = resolve(root, target)
      const rel = relative(root, path)
      assert.ok(rel && !isAbsolute(rel) && !rel.startsWith('..'), `export escapes package: ${target}`)
      assert.ok(existsSync(path), `packed file missing: ${target}`)
      const realRel = relative(root, realpathSync(path))
      assert.ok(!isAbsolute(realRel) && !realRel.startsWith('..'), `symlink escapes package: ${target}`)
      if (target.endsWith('.js')) execFileSync(process.execPath, ['--check', path], { timeout: 30_000 })
    }
    const client = readFileSync(join(root, 'lib/client.js'), 'utf8')
    assert.match(client, /window\.__ModuleLoader__\.load\(/)
    assert.match(client, /return module\.exports/)
    for (const [, dep] of client.matchAll(/require\(["']([^"']+)["']\)/g)) {
      assert.ok(['react', 'react/jsx-runtime', '@deepseek-ai/cordis'].includes(dep), `unexpected client external: ${dep}`)
    }
    return { name: pkg.name, version: pkg.version, dsh: pkg.engines.dsh, files: entries.length }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('Usage: node scripts/check-package.mjs <tarball.tgz>')
  console.log(JSON.stringify(checkPackage(process.argv[2]), null, 2))
}

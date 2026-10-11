import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkPackage, exportTargets } from '../../scripts/check-package.mjs'

function fixture(t, modify = () => {}) {
  const dir = mkdtempSync(join(tmpdir(), 'herdr-pack-test-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const root = join(dir, 'package')
  const pkg = {
    name: '@namewta/dsh-plugin-herdr', version: '0.0.2', type: 'module',
    engines: { dsh: '0.2.1-alpha.2' }, main: 'lib/index.js', types: 'lib/index.d.ts',
    icon: 'icon.svg', dsh: { bundle: { patch: './cordis.patch.yml' } },
    exports: { '.': { types: './lib/index.d.ts', default: './lib/index.js' }, './client': './lib/client.js' },
  }
  const files = {
    'lib/index.js': 'export const name = "herdr"', 'lib/index.d.ts': 'export declare const name: string',
    'lib/client.js': 'window.__ModuleLoader__.load({factory:()=>{const module={exports:{}}; return module.exports}})',
    'locale/en.json': '{}', 'locale/zh.json': '{}', 'README.md': '# Readme',
    'README.zh-CN.md': '# 说明', 'LICENSE': 'MIT', 'COMPATIBILITY.md': '# Matrix',
    'cordis.patch.yml': '[]', 'icon.svg': '<svg/>',
  }
  modify(pkg, files)
  files['package.json'] = JSON.stringify(pkg)
  for (const [file, text] of Object.entries(files)) {
    mkdirSync(join(root, file, '..'), { recursive: true })
    writeFileSync(join(root, file), text)
  }
  const tarball = join(dir, 'plugin.tgz')
  execFileSync('tar', ['-czf', tarball, '-C', dir, 'package'])
  return tarball
}
test('export targets include all conditional exports', () => {
  assert.deepEqual(exportTargets({ '.': { types: './a.d.ts', import: './a.js' }, './sub': './b.js' }), ['./a.d.ts', './a.js', './b.js'])
})
test('complete packed plugin passes without consulting working lib', t => {
  assert.equal(checkPackage(fixture(t)).version, '0.0.2')
})
test('missing packed entry fails', t => {
  const archive = fixture(t, (_pkg, files) => { delete files['lib/index.js'] })
  assert.throws(() => checkPackage(archive), /packed file missing/)
})
test('missing packed locale fails', t => {
  const archive = fixture(t, (_pkg, files) => { delete files['locale/en.json'] })
  assert.throws(() => checkPackage(archive), /packed file missing/)
})
test('escaping export target fails', t => {
  const archive = fixture(t, pkg => { pkg.exports['./bad'] = '../outside.js' })
  assert.throws(() => checkPackage(archive), /export escapes/)
})
test('unavailable browser external fails', t => {
  const archive = fixture(t, (_pkg, files) => { files['lib/client.js'] += ';require("node:fs")' })
  assert.throws(() => checkPackage(archive), /unexpected client external/)
})

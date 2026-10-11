// Shipped package contract for the explicitly supported DSH releases: manifest, locales, and the built client.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { I18N_KEYS } from '../../src/web/i18n.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
  icon?: string
  engines: { node: string; dsh: string }
  peerDependencies: Record<string, string>
  dependencies: Record<string, string>
  devDependencies: Record<string, string>
  exports: Record<string, unknown>
  dsh: { manifestVersion: number; bundle: { patch: string }; client: { platform: string; inject: string[] } }
}

const CLIENT_INJECT = [
  '@deepseek-ai/dsh-client-locale',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-modules',
]

const DSH_RANGE = '0.2.0-rc.2 || 0.2.1-alpha.1 || 0.2.1-alpha.2'
const PEERS: Record<string, string> = {
  '@deepseek-ai/cordis': '4.0.4 || 4.0.5-alpha.1',
  '@deepseek-ai/schemastery': '3.18.4 || 3.18.5-alpha.1',
  '@deepseek-ai/dsh-agent': DSH_RANGE,
  '@deepseek-ai/dsh-jobs': DSH_RANGE,
  '@deepseek-ai/dsh-skill': DSH_RANGE,
  '@deepseek-ai/dsh-tools': DSH_RANGE,
  '@deepseek-ai/dsh-typert-protocol': DSH_RANGE,
  '@deepseek-ai/dsh-host-webserver': DSH_RANGE,
}

test('package manifest and peer family match the finite DSH compatibility matrix', () => {
  assert.equal(pkg.engines.node, '>=24')
  assert.equal(pkg.engines.dsh, DSH_RANGE)
  for (const name of Object.keys(PEERS).filter(name => name.startsWith('@deepseek-ai/dsh-'))) {
    assert.equal(pkg.devDependencies[name], '0.2.1-alpha.2', name + ' build baseline')
  }
  assert.equal(pkg.dsh.manifestVersion, 1)
  assert.equal(pkg.dsh.bundle.patch, './cordis.patch.yml')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.deepEqual(pkg.dsh.client.inject, CLIENT_INJECT)
  assert.equal(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-runtime'), false)
  assert.equal(pkg.icon, './icon.svg')
  assert.equal(pkg.exports['./package.json'], './package.json')
  assert.equal(pkg.exports['./locale/*.json'], './locale/*.json')
  assert.equal(pkg.exports['./typert'] && typeof pkg.exports['./typert'] === 'object', true)
  assert.deepEqual(pkg.peerDependencies, PEERS)
  assert.equal(pkg.peerDependencies.react, undefined)
  assert.equal(pkg.peerDependencies.zod, undefined)
  assert.match(pkg.dependencies.zod, /^\^4\./)
  assert.match(pkg.devDependencies.react, /^\^19\./)
  assert.equal(pkg.dependencies.react, undefined)
  readFileSync(join(root, 'icon.svg'))
  readFileSync(join(root, 'cordis.patch.yml'))
})

test('locale dictionaries are bilingual and bound as herdr', () => {
  const en = JSON.parse(readFileSync(join(root, 'locale', 'en.json'), 'utf8')) as Record<string, unknown>
  const zh = JSON.parse(readFileSync(join(root, 'locale', 'zh.json'), 'utf8')) as Record<string, unknown>
  const enKeys = Object.keys(en).filter(key => key !== 'meta').sort()
  const zhKeys = Object.keys(zh).filter(key => key !== 'meta').sort()
  assert.deepEqual(enKeys, zhKeys)
  for (const key of enKeys) {
    assert.equal(typeof en[key], 'string')
    assert.equal(typeof zh[key], 'string')
    assert.ok(String(en[key]).length > 0, key)
    assert.ok(String(zh[key]).length > 0, key)
  }
  for (const key of Object.keys(I18N_KEYS)) assert.ok(enKeys.includes(key), key)
  const app = readFileSync(join(root, 'src', 'web', 'app.tsx'), 'utf8')
  const i18n = readFileSync(join(root, 'src', 'web', 'i18n.ts'), 'utf8')
  assert.match(i18n, /HERDR_LOCALE_NS = 'herdr'/)
  assert.match(app, /locale\.bind\(HERDR_LOCALE_NS\)/)
  assert.match(app, /id: 'herdr'/)
  assert.match(app, /id: 'herdr-status'/)
  assert.match(app, /id: 'herdr-pane-list'/)
  assert.match(app, /name: 'sidebar\.panellist'/)
  assert.doesNotMatch(app, /startSidebarMarkerController/)
})

test('owned button, pill, and status dot rules use only alias tokens', () => {
  const css = readFileSync(join(root, 'src', 'web', 'styles.ts'), 'utf8')
  const rules = css.match(/\.herdr-(?:button|pill|state-dot)[^{]*\{[^}]*\}/g) ?? []
  assert.ok(rules.length >= 3)
  for (const rule of rules) {
    for (const token of rule.matchAll(/var\((--[^),\s]+)/g)) {
      assert.match(token[1], /^--dsw-alias-/, rule)
    }
  }
})

test('built web client is one ModuleLoader factory with the allowed externals', () => {
  const client = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  const hostConfig = readFileSync(join(root, 'tsdown.config.ts'), 'utf8')
  const webConfig = readFileSync(join(root, 'tsdown.web.config.ts'), 'utf8')
  assert.match(hostConfig, /target:\s*'node24'/)
  assert.match(webConfig, /external:\s*\[[^\]]*react[^\]]*react\/jsx-runtime[^\]]*@deepseek-ai\/cordis/s)
  assert.match(client, /window\.__ModuleLoader__\.load\(/)
  assert.match(client, /return module\.exports/)
  assert.equal(client.includes('@deepseek-ai/dsh-client-'), false)
  assert.match(client, /xterm/)
  const requires = [...client.matchAll(/require\((["'])([^"']+)\1\)/g)].map(match => match[2])
  const allowed = new Set(['react', 'react/jsx-runtime', '@deepseek-ai/cordis'])
  for (const name of requires) assert.ok(allowed.has(name), name)
  assert.doesNotMatch(client, /['"`]\/herdr-/)
})

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('built host bundle does not register herdr http routes or presentation fields', () => {
  const files = readdirSync(join(root, 'lib')).filter(name => name.endsWith('.js') && name !== 'client.js')
  assert.ok(files.includes('index.js'))
  const bundled = stripComments(files.map(name => readFileSync(join(root, 'lib', name), 'utf8')).join('\n'))
  assert.doesNotMatch(bundled, /presentCall|presentResult/)
  assert.doesNotMatch(bundled, /['"`]\/herdr-/)
  assert.doesNotMatch(bundled, /\/herdr-terminal-session\//)
  assert.doesNotMatch(bundled, /@Remote/)
})

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

test('web bundle config emits one ModuleLoader factory without client packages', () => {
  const config = readFileSync(join(root, 'tsdown.web.config.ts'), 'utf8')
  assert.match(config, /window\.__ModuleLoader__\.load/)
  assert.match(config, /return module\.exports/)
  assert.doesNotMatch(config, /@deepseek-ai\/dsh-client-/)
  assert.match(config, /external:\s*\[[^\]]*react[^\]]*@deepseek-ai\/cordis/s)
})

test('client entry mounts the generated remote and does not import client packages', () => {
  const client = readFileSync(join(root, 'src', 'client.tsx'), 'utf8')
  const app = readFileSync(join(root, 'src', 'web', 'app.tsx'), 'utf8')
  const mount = readFileSync(join(root, 'src', 'web', 'remote-mount.ts'), 'utf8')
  assert.match(client, /mountHerdrRemote\(ctx\)/)
  assert.match(mount, /ctx\.remote\?\.\$mount/)
  assert.match(mount, /ctx\.inject\(\['remote\.herdr'\]/)
  assert.doesNotMatch(app, /ctx\.remote\?\.herdr/)
  assert.doesNotMatch(client + app + mount, /@deepseek-ai\/dsh-client-/)
  assert.match(app, /conversation\.view/)
  assert.match(app, /conversation\.session\.header\.actions/)
  assert.match(app, /shell\.overlay/)
  assert.match(app, /sidebar\.panellist/)
})

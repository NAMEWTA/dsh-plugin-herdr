// 分层约束：src/core 不依赖 DSH 包，也不反向依赖 host / web。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const coreDir = join(import.meta.dirname, '../../src/core')

test('src/core imports no @deepseek-ai packages and no host/web modules', () => {
  const files = readdirSync(coreDir, { recursive: true }).map(String).filter(f => /\.tsx?$/.test(f))
  assert.ok(files.length > 0)
  for (const f of files) {
    const src = readFileSync(join(coreDir, f), 'utf8')
    assert.doesNotMatch(src, /from\s+['"]@deepseek-ai\//, `${f} imports @deepseek-ai`)
    assert.doesNotMatch(src, /from\s+['"]\.\.\/(host|web|tools|events|panel)\//, `${f} imports an upper layer`)
  }
})

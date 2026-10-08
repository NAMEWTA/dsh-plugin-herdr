// Web 契约：品牌文案双语齐全；样式在模块求值期同步注入（适配 dsh 0.2.1-alpha.1 的 claimStyles：
// 只认领 factory 物化期间新增的 <style>，异步注入的样式不会归属插件、HMR 卸载时会残留）。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import zh from '../../locale/zh.json' with { type: 'json' }
import en from '../../locale/en.json' with { type: 'json' }

const root = join(import.meta.dirname, '..', '..')

test('brand copy has the same keys in zh and en, all non-empty', () => {
  const brandKeys = (d: Record<string, unknown>) => Object.keys(d).filter(k => k.startsWith('brand.')).sort()
  assert.deepEqual(brandKeys(zh), ['brand.heroBrand', 'brand.heroPlain', 'brand.heroText', 'brand.presetDesc', 'brand.presetName'])
  assert.deepEqual(brandKeys(en), brandKeys(zh))
  for (const d of [zh, en]) assert.equal(d['brand.heroBrand'] + d['brand.heroPlain'], d['brand.heroText'])
})

test('locale files expose identical panel key sets', () => {
  assert.deepEqual(Object.keys(zh).sort(), Object.keys(en).sort())
})

test('styles inject synchronously at module evaluation, imported statically by the client entry', () => {
  const styles = readFileSync(join(root, 'src/web/styles.ts'), 'utf8')
  const head = styles.slice(0, styles.indexOf('document.head.appendChild(style)'))
  assert.ok(head.length > 0, 'styles.ts appends its <style> element')
  assert.doesNotMatch(head, /\bawait\b|setTimeout|requestAnimationFrame|queueMicrotask|\.then\(/)
  const client = readFileSync(join(root, 'src/client.tsx'), 'utf8')
  assert.match(client, /^import '\.\/web\/styles\.ts'$/m)
})

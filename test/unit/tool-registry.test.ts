// 工具注册表契约：HERDR_TOOLS 是 herdr_* 工具的唯一清单，每项恰好注册一个同名工具。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { Context } from '@deepseek-ai/cordis'
import { HERDR_TOOLS, registerHerdrTools } from '../../src/host/tools/registry.ts'

type Def = { name: string; description?: string; parameters?: unknown; output?: { schema?: unknown } }

function fakeCtx(sink: Def[]): Context {
  return { tools: { register: (def: Def) => { sink.push(def); return () => {} } }, herdr: {}, jobs: {} } as unknown as Context
}

test('registry lists 19 unique herdr_* tools', () => {
  const names = HERDR_TOOLS.map(t => t.name)
  assert.equal(names.length, 19)
  assert.equal(new Set(names).size, names.length)
  for (const n of names) assert.match(n, /^herdr_[a-z_]+$/)
})

test('each registry entry registers exactly one tool with its declared name and contract', () => {
  for (const entry of HERDR_TOOLS) {
    for (const allowBackground of [false, true]) {
      const sink: Def[] = []
      entry.register(fakeCtx(sink), { allowBackground })
      assert.equal(sink.length, 1, entry.name)
      const def = sink[0]
      assert.equal(def.name, entry.name)
      assert.ok(def.description && def.description.length > 0, `${entry.name} description`)
      assert.ok(def.parameters && typeof def.parameters === 'object', `${entry.name} parameters`)
      assert.ok(def.output && typeof def.output.schema === 'object', `${entry.name} output schema`)
    }
  }
})

test('registerHerdrTools registers the full registry in order', () => {
  const sink: Def[] = []
  registerHerdrTools(fakeCtx(sink), { allowBackground: false })
  assert.deepEqual(sink.map(d => d.name), HERDR_TOOLS.map(t => t.name))
})

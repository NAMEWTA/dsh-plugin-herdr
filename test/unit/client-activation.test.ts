// 回归：web 入口在 dsh 0.2.1-alpha.1 的激活语义下必须能 apply 成功。
// 曾经的故障（浏览器启动页 "web boot: 1 entry did not activate"）：
//   1) 把 host face（{ package, face, invocations }）交给 ctx.remote.$mount → "contribution.descriptors is not iterable"；
//   2) 直接读 ctx.remote.herdr → cordis 抛 'cannot get property "remote.herdr" without inject'。
// 这里加载真实构建产物 lib/client.js（ModuleLoader factory），用模拟 alpha 约束的 ctx 激活它。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { TYPERT, TYPERT_REMOTE } from '../../lib/typert.host.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string }
const require = createRequire(import.meta.url)

type Factory = { id: string; factory: (req: (id: string) => unknown) => Record<string, unknown> }

function loadClientFactory(): Factory {
  let registered: Factory | undefined
  const win = { __ModuleLoader__: { load: (r: Factory) => { registered = r } } }
  new Function('window', readFileSync(join(root, 'lib', 'client.js'), 'utf8'))(win)
  assert.ok(registered, 'lib/client.js registers via __ModuleLoader__.load')
  return registered
}

/** 模拟 alpha：$mount 校验 Remote contribution；remote.<ns> 只能经 inject 读取。 */
function alphaCtx() {
  const mounted: string[] = []
  const injected: string[] = []
  const slots: string[] = []
  const herdrRemote = { status: async () => ({}) }
  const remote = new Proxy({
    async $mount(contribution: { package?: unknown; descriptors?: Iterable<{ namespace: string }> }) {
      if (typeof contribution.package !== 'string' || contribution.package.includes('#')) throw new Error('typert: invalid Remote package name')
      for (const d of contribution.descriptors as Iterable<{ namespace: string }>) mounted.push(d.namespace) // 非可迭代即抛 TypeError
      return async () => {}
    },
  }, {
    get(target, prop) {
      if (prop === '$mount') return target.$mount
      if (prop === 'then') return undefined
      throw new Error(`cannot get property "remote.${String(prop)}" without inject`)
    },
  })
  const ctx = {
    remote,
    effect: () => {},
    inject(deps: string[], cb: (scope: unknown) => unknown) {
      injected.push(...deps)
      if (deps.includes('remote.herdr')) {
        if (!mounted.includes('herdr')) throw new Error('remote.herdr injected before $mount')
        cb({ remote: { herdr: herdrRemote }, effect: () => {} })
      }
      // sessions / locale 等宿主服务在本测试中不提供：回调不触发
    },
    slots: {
      inject: (_name: string, register: () => unknown) => { const r = register(); if (r && typeof (r as Iterator<unknown>).next === 'function') [...(r as Iterable<unknown>)] },
      register: (opts: { name: string }) => { slots.push(opts.name); return () => {} },
    },
  }
  return { ctx, mounted, injected, slots }
}

test('TYPERT_REMOTE is a valid Remote contribution sharing the host invocations', () => {
  assert.equal(TYPERT.package, pkg.name, 'host face package must equal the npm package name (typert-loader)')
  assert.equal(TYPERT_REMOTE.package, pkg.name)
  assert.ok(Array.isArray(TYPERT_REMOTE.descriptors) && TYPERT_REMOTE.descriptors.length > 0)
  assert.equal(TYPERT_REMOTE.descriptors, TYPERT.invocations)
  for (const d of TYPERT_REMOTE.descriptors) assert.equal(d.namespace, 'herdr')
})

test('built web entry activates under alpha remote/inject semantics', async () => {
  const reg = loadClientFactory()
  assert.equal(reg.id, pkg.name, 'ModuleLoader id must equal the package name in the boot graph')
  const mod = reg.factory(id => require(id === '@deepseek-ai/cordis' ? '@deepseek-ai/cordis' : id))
  assert.equal(typeof mod.apply, 'function')
  assert.deepEqual(mod.inject, ['slots', 'locale', 'remote'])
  const { ctx, mounted, injected, slots } = alphaCtx()
  await (mod.apply as (c: unknown) => Promise<void>)(ctx)
  assert.ok(mounted.includes('herdr'), 'herdr descriptors mounted')
  assert.ok(injected.includes('remote.herdr'), 'remote.herdr obtained through ctx.inject')
  for (const name of ['conversation.view', 'sidebar.panellist', 'main', 'conversation.session.header.actions', 'shell.overlay']) {
    assert.ok(slots.includes(name), `slot ${name} registered`)
  }
})

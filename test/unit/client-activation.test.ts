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

// 回归：网关客户端 prepareInvocation 按 descriptor.parameters.length 严格比较实参个数，
// 无 request 语义的方法（0 参 host 方法）必须声明 parameters: []，
// 否则 Web 侧按 0 个实参调用会得到 "herdr/<m> expected 1 argument(s), got 0"。
test('zero-request panel methods declare no wire parameter', async () => {
  const { PANEL_NO_REQUEST } = await import('../../lib/panel-contract.js')
  const { HerdrPanelService } = await import('../../src/host/panel/remote.ts')
  const proto = HerdrPanelService.prototype as unknown as Record<string, Function>
  const noRequest = [...PANEL_NO_REQUEST] as string[]
  for (const name of noRequest) {
    assert.ok(name in proto, `PANEL_NO_REQUEST names a panel method: ${name}`)
    assert.equal(proto[name].length, 0, `host ${name}() takes no parameters`)
    const d = TYPERT.invocations.find((i: { method: string }) => i.method === name)
    assert.deepEqual(d?.parameters, [], `herdr/${name} descriptor must have 0 parameters`)
  }
  // 0 参 host 方法全部登记：dashboard/topology/start/terminalStats 与 environment 同类。
  for (const name of ['environment', 'dashboard', 'topology', 'start', 'terminalStats']) {
    assert.ok(noRequest.includes(name), `${name} is a no-request method`)
  }
  for (const name of ['status', 'events']) {
    const d = TYPERT.invocations.find((i: { method: string }) => i.method === name)
    assert.equal(d?.parameters.length, 1, `herdr/${name} carries its optional request`)
  }
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
  for (const name of ['settings.plugins.tab', 'conversation.view', 'sidebar.panellist', 'main', 'conversation.session.header.actions', 'shell.overlay']) {
    assert.ok(slots.includes(name), `slot ${name} registered`)
  }
})

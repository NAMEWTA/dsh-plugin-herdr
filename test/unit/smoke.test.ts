import { test } from 'node:test'
import assert from 'node:assert/strict'
import { Context } from '@deepseek-ai/cordis'
import { apply } from '../../lib/index.js'
import { apply as applyClient } from '../../lib/client-entry.js'
import { Config, type Config as ConfigType } from '../../src/config.ts'

const FULL_CONFIG: ConfigType = {
  timeoutMs: 30000,
  allowBackground: false,
  events: { enabled: false, maxReconnectMs: 30000 },
  reportState: true,
}

test('provider + consumer plugins load and register ctx.herdr + tools', async () => {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('jobs', { start: () => 'herdr-1' })
  const clientFiber = await ctx.plugin({ name: 'dsh-plugin-herdr-client', apply: applyClient, inject: [] }, FULL_CONFIG)
  const fiber = await ctx.plugin(
    { name: 'dsh-plugin-herdr', apply, inject: ['tools', 'herdr', 'jobs'] },
    FULL_CONFIG,
  )
  try {
    assert.ok(ctx.herdr, 'ctx.herdr should be registered by the provider plugin')
    assert.ok(ctx.herdr.snapshot, 'ctx.herdr should expose service methods')
  } finally {
    await fiber.dispose()
    await clientFiber.dispose()
  }
})

test('consumer plugin does not load before provider registers herdr', async () => {
  const ctx = new Context()
  ctx.provide('tools', { register: () => () => {} })
  ctx.provide('jobs', { start: () => 'herdr-1' })
  const fiber = await ctx.plugin({ name: 'dsh-plugin-herdr', apply, inject: ['tools', 'herdr', 'jobs'] }, FULL_CONFIG)
  // herdr 未提供 → fiber 应停留在等待状态而非激活
  assert.notEqual(fiber.state, 2 /* ACTIVE */)
  await fiber.dispose()
})

test('tools register the herdr control surface', async () => {
  const ctx = new Context()
  const registered: Array<{ name: string; presentCall?: (args: never) => unknown }> = []
  ctx.provide('tools', { register: (def: { name: string; presentCall?: (args: never) => unknown }) => {
    registered.push(def)
    return () => {}
  } })
  ctx.provide('jobs', { start: () => 'herdr-1' })
  const clientFiber = await ctx.plugin({ name: 'dsh-plugin-herdr-client', apply: applyClient, inject: [] }, FULL_CONFIG)
  const fiber = await ctx.plugin({ name: 'dsh-plugin-herdr', apply, inject: ['tools', 'herdr', 'jobs'] }, FULL_CONFIG)
  try {
    const names = registered.map(r => r.name)
    // 全量 socket 迁移后 layout_apply 恒注册；agent_start 恒注册（19 个工具）
    assert.equal(names.length, 19, 'all tools registered: ' + names.join(','))
    assert.ok(names.includes('herdr_layout_apply'), 'layout_apply registered (socket transport only)')
    assert.ok(names.includes('herdr_agent_start'), 'agent_start registered')
    assert.ok(registered.find(r => r.name === 'herdr_pane_run'), 'herdr_pane_run registered')
    assert.ok(registered.find(r => r.name === 'herdr_snapshot'), 'herdr_snapshot registered')
  } finally {
    // 断言失败也必须清理（tracker interval 泄漏会让测试进程挂起）
    await fiber.dispose()
    await clientFiber.dispose()
  }
})

test('config schema fills defaults', () => {
  const ok = Config['~standard'].validate({}) as { value: ConfigType }
  assert.equal(ok.value.timeoutMs, 30000)
  assert.equal(ok.value.allowBackground, false)
  assert.equal(ok.value.reportState, true)
  assert.equal(ok.value.events.enabled, true)
})
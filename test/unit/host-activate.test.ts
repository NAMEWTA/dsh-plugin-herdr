// Host activation: provider before consumer, optional webServer/skills, Typert acceptance.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import { TypertRegistry } from '@deepseek-ai/dsh-typert-registry'
import { apply } from '../../lib/index.js'
import * as sessionMode from '../../lib/session-mode.js'
import { TYPERT } from '../../lib/typert.host.js'
import type { Config as ConfigType } from '../../src/host/config.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const FULL_CONFIG: ConfigType = {
  timeoutMs: 30000,
  allowBackground: false,
  events: { enabled: false, maxReconnectMs: 30000 },
  reportState: true,
}

const TOOLS = [
  'herdr_snapshot',
  'herdr_agent_list',
  'herdr_pane_run',
  'herdr_agent_wait',
  'herdr_workspace_create',
  'herdr_pane_split',
  'herdr_pane_send_keys',
  'herdr_pane_read',
  'herdr_pane_layout',
  'herdr_layout_apply',
  'herdr_agent_prompt',
  'herdr_agent_start',
  'herdr_agent_explain',
  'herdr_agent_send_keys',
  'herdr_notification',
  'herdr_workspace_close',
  'herdr_pane_close',
  'herdr_workspace_rename',
  'herdr_pane_rename',
]

interface ToolDef {
  name: string
  output?: { schema?: unknown }
  presentCall?: unknown
  presentResult?: unknown
}

interface PresetDef {
  id: string
  name?: string
  description?: string
  plugins: Array<{ name: string }>
}

async function waitUntil(predicate: () => boolean, label: string) {
  const start = Date.now()
  while (!predicate()) {
    if (Date.now() - start > 1000) assert.fail(label)
    await new Promise(resolve => setTimeout(resolve, 10))
  }
}

function hostContext(options: { skills: boolean; webServer: boolean }) {
  const ctx = new Context()
  const tools: ToolDef[] = []
  const routes: string[] = []
  const skills: Array<Record<string, unknown>> = []
  const presets: PresetDef[] = []
  ctx.provide('tools', {
    register: (def: ToolDef) => {
      tools.push(def)
      return () => {}
    },
  })
  ctx.provide('jobs', { start: () => 'herdr-1' })
  ctx.provide('agentPresets', {
    register: async (definition: PresetDef) => {
      presets.push(definition)
      return async () => {}
    },
  })
  ctx.provide('typertGateway', {})
  if (options.skills) {
    ctx.provide('skills', {
      register: (skill: Record<string, unknown>) => {
        skills.push(skill)
        return () => {}
      },
    })
  }
  if (options.webServer) {
    const hit = (kind: string) => (path: string) => { routes.push(`${kind} ${path}`) }
    ctx.provide('webServer', {
      get: hit('GET'),
      post: hit('POST'),
      put: hit('PUT'),
      delete: hit('DELETE'),
      route: hit('ROUTE'),
      use: hit('USE'),
    })
  }
  const typert = new TypertRegistry(ctx)
  return { ctx, tools, routes, skills, presets, typert }
}

test('tools, jobs, skills, webServer, typert, and typertGateway activate the single host entry', async () => {
  const patch = readFileSync(join(root, 'cordis.patch.yml'), 'utf8')
  assert.doesNotMatch(patch, /session-mode/)
  assert.match(patch, /name: '@namewta\/dsh-plugin-herdr'$/m)
  assert.doesNotMatch(patch, /client-entry/)

  const { ctx, tools, routes, skills, presets, typert } = hostContext({ skills: true, webServer: true })
  const stopTypert = typert.register(TYPERT as never)
  const fiber = await ctx.plugin({ name: 'dsh-plugin-herdr', apply, inject: [] }, FULL_CONFIG)
  let sessionFiber: { dispose(): Promise<void>; state: number } | undefined
  try {
    assert.equal(fiber.state, 2)
    assert.equal(typeof ctx.herdr.snapshot, 'function')
    await waitUntil(() => presets.length === 1, 'preset did not register')
    assert.equal(presets[0].id, 'herdr')
    assert.ok(presets[0].plugins.some(plugin => plugin.name === '@namewta/dsh-plugin-herdr/session-mode'))
    assert.ok(presets[0].plugins.some(plugin => plugin.name === '@deepseek-ai/dsh-persona'))
    sessionFiber = await ctx.plugin({
      name: sessionMode.name,
      apply: sessionMode.apply,
      inject: sessionMode.inject,
      Config: sessionMode.Config,
    }, { paneId: '', label: '', source: 'dsh:herdr-session' })
    assert.equal(sessionFiber.state, 2, 'session-mode activates only as the preset child')
    assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOLS].sort())
    for (const tool of tools) {
      assert.ok(tool.output && typeof tool.output.schema === 'object' && tool.output.schema !== null, tool.name)
      assert.equal('presentCall' in tool, false, tool.name)
      assert.equal('presentResult' in tool, false, tool.name)
    }
    await waitUntil(() => skills.length === 1, 'skill did not register')
    assert.deepEqual(Object.keys(skills[0]).sort(), ['content', 'description', 'name', 'source'])
    assert.equal(skills[0].source, 'runtime')
    assert.deepEqual(routes, [])
    const panel = (ctx as Context & { herdrPanel?: { typertRemote?: { serviceKey?: string; namespace?: string } } }).herdrPanel
    assert.equal(panel?.typertRemote?.serviceKey, 'herdrPanel')
    assert.equal(panel?.typertRemote?.namespace, 'herdr')
    const status = typert.local.get('herdr/status')
    assert.equal(status?.service, 'herdrPanel')
    assert.equal(status?.namespace, 'herdr')
    assert.equal(status?.method, 'status')
    const events = typert.local.get('herdr/events')
    assert.equal(events?.service, 'herdrPanel')
    assert.equal(events?.mode, 'stream')
    assert.equal(events?.cancellation?.parameter, 'signal')
    assert.equal(events?.result.mode, 'strict')
    if (events?.result.mode === 'strict') {
      const parsed = events.result.create().parse({ ok: true }) as { ok?: boolean }
      assert.equal(parsed.ok, true)
    }
  } finally {
    stopTypert()
    await sessionFiber?.dispose()
    await fiber.dispose()
  }
})

test('missing webServer and skills still registers tools', async () => {
  const { ctx, tools, routes, skills } = hostContext({ skills: false, webServer: false })
  const fiber = await ctx.plugin({ name: 'dsh-plugin-herdr', apply, inject: [] }, FULL_CONFIG)
  try {
    assert.equal(fiber.state, 2)
    assert.equal(typeof ctx.herdr.snapshot, 'function')
    assert.deepEqual(tools.map(tool => tool.name).sort(), [...TOOLS].sort())
    assert.deepEqual(routes, [])
    assert.deepEqual(skills, [])
  } finally {
    await fiber.dispose()
  }
})

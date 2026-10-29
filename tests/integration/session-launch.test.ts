import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { chmod, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { WorkbenchError } from '@workbench/contracts'
import { createHerdrToolBridge } from '@workbench/herdr'
import { catalog } from '../../modules/herdr/src/contracts/index.ts'
import { createFixture } from './fixture.ts'

const launchOutput = catalog['herdr.agents.launch'].output

const exec = promisify(execFile)
const SHIM = '#!/bin/sh\nwhile true; do sleep 3600; done\n'

async function missing(name: string): Promise<boolean> {
  try { await exec('sh', ['-c', `command -v ${name}`]); return false }
  catch { return true }
}

test('a new session binds its project path on the first Herdr tool call and can launch agents', {timeout: 300000}, async t => {
  const bin = await mkdtemp(join(tmpdir(), 'wb-agent-bin-'))
  let extraPath: string | undefined
  for (const name of ['claude', 'codex'] as const) {
    if (await missing(name)) {
      await writeFile(join(bin, name), SHIM, {mode: 0o700})
      await chmod(join(bin, name), 0o700)
      extraPath = bin
    }
  }
  const f = await createFixture(extraPath ? {extraPath} : {})
  t.after(async () => { await f.dispose(); await rm(bin, {recursive: true, force: true}) })
  const bridge = createHerdrToolBridge(f.runtime)
  const fresh = {...f.a, conversationId: 'fresh-session'}

  await t.test('the first inspect creates and binds the project path as a tool workspace', async () => {
    const before = (await f.invoke('herdr.snapshot', {})).workspaces.length
    const viewed = await bridge.inspect('fresh-session', fresh, f.home)
    assert.equal(typeof viewed, 'object')
    const binding = await f.invoke('herdr.binding.get', {conversationId: 'fresh-session'})
    assert.ok(binding.ref)
    assert.equal((await f.invoke('herdr.snapshot', {})).workspaces.length, before + 1)
    const resources = await f.invoke('herdr.session.resources', {conversationId: 'fresh-session'}, f.a)
    const workspace = resources.nodes[0]?.entries.find(entry => entry.role === 'workspace')
    assert.equal(workspace?.origin, 'tool')
    assert.equal(workspace?.ref.id, binding.ref!.id)
    await bridge.inspect('fresh-session', fresh, f.home)
    assert.equal((await f.invoke('herdr.snapshot', {})).workspaces.length, before + 1)
  })

  await t.test('an existing workspace at the same directory is reused and recorded as bound', async () => {
    const dir = join(f.home, 'reuse-me')
    await mkdir(dir, {mode: 0o700})
    const created = await f.invoke('herdr.workspace.create', {label: 'reuse-me', cwd: dir})
    const wanted = await realpath(dir)
    let matched = false
    for (let attempt = 0; attempt < 40 && !matched; attempt++) {
      const state = await f.invoke('herdr.snapshot', {})
      for (const pane of state.panes.filter(item => item.workspaceId === created.id && item.cwd)) {
        try { if (await realpath(pane.cwd!) === wanted) matched = true } catch { /* cwd not ready */ }
      }
      if (!matched) await delay(250)
    }
    assert.equal(matched, true, 'Herdr did not report the new workspace pane cwd')
    const count = (await f.invoke('herdr.snapshot', {})).workspaces.length
    const who = {...f.a, conversationId: 'reuse-session'}
    await bridge.inspect('reuse-session', who, dir)
    const binding = await f.invoke('herdr.binding.get', {conversationId: 'reuse-session'})
    assert.equal(binding.ref?.id, created.id)
    assert.equal((await f.invoke('herdr.snapshot', {})).workspaces.length, count)
    const resources = await f.invoke('herdr.session.resources', {conversationId: 'reuse-session'}, f.a)
    assert.equal(resources.nodes[0]?.entries.find(entry => entry.role === 'workspace')?.origin, 'bound')
  })

  await t.test('a later project path does not replace the live binding', async () => {
    const other = join(f.home, 'other-path')
    await mkdir(other, {mode: 0o700})
    const before = await f.invoke('herdr.binding.get', {conversationId: 'fresh-session'})
    const count = (await f.invoke('herdr.snapshot', {})).workspaces.length
    await bridge.inspect('fresh-session', fresh, other)
    const after = await f.invoke('herdr.binding.get', {conversationId: 'fresh-session'})
    assert.deepEqual(after.ref, before.ref)
    assert.equal((await f.invoke('herdr.snapshot', {})).workspaces.length, count)
  })

  await t.test('one call starts four codex and four claude without sending a prompt', async () => {
    const result = launchOutput.parse(await bridge.launch('fresh-session', fresh, {agents: [{kind: 'codex', count: 4}, {kind: 'claude', count: 4}], send: false}, crypto.randomUUID(), f.home))
    assert.equal(result.send, false)
    assert.equal(result.workspaceId.length > 0, true)
    const started = result.started
    assert.equal(started.length, 8)
    assert.equal(new Set(started.map(agent => agent.paneId)).size, 8)
    assert.deepEqual(started.map(agent => agent.kind).sort(), ['claude', 'claude', 'claude', 'claude', 'codex', 'codex', 'codex', 'codex'])
    for (const agent of started) {
      assert.match(agent.name, /^[a-z][a-z0-9_-]{0,31}$/)
      assert.equal(agent.command, agent.kind)
      assert.equal(agent.workspaceId, result.workspaceId)
      assert.ok(agent.paneId && agent.terminalId && agent.tabId && agent.ref.id === agent.paneId)
    }
    const state = await f.invoke('herdr.snapshot', {})
    assert.ok(state.panes.filter(pane => pane.workspaceId === result.workspaceId).length >= 8)
    const resources = await f.invoke('herdr.session.resources', {conversationId: 'fresh-session'}, f.a)
    const agents = resources.nodes[0]?.entries.filter(entry => entry.role === 'agent' && entry.origin === 'tool') ?? []
    assert.equal(agents.filter(entry => entry.agentKind === 'codex').length, 4)
    assert.equal(agents.filter(entry => entry.agentKind === 'claude').length, 4)
  })

  await t.test('eight separate launches on a second session all succeed', async () => {
    const dir = join(f.home, 'loop')
    await mkdir(dir, {mode: 0o700})
    const who = {...f.a, conversationId: 'loop-session'}
    const names = new Set<string>()
    for (let index = 0; index < 8; index++) {
      const kind = index % 2 === 0 ? 'codex' : 'claude'
      const result = launchOutput.parse(await bridge.launch('loop-session', who, {agents: [{kind, count: 1}], send: false}, crypto.randomUUID(), dir))
      assert.equal(result.started.length, 1)
      assert.equal(result.started[0]!.kind, kind)
      names.add(result.started[0]!.paneId)
    }
    assert.equal(names.size, 8)
    const resources = await f.invoke('herdr.session.resources', {conversationId: 'loop-session'}, f.a)
    const agents = resources.nodes[0]?.entries.filter(entry => entry.role === 'agent') ?? []
    assert.equal(agents.length, 8)
    assert.ok(agents.every(entry => entry.origin === 'tool'))
  })

  await t.test('a bad kind, send:true, or a prompt names the field and starts nothing', async () => {
    const panes = (await f.invoke('herdr.snapshot', {})).panes.length
    await assert.rejects(bridge.launch('fresh-session', fresh, {agents: [{kind: 'gpt', count: 1}], send: false}, crypto.randomUUID(), f.home), (error: unknown) => {
      assert.equal((error as WorkbenchError).code, 'INVALID_REQUEST')
      assert.match((error as Error).message, /agents\[0\]\.kind/)
      assert.match((error as Error).message, /codex, claude, claude-code/)
      return true
    })
    await assert.rejects(bridge.launch('fresh-session', fresh, {agents: [{kind: 'codex', count: 1}], send: true}, crypto.randomUUID(), f.home), (error: unknown) => {
      assert.equal((error as WorkbenchError).code, 'INVALID_REQUEST')
      assert.match((error as Error).message, /field send/)
      return true
    })
    await assert.rejects(bridge.launch('fresh-session', fresh, {agents: [{kind: 'codex', count: 1}], send: false, prompt: 'hello'}, crypto.randomUUID(), f.home), (error: unknown) => {
      assert.equal((error as WorkbenchError).code, 'INVALID_REQUEST')
      assert.match((error as Error).message, /field prompt/)
      return true
    })
    assert.equal((await f.invoke('herdr.snapshot', {})).panes.length, panes)
  })

  await t.test('a read-only identity and a different conversation stay forbidden', async () => {
    const reader = {...f.a, id: 'reader', clientId: 'reader', conversationId: 'readonly-session', capabilities: new Set(['herdr.read', 'platform.read'])}
    await assert.rejects(bridge.inspect('readonly-session', reader, f.home), (error: unknown) => {
      assert.equal((error as WorkbenchError).code, 'FORBIDDEN')
      assert.match((error as Error).message, /herdr\.manage/)
      return true
    })
    await assert.rejects(bridge.inspect('someone-else', fresh, f.home), (error: unknown) => {
      assert.equal((error as WorkbenchError).code, 'FORBIDDEN')
      assert.match((error as Error).message, /focused workspace/)
      return true
    })
    assert.equal((await f.invoke('herdr.binding.get', {conversationId: 'readonly-session'})).ref, null)
  })
})

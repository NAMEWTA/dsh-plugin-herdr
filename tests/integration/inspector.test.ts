import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createFixture } from './fixture.ts'

test('real pane inspector: authoritative metadata, copy-only CLI parity and rejected stale targets',{timeout:30000},async t=>{
  const f=await createFixture();t.after(()=>f.dispose())
  const workspace=await f.invoke('herdr.workspace.create',{label:'inspector-integration',cwd:f.home})
  const pane=(await f.invoke('herdr.snapshot',{})).panes.find(p=>p.workspaceId===workspace.id)!
  const baseline=f.manager.processCount
  const inspected=await f.invoke('herdr.pane.inspect',{ref:pane.ref})
  assert.deepEqual(inspected.pane.ref,pane.ref)
  assert.equal(inspected.workspace.ref.id,workspace.id)
  assert.equal(inspected.pane.cwd,f.home)
  assert.equal(inspected.socketPath,f.config.socketPath)
  assert.equal(f.manager.processCount,baseline,'inspection must not start a terminal bridge')
  assert.equal(inspected.commands.length,6)
  // Execute only the generated readonly commands against the disposable daemon; never developer resources.
  for(const command of inspected.commands.filter(c=>c.id!=='agent')){
    const output=execFileSync('/bin/sh',['-c',command.command],{cwd:f.home,encoding:'utf8',timeout:5000,maxBuffer:1024*1024})
    if(command.id==='pane')assert.ok(output.includes(pane.ref.id))
    if(command.id!=='output')assert.equal(JSON.parse(output).error,undefined)
  }
  await assert.rejects(f.invoke('herdr.pane.inspect',{ref:pane.ref},{...f.a,capabilities:new Set()}),{code:'FORBIDDEN'})
  await assert.rejects(f.invoke('herdr.pane.inspect',{ref:{...pane.ref,instance:'replaced'}}),{code:'RESOURCE_CHANGED'})
  await f.invoke('herdr.resource.close',{ref:workspace,confirmed:true})
  await assert.rejects(f.invoke('herdr.pane.inspect',{ref:pane.ref}),{code:'RESOURCE_CHANGED'})
})

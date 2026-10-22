import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { shellQuote, inspectorCommands, inspectPane } from '../../modules/herdr/src/domain/inspector.ts'
import type { ResourceRef, EnvironmentReport, HerdrSnapshot } from '../../modules/herdr/src/contracts/index.ts'
const ref:ResourceRef={connectionId:'local',session:'test',epoch:'epoch',kind:'pane',id:'w1:p1',instance:'terminal-1'}
const report={connected:true,verified:true,supported:true,error:null,installation:'installed',binary:'/opt/herdr',version:'herdr 0.9.3',socketPath:'/tmp/explicit.sock',session:'test'} as EnvironmentReport
const snapshot={connectionId:'local',session:'test',epoch:'epoch',sampledAt:1,connection:'online',stale:false,version:'0.9.3',protocol:22,
  workspaces:[{ref:{...ref,kind:'workspace',id:'w1'},label:'workspace'}],tabs:[{ref:{...ref,kind:'tab',id:'w1:t1'},workspaceId:'w1'}],
  panes:[{ref,workspaceId:'w1',tabId:'w1:t1',cwd:null,label:'shell',agent:null,ownership:'external'}]} as HerdrSnapshot

test('shell quoting preserves hostile text literally and rejects control characters',()=>{
  const value="quoted ' $HOME `id` ; $(id) & > file"
  assert.equal(execFileSync('/bin/sh',['-c',`printf '%s' ${shellQuote(value)}`],{encoding:'utf8'}),value)
  for(const bad of ['', '\n','\r','\0','\x1b','\x7f'])assert.throws(()=>shellQuote(bad))
})
test('six read-only commands pin socket and binary without an overriding session argument',()=>{
  const commands=inspectorCommands(report,ref)
  assert.equal(commands.length,6)
  assert.deepEqual(commands.map(c=>c.id),['snapshot','pane','layout','process','output','agent'])
  for(const c of commands){assert.ok(c.command.startsWith("HERDR_SOCKET_PATH='/tmp/explicit.sock' '/opt/herdr' "));assert.ok(!c.command.includes('--session'))}
  assert.ok(commands.find(c=>c.id==='output')!.command.endsWith("pane read 'w1:p1' --source visible --lines 80 --format text"))
})
test('unverified binary, unsupported protocol, unknown endpoint or wrong session never generates commands',()=>{
  for(const patch of [{connected:false},{verified:false},{supported:false},{binary:null},{binary:'herdr'},{socketPath:''},{socketPath:'relative.sock'},{socketPath:'/tmp/line\nbreak'},{version:'0.9.2'},{error:'PROBE_FAILED'},{installation:'missing'},{session:'other'}])assert.deepEqual(inspectorCommands({...report,...patch} as EnvironmentReport,ref),[])
  for(const id of ['--session=other','x;touch /tmp/no','w1:p1\n'])assert.deepEqual(inspectorCommands(report,{...ref,id}),[])
})
test('inspection includes external ordinary panes, keeps absent cwd truthful and never adopts them',()=>{
  const actual=inspectPane(snapshot,report,ref)
  assert.equal(actual.pane.cwd,null);assert.equal(actual.pane.ownership,'external')
  assert.equal(actual.workspace.ref.id,'w1');assert.equal(actual.tab.ref.id,'w1:t1')
  assert.equal(actual.commands.length,6)
  assert.deepEqual(inspectPane({...snapshot,version:'0.9.4'},report,ref).commands,[])
})
test('inspection rejects stale, disappeared, replaced and cross-session resources',()=>{
  assert.throws(()=>inspectPane({...snapshot,stale:true},report,ref),{code:'STALE_SNAPSHOT'})
  assert.throws(()=>inspectPane({...snapshot,panes:[]},report,ref),{code:'RESOURCE_CHANGED'})
  for(const patch of [{instance:'new-terminal'},{epoch:'new-epoch'},{session:'other'},{id:'w9:p1'}])assert.throws(()=>inspectPane(snapshot,report,{...ref,...patch}),{code:'RESOURCE_CHANGED'})
  assert.throws(()=>inspectPane(snapshot,{...report,session:'other'},ref),{code:'RESOURCE_CHANGED'})
  assert.throws(()=>inspectPane({...snapshot,tabs:[]},report,ref),{code:'RESOURCE_CHANGED'})
})

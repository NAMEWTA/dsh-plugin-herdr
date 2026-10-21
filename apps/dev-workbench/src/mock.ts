import { z } from 'zod'
import { WorkbenchError, type Json, type WorkbenchClient } from '@workbench/contracts'
import { WorkbenchRuntime, MemoryStorage, MemoryAudit, createPlatformModule } from '@workbench/core'
import { memoryClient, testPrincipal } from '@workbench/testkit'
import { notesModule, notesManifest } from '@workbench/example-notes'
import { herdrManifest } from '@workbench/herdr/manifest'
import { catalog, terminalAttachSchema, terminalEventSchema, terminalInputSchema, type HerdrSnapshot, type ResourceRef, type OperationId } from '@workbench/herdr/contracts'
import type { ModuleContext } from '@workbench/sdk'
const ref = (kind:ResourceRef['kind'],id:string):ResourceRef => ({connectionId:'local',session:'demo',epoch:'fixture-epoch',kind,id,instance:'fixture-'+id})
export function fixture(scenario='normal'): HerdrSnapshot {
  const states = ['blocked','working','done','idle','working','unknown'] as const
  const panes = Array.from({length:scenario==='large'?1000:6},(_,i)=>({ref:ref('pane','w'+(i%3+1)+':p'+(i+1)),workspaceId:'w'+(i%3+1),tabId:'w'+(i%3+1)+':t1',terminalId:'fixture-terminal-'+i,label:['API · 请求校验','UI · 组件系统','测试 · 终端回归','文档 · 架构说明','修复 · 租约边界','交互 Shell'][i%6]!,title:'Fixture',agent:i%6===5?null:['claude','codex'][i%2]!,state:states[i%6]!,stateSequence:3,cwd:'/demo/workbench',revision:10,ownership:'created' as const}))
  const empty = scenario==='empty'
  return {connectionId:'local',session:'demo',epoch:'fixture-epoch',revision:12,sampledAt:Date.now(),receivedAt:Date.now(),connection:scenario==='offline'?'offline':scenario==='unsupported'?'incompatible':'online',stale:['stale','offline','unsupported'].includes(scenario),eventStream:scenario==='stale'?'polling':'connected',eventGap:scenario==='stale',version:'0.9.3',protocol:scenario==='unsupported'?99:22,error:scenario==='offline'?'CONNECTION_UNAVAILABLE':null,
    workspaces:empty?[]:['Workbench','服务端控制面','文档与验证'].map((label,i)=>({ref:ref('workspace','w'+(i+1)),label,paneCount:panes.filter(p=>p.workspaceId==='w'+(i+1)).length,tabCount:1,ownership:'created' as const})),
    tabs:empty?[]:[1,2,3].map(i=>({ref:ref('tab','w'+i+':t1'),workspaceId:'w'+i,label:'Main',ownership:'created' as const})),panes:empty?[]:panes,
    activity:empty?[]:[{id:'event-2',at:Date.now()-30000,type:'pane_updated',resourceId:'w1:p1'},{id:'event-1',at:Date.now()-60000,type:'workspace_created',resourceId:'w2'}]}
}
export async function createDemo(scenario: string): Promise<{client:WorkbenchClient;dispose:()=>Promise<void>}> {
  const storage = new MemoryStorage(),audit = new MemoryAudit(),runtime = new WorkbenchRuntime({storage,audit})
  runtime.register(createPlatformModule(runtime,audit,{version:'1.0.0-alpha.1 · FIXTURE',sha:'development'}))
  let state = fixture(scenario),serial = 10
  const binding = {conversationId:'demo-conversation',ref:null as ResourceRef|null}
  runtime.register({manifest:herdrManifest,start(ctx:ModuleContext){
    for (const c of herdrManifest.contributions) ctx.contribution(c)
    for (const [id,definition] of Object.entries(catalog)) {
      ctx.operation({id,...definition,input:definition.input as z.ZodType<unknown>,output:definition.output as z.ZodType<unknown>,run:async input=>{
        if (scenario==='loading') await new Promise(resolve=>setTimeout(resolve,10000))
        if (scenario==='forbidden') throw new WorkbenchError('FORBIDDEN')
        if (id==='herdr.snapshot') return state
        if (id==='herdr.environment'||id==='herdr.server.start') return {process:{pid:1234,startedAt:Date.now()-100000,sampledAt:Date.now(),cpuPercent:null,rssBytes:64000000,source:'node-process'},replayBytes:0,subscriptions:0,closingProcesses:0,platform:'linux',arch:'x64',binary:'/demo/herdr',version:'herdr 0.9.3',installation:'installed',connected:true,verified:true,socketPath:'/demo/herdr.sock',session:'demo',rootDirectory:'/demo/workbench',streaming:true,supported:true,error:null,bridgeProcesses:0,observers:0,controllers:0,limits:{maxProcesses:16,maxObservers:8,maxControllers:2},agentKinds:['claude','codex']}
        const value = input as Record<string,unknown>
        if (id==='herdr.workspace.create') { const r=ref('workspace','w'+(++serial));state={...state,workspaces:[...state.workspaces,{ref:r,label:String(value.label),paneCount:0,tabCount:0,ownership:'created'}]};ctx.emit({type:'invalidate'});return r }
        if (id==='herdr.resource.rename') { const target=value.ref as ResourceRef;state={...state,workspaces:state.workspaces.map(w=>w.ref.id===target.id?{...w,label:String(value.label)}:w),panes:state.panes.map(p=>p.ref.id===target.id?{...p,label:String(value.label)}:p)};ctx.emit({type:'invalidate'});return {} }
        if (id==='herdr.resource.close') { const target=value.ref as ResourceRef;state={...state,workspaces:state.workspaces.filter(w=>w.ref.id!==target.id),panes:state.panes.filter(p=>p.ref.id!==target.id&&p.workspaceId!==target.id)};ctx.emit({type:'invalidate'});return {} }
        if (id==='herdr.binding.get') return binding
        if (id==='herdr.binding.set') {binding.ref=value.ref as ResourceRef|null;return binding}
        if (id==='herdr.terminal.open') return {leaseId:'fixture-lease-12345678',sessionId:'fixture-session',mode:value.mode,generation:1,ref:value.ref,expiresAt:Date.now()+3600000}
        if (id==='herdr.tab.create') return ref('tab','w1:t'+(++serial))
        if (id==='herdr.pane.split') return ref('pane','w1:p'+(++serial))
        return {}
      }})
    }
    ctx.stream({id:'herdr.terminal.frames',capability:'herdr.observe',input:terminalAttachSchema,output:terminalEventSchema,uplink:terminalInputSchema,async *run(_input,c,uplink){
      yield {type:'frame' as const,generation:1,seq:1,full:true,width:100,height:28,bytes:btoa('\x1b[2J\x1b[H\x1b[36mWorkbench terminal fixture\x1b[0m\r\nNo commands are executed. Production uses the real Herdr stream.\r\n$ ')}
      let seq=1
      for await (const command of uplink) { if (c.signal.aborted) break; if(command.type==='input'){yield {type:'ack' as const,sequence:command.sequence};yield {type:'frame' as const,generation:1,seq:++seq,full:false,width:100,height:28,bytes:command.bytes}} }
    }})
  }})
  runtime.register(notesModule);await runtime.startAll()
  const principal = testPrincipal(['platform.read','platform.manage',...herdrManifest.capabilities,...notesManifest.capabilities],'demo-browser')
  return {client:memoryClient(runtime,principal),dispose:()=>runtime.dispose()}
}

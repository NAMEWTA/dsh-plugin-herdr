import { z } from 'zod'
import { WorkbenchError, type Json, type WorkbenchClient } from '@workbench/contracts'
import { WorkbenchRuntime, MemoryStorage, MemoryAudit, createPlatformModule } from '@workbench/core'
import { memoryClient, testPrincipal } from '@workbench/testkit'
import { notesModule, notesManifest } from '@workbench/example-notes'
import { herdrManifest } from '@workbench/herdr/manifest'
import { catalog, sessionLedgerSchema, terminalAttachSchema, terminalEventSchema, terminalInputSchema, type HerdrSnapshot, type ResourceRef, type SessionLedger, type OperationId } from '@workbench/herdr/contracts'
import { inspectPane } from '@workbench/herdr/inspection'
import type { ModuleContext } from '@workbench/sdk'
const ref = (kind:ResourceRef['kind'],id:string):ResourceRef => ({connectionId:'local',session:'demo',epoch:'fixture-epoch',kind,id,instance:'fixture-'+id})
export function fixture(scenario='normal'): HerdrSnapshot {
  const states = ['blocked','working','done','idle','working','unknown'] as const
  const panes = Array.from({length:scenario==='large'?1000:6},(_,i)=>({ref:ref('pane','w'+(i%3+1)+':p'+(i+1)),workspaceId:'w'+(i%3+1),tabId:'w'+(i%3+1)+':t1',terminalId:'fixture-terminal-'+i,label:['API · 请求校验','UI · 组件系统','测试 · 终端回归','文档 · 架构说明','修复 · 租约边界','交互 Shell'][i%6]!,title:'Fixture',agent:i%6===5?null:['claude','codex'][i%2]!,state:states[i%6]!,stateSequence:3,cwd:'/demo/workbench',revision:10,ownership:scenario==='external'?'external' as const:'created' as const}))
  const empty = scenario==='empty'
  return {connectionId:'local',session:'demo',epoch:'fixture-epoch',revision:12,sampledAt:Date.now(),receivedAt:Date.now(),connection:scenario==='offline'?'offline':scenario==='unsupported'?'incompatible':'online',stale:['stale','offline','unsupported'].includes(scenario),eventStream:scenario==='stale'?'polling':'connected',eventGap:scenario==='stale',version:'0.9.3',protocol:scenario==='unsupported'?99:22,error:scenario==='offline'?'CONNECTION_UNAVAILABLE':null,
    workspaces:empty?[]:['Workbench','服务端控制面','文档与验证'].map((label,i)=>({ref:ref('workspace','w'+(i+1)),label,paneCount:panes.filter(p=>p.workspaceId==='w'+(i+1)).length,tabCount:1,ownership:scenario==='external'?'external' as const:'created' as const})),
    tabs:empty?[]:[1,2,3].map(i=>({ref:ref('tab','w'+i+':t1'),workspaceId:'w'+i,label:'Main',ownership:scenario==='external'?'external' as const:'created' as const})),panes:empty?[]:panes,
    activity:empty?[]:[{id:'event-2',at:Date.now()-30000,type:'pane_updated',resourceId:'w1:p1'},{id:'event-1',at:Date.now()-60000,type:'workspace_created',resourceId:'w2'}]}
}
export async function createDemo(scenario: string): Promise<{client:WorkbenchClient;dispose:()=>Promise<void>}> {
  const storage = new MemoryStorage(),audit = new MemoryAudit(),runtime = new WorkbenchRuntime({storage,audit})
  runtime.register(createPlatformModule(runtime,audit,{version:'1.0.3-alpha.1 · FIXTURE',sha:'development'}))
  let state = fixture(scenario),serial = 10
  const bindings=new Map<string,ResourceRef|null>();if(scenario==='bound')bindings.set('demo-conversation',ref('workspace','w1'))
  const paths=new Map<string,string|null>();if(scenario==='bound')paths.set('demo-conversation','/demo/workbench')
  const ledgers=new Map<string,SessionLedger>()
  if(!['empty','forbidden','loading','unlinked','large'].includes(scenario)&&state.workspaces.length){
    const paneEntries=state.panes.filter(pane=>pane.workspaceId==='w1').map(pane=>({ref:pane.ref,role:pane.agent?'agent' as const:'terminal' as const,origin:'tool' as const,operation:'herdr.workspace.create',requestId:'seed-'+pane.ref.id,createdAt:Date.now(),...pane.agent?{agentKind:pane.agent}:{},label:pane.label}))
    const childPane=state.panes.find(pane=>pane.ref.id==='w2:p2')
    ledgers.set('demo-conversation',sessionLedgerSchema.parse({conversationId:'demo-conversation',childConversationIds:childPane?['demo-subagent']:[],entries:[
      {ref:state.workspaces[0]!.ref,role:'workspace',origin:'tool',operation:'herdr.workspace.create',requestId:'seed-w1',createdAt:Date.now(),label:state.workspaces[0]!.label},
      ...state.tabs.filter(tab=>tab.workspaceId==='w1').map(tab=>({ref:tab.ref,role:'tab' as const,origin:'tool' as const,operation:'herdr.tab.create',requestId:'seed-'+tab.ref.id,createdAt:Date.now(),label:tab.label})),
      ...paneEntries,
      {ref:ref('pane','gone:p9'),role:'terminal',origin:'ui',operation:'herdr.pane.split',requestId:'seed-gone',createdAt:Date.now()-86_400_000,label:'旧构建终端',lastSeen:{status:'closed',at:Date.now()-3600_000}},
    ]}))
    if(childPane)ledgers.set('demo-subagent',sessionLedgerSchema.parse({conversationId:'demo-subagent',parentConversationId:'demo-conversation',childConversationIds:[],entries:[{ref:childPane.ref,role:'agent',origin:'tool',operation:'herdr.agent.start',requestId:'seed-sub',createdAt:Date.now(),agentKind:childPane.agent??'codex',label:childPane.label}]}))
  }
  runtime.register({manifest:herdrManifest,start(ctx:ModuleContext){
    for (const c of herdrManifest.contributions) ctx.contribution(c)
    for (const [id,definition] of Object.entries(catalog)) {
      ctx.operation({id,...definition,input:definition.input as z.ZodType<unknown>,output:definition.output as z.ZodType<unknown>,run:async input=>{
        if (scenario==='loading') await new Promise(resolve=>setTimeout(resolve,10000))
        if (scenario==='forbidden') throw new WorkbenchError('FORBIDDEN')
        if (id==='herdr.snapshot') return state
        const environment = {process:{pid:1234,startedAt:Date.now()-100000,sampledAt:Date.now(),cpuPercent:null,rssBytes:64000000,source:'node-process'},replayBytes:0,subscriptions:0,closingProcesses:0,platform:'linux',arch:'x64',binary:'/demo/herdr',version:'herdr 0.9.3',installation:'installed',connected:true,verified:true,socketPath:'/demo/herdr.sock',session:'demo',rootDirectory:'/demo/workbench',streaming:true,supported:true,error:null,bridgeProcesses:0,observers:0,controllers:0,limits:{maxProcesses:16,maxObservers:8,maxControllers:2},agentKinds:['claude','codex']} as const
        if (id==='herdr.environment'||id==='herdr.server.start') return environment
        if (id==='herdr.pane.inspect') return inspectPane(state, {...environment,agentKinds:[...environment.agentKinds]}, (input as {ref:ResourceRef}).ref)
        const value = input as Record<string,unknown>
        if(id==='herdr.workspace.create'||id==='herdr.conversation.create'){
          const conversation=String(value.conversationId??'')
          if(id==='herdr.conversation.create'&&bindings.get(conversation))throw new WorkbenchError('MODULE_CONFLICT')
          const r=ref('workspace','w'+(++serial)),pane=ref('pane',r.id+':p1'),tab=ref('tab',r.id+':t1')
          state={...state,workspaces:[...state.workspaces,{ref:r,label:String(value.label),paneCount:1,tabCount:1,ownership:'created'}],tabs:[...state.tabs,{ref:tab,workspaceId:r.id,label:'1',ownership:'created'}],panes:[...state.panes,{ref:pane,workspaceId:r.id,tabId:tab.id,terminalId:'fixture-'+r.id,label:'Shell',title:'Shell',agent:null,state:'unknown',stateSequence:1,cwd:String(value.cwd),revision:1,ownership:'created'}]}
          ctx.emit({type:'invalidate'})
          if(id==='herdr.conversation.create'){bindings.set(conversation,r);paths.set(conversation,String(value.cwd||''));return {conversationId:conversation,ref:r,cwd:String(value.cwd||'')||null}}
          return r
        }
        if (id==='herdr.resource.rename') { const target=value.ref as ResourceRef;state={...state,workspaces:state.workspaces.map(w=>w.ref.id===target.id?{...w,label:String(value.label)}:w),panes:state.panes.map(p=>p.ref.id===target.id?{...p,label:String(value.label)}:p)};ctx.emit({type:'invalidate'});return {} }
        if (id==='herdr.resource.close') { const target=value.ref as ResourceRef;state={...state,workspaces:state.workspaces.filter(w=>w.ref.id!==target.id),panes:state.panes.filter(p=>p.ref.id!==target.id&&p.workspaceId!==target.id)};ctx.emit({type:'invalidate'});return {} }
        if (id==='herdr.binding.get') return {conversationId:value.conversationId,ref:bindings.get(String(value.conversationId))??null,cwd:paths.get(String(value.conversationId))??null}
        if (id==='herdr.binding.set') {bindings.set(String(value.conversationId),value.ref as ResourceRef|null);return {conversationId:value.conversationId,ref:value.ref,cwd:paths.get(String(value.conversationId))??null}}
        if (id==='herdr.session.resources') {
          const conversationId=String(value.conversationId)
          const root=ledgers.get(conversationId)
          const nodes:Array<{conversationId:string;parentConversationId:string|null;entries:unknown[]}> = []
          const push=(id:string,parent:string|null)=>{
            const ledger=ledgers.get(id)
            nodes.push({conversationId:id,parentConversationId:parent,entries:(ledger?.entries??[]).map(entry=>{
              const pane=entry.ref.kind==='pane'?state.panes.find(item=>item.ref.id===entry.ref.id):undefined
              const tab=entry.ref.kind==='tab'?state.tabs.find(item=>item.ref.id===entry.ref.id):undefined
              const workspace=entry.ref.kind==='workspace'?state.workspaces.find(item=>item.ref.id===entry.ref.id):undefined
              const present=Boolean(pane||tab||workspace)
              const workspaceId=pane?.workspaceId??tab?.workspaceId??workspace?.ref.id??null
              return {...entry,presence:present?'running':entry.lastSeen?.status==='closed'||entry.lastSeen?.status==='exited'?entry.lastSeen.status:'missing',state:pane?.state??null,agent:pane?.agent??entry.agentKind??null,cwd:pane?.cwd??null,title:pane?.label||tab?.label||workspace?.label||entry.label||entry.ref.id,workspaceId,workspaceLabel:workspace?.label??(workspaceId?state.workspaces.find(item=>item.ref.id===workspaceId)?.label??null:null),tabId:pane?.tabId??(tab?tab.ref.id:null)}
            })})
          }
          push(conversationId,null)
          for(const child of root?.childConversationIds??[])push(child,conversationId)
          return {conversationId,nodes}
        }
        if (id==='herdr.session.record') {
          const conversationId=String(value.conversationId)
          const current=ledgers.get(conversationId)??{conversationId,childConversationIds:[],entries:[]}
          const entries=[...current.entries]
          for(const entry of value.entries as SessionLedger['entries']){
            const key=entry.role+entry.ref.id
            const index=entries.findIndex(item=>item.role+item.ref.id===key)
            const next={...entry,createdAt:Date.now()}
            if(index>=0)entries[index]={...entries[index]!,...next,createdAt:entries[index]!.createdAt,origin:entries[index]!.origin}
            else entries.push(next)
          }
          const parent=typeof value.parentConversationId==='string'?value.parentConversationId:current.parentConversationId
          ledgers.set(conversationId,{...current,...parent?{parentConversationId:parent}:{},entries})
          ctx.emit({type:'invalidate'});return {conversationId,count:entries.length}
        }
        if (id==='herdr.agent.start') return {ref:(value.ref as ResourceRef),kind:String(value.kind),name:String(value.kind)}
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
  const principal = {...testPrincipal(['platform.read','platform.manage',...herdrManifest.capabilities,...notesManifest.capabilities],'demo-browser'),conversationId:'demo-conversation'}
  return {client:memoryClient(runtime,principal),dispose:()=>runtime.dispose()}
}

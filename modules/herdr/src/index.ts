import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import { defineModule, type ModuleContext, type OperationContext, type Operation } from '@workbench/sdk'
import { herdrManifest } from './manifest.ts'
import { catalog, terminalAttachSchema, terminalEventSchema, terminalInputSchema, resourceSchema, type ResourceRef } from './contracts/index.ts'
import { connectionConfigSchema, type ConnectionConfig } from './contracts/config.ts'
import { LocalHerdrClient, type HerdrPort } from './infrastructure/herdr-api/client.ts'
import { inspectPane } from './domain/inspector.ts'
import { HerdrReadModel } from './application/read-model.ts'
import { TerminalLeases } from './application/terminals.ts'
import { TerminalSessionManager } from './infrastructure/terminal/manager.ts'
import { EnvironmentService, workspaceDirectory } from './infrastructure/environment/service.ts'
import { assertSessionAccess, loadSessionTree, projectResources, recordSession } from './application/session-ledger.ts'
import { ensureConversation, type EnsureResult } from './application/conversation-ensure.ts'
import { launchAgents } from './application/launch-agents.ts'
import { agentInstanceName, resolveAgentKind } from './domain/agent-launch.ts'
export { herdrManifest } from './manifest.ts'
export function createHerdrModule(configInput:ConnectionConfig,dependencies:{port?:HerdrPort;manager?:TerminalSessionManager}={}) {
  const config=connectionConfigSchema.parse(configInput)
  return defineModule({manifest:herdrManifest,async start(ctx:ModuleContext){
    const register = <I,O>(operation:Operation<I,O>) => ctx.operation({...operation,auditTarget:input=>{
      if(!input||typeof input!=='object'||!('ref' in input))return undefined
      const result=resourceSchema.safeParse(input.ref)
      if(!result.success)return undefined
      const ref=result.data;return `${ref.connectionId}/${ref.session}/${ref.kind}/${ref.id}@${ref.epoch}`
    }})
    const port=dependencies.port??new LocalHerdrClient(config)
    const model=new HerdrReadModel(port,config,ctx.signal,()=>ctx.emit({type:'invalidate'}))
    const manager=dependencies.manager??new TerminalSessionManager({config:config.terminal,binPath:config.terminal.binPath,socketPath:config.socketPath,session:config.session==='default'?undefined:config.session})
    const terminal=new TerminalLeases(manager,model,config.terminal.enabled)
    const environment=new EnvironmentService(config,model,manager)
    let stopStream:(()=>void)|undefined,connecting=false
    const subscribe=async()=>{
      if(connecting||stopStream||ctx.signal.aborted)return
      connecting=true
      try {
        const stop=await port.subscribe(event=>model.event(event),()=>{stopStream=undefined;model.stream(false)},ctx.signal)
        if(ctx.signal.aborted){stop();return}
        stopStream=stop;model.stream(true)
        await model.refresh() // subscription acknowledgement precedes snapshot
      }catch{if(!ctx.signal.aborted)model.stream(false)}finally{connecting=false}
    }
    ctx.own(async()=>{stopStream?.();await terminal.dispose()})
    // A missing daemon degrades this module's data, never prevents the workbench shell from loading.
    await subscribe();await model.refresh()
    ctx.interval(async()=>{await subscribe();await model.refresh();await terminal.reconcile()},config.pollMs)
    for(const contribution of herdrManifest.contributions)ctx.contribution(contribution)
    const connection=(p:Principal)=>{if(!p.connectionIds.has(config.id))throw new WorkbenchError('FORBIDDEN')}
    const action=async(ref:ResourceRef,context:OperationContext,method:string,params:unknown,timeoutMs?:number)=>{
      connection(context.principal);await model.assert(ref,true)
      await port.request(method,params,context.signal,true,timeoutMs);await model.refresh();return {}
    }
    register({...catalog['herdr.snapshot'],id:'herdr.snapshot',run:(_input,c)=>{connection(c.principal);return model.snapshot()}})
    register({...catalog['herdr.pane.inspect'],id:'herdr.pane.inspect',run:async(input,c)=>{
      connection(c.principal)
      if(input.ref.kind!=='pane')throw new WorkbenchError('INVALID_REQUEST')
      await model.assert(input.ref)
      const report=await environment.read()
      await model.assert(input.ref) // Revalidate after executable probing and daemon refresh.
      if(c.signal.aborted)throw new WorkbenchError('CANCELLED')
      return inspectPane(model.snapshot(),report,input.ref)
    }})
    register({...catalog['herdr.environment'],id:'herdr.environment',run:(_input,c)=>{connection(c.principal);return environment.read()}})
    register({...catalog['herdr.server.start'],id:'herdr.server.start',run:(_input,c)=>{connection(c.principal);return environment.start(c.signal)}})
    const createWorkspace=async(input:{label:string;cwd:string},c:OperationContext)=>{
      connection(c.principal)
      const cwd=await workspaceDirectory(config.rootDirectory,input.cwd)
      if((await model.refresh()).connection!=='online')throw new WorkbenchError('CONNECTION_UNAVAILABLE')
      const response=await port.request('workspace.create',{cwd,label:input.label,focus:false},c.signal,true)
      const parsed=z.object({workspace:z.object({workspace_id:z.string()}),root_pane:z.object({pane_id:z.string()})}).safeParse(response)
      if(!parsed.success)throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
      await model.refresh();const ref=model.find('workspace',parsed.data.workspace.workspace_id)
      model.mark(ref,'created');model.mark(model.find('pane',parsed.data.root_pane.pane_id),'created')
      for(const t of model.snapshot().tabs.filter(t=>t.workspaceId===ref.id))model.mark(t.ref,'created')
      await model.refresh();return ref
    }
    register({...catalog['herdr.workspace.create'],id:'herdr.workspace.create',run:createWorkspace})
    register({...catalog['herdr.tab.create'],id:'herdr.tab.create',run:async(input,c)=>{
      connection(c.principal);if(input.ref.kind!=='workspace')throw new WorkbenchError('INVALID_REQUEST')
      await model.assert(input.ref,true)
      const response=await port.request('tab.create',{workspace_id:input.ref.id,label:input.label,focus:false},c.signal,true)
      const parsed=z.object({tab:z.object({tab_id:z.string()}),root_pane:z.object({pane_id:z.string()})}).safeParse(response)
      if(!parsed.success)throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
      await model.refresh();const ref=model.find('tab',parsed.data.tab.tab_id)
      model.mark(ref,'created');model.mark(model.find('pane',parsed.data.root_pane.pane_id),'created');await model.refresh();return ref
    }})
    register({...catalog['herdr.resource.adopt'],id:'herdr.resource.adopt',run:async(input,c)=>{connection(c.principal);await model.assert(input.ref);model.mark(input.ref,'adopted');await model.refresh();return {}}})
    register({...catalog['herdr.resource.rename'],id:'herdr.resource.rename',run:async(input,c)=>action(input.ref,c,`${input.ref.kind}.rename`,{[`${input.ref.kind}_id`]:input.ref.id,label:input.label})})
    register({...catalog['herdr.resource.close'],id:'herdr.resource.close',run:async(input,c)=>action(input.ref,c,`${input.ref.kind}.close`,{[`${input.ref.kind}_id`]:input.ref.id,...input.ref.kind==='workspace'?{close_group:false}:{}})})
    register({...catalog['herdr.pane.split'],id:'herdr.pane.split',run:async(input,c)=>{
      connection(c.principal);if(input.ref.kind!=='pane')throw new WorkbenchError('INVALID_REQUEST')
      await model.assert(input.ref,true)
      const response=await port.request('pane.split',{target_pane_id:input.ref.id,direction:input.direction==='horizontal'?'right':'down',focus:false},c.signal,true)
      const parsed=z.object({pane:z.object({pane_id:z.string()})}).safeParse(response)
      if(!parsed.success)throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
      await model.refresh();const ref=model.find('pane',parsed.data.pane.pane_id);model.mark(ref,'created');await model.refresh();return ref
    }})
    register({...catalog['herdr.agent.start'],id:'herdr.agent.start',run:async(input,c)=>{
      if(input.ref.kind!=='pane')throw new WorkbenchError('INVALID_REQUEST','field ref.kind must be "pane". To start one or more agents without sending a prompt, call workbench_herdr_launch with {"agents":[{"kind":"codex","count":4},{"kind":"claude","count":4}],"send":false}.')
      const resolved=resolveAgentKind(input.kind)
      if(!resolved)throw new WorkbenchError('INVALID_REQUEST',`field kind must be one of codex, claude, claude-code. Received ${JSON.stringify(input.kind)}. codex runs the codex command; claude and claude-code both run the claude command.`)
      if(!config.allowedAgentKinds.includes(resolved.kind))throw new WorkbenchError('INVALID_REQUEST',`field kind ${resolved.kind} is not in the administrator allow-list (${config.allowedAgentKinds.join(', ') || 'none'}).`)
      const name=agentInstanceName(resolved.kind,1)
      await action(input.ref,c,'agent.start',{pane_id:input.ref.id,kind:resolved.kind,name,args:[],timeout_ms:8000},20000)
      return {ref:input.ref,kind:resolved.kind,name}
    }})
    register({...catalog['herdr.terminal.open'],id:'herdr.terminal.open',run:(input,c)=>{connection(c.principal);return terminal.open(input,c)}})
    register({...catalog['herdr.terminal.release'],id:'herdr.terminal.release',run:async(input,c)=>{connection(c.principal);await terminal.release(input.leaseId,c.principal);return {}}})
    ctx.stream({id:'herdr.terminal.frames',capability:'herdr.observe',input:terminalAttachSchema,output:terminalEventSchema,uplink:terminalInputSchema,run:(input,c,uplink)=>{connection(c.principal);return terminal.stream(input,c,uplink)}})
    const bindingKey=(principal:Principal,id:string)=>'binding-'+createHash('sha256').update(id).digest('hex')
    const cwdKey=(principal:Principal,id:string)=>'cwd-'+createHash('sha256').update(id).digest('hex')
    const readCwd=async(principal:Principal,id:string)=>{
      const stored=await ctx.storage.read<Json>(cwdKey(principal,id))
      return typeof stored?.value==='string'&&stored.value.length>0?stored.value:null
    }
    // Serialize per-conversation create-and-bind, without adopting a focused/external workspace.
    const creatingBindings=new Set<string>()
    const ensuring=new Map<string,Promise<EnsureResult>>()
    const reservedPanes=new Set<string>()
    register({...catalog['herdr.conversation.create'],id:'herdr.conversation.create',run:async(input,c)=>{
      connection(c.principal)
      if(c.principal.conversationId&&c.principal.conversationId!==input.conversationId)throw new WorkbenchError('FORBIDDEN')
      const key=bindingKey(c.principal,input.conversationId)
      if(creatingBindings.has(key)||ensuring.has(key))throw new WorkbenchError('MODULE_CONFLICT')
      creatingBindings.add(key)
      try{
        const stored=await ctx.storage.read<Json>(key)
        const current=resourceSchema.nullable().safeParse(stored?.value??null)
        if(!current.success)throw new WorkbenchError('STORAGE_UNAVAILABLE')
        if(current.data)throw new WorkbenchError('MODULE_CONFLICT')
        const ref=await createWorkspace(input,c)
        try{
          if(c.signal.aborted)throw new Error('cancelled after creation')
          await ctx.storage.write(key,ref,stored?.version??null)
          const path=await ctx.storage.read<Json>(cwdKey(c.principal,input.conversationId))
          await ctx.storage.write(cwdKey(c.principal,input.conversationId),input.cwd,path?.version??null)
        }catch{throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')}
        // Only the UI asks to be recorded here. A tool calls the same operation
        // without origin and records `tool` afterwards; recording `ui` first would stick.
        if(input.origin==='ui'){
          try{
            const snap=model.snapshot()
            const workspace=snap.workspaces.find(item=>item.ref.id===ref.id)
            if(workspace){
              const tabs=snap.tabs.filter(item=>item.workspaceId===ref.id)
              const panes=snap.panes.filter(item=>item.workspaceId===ref.id)
              const requestId=()=>randomUUID()
              await recordSession(ctx.storage,{conversationId:input.conversationId,entries:[
                {ref:workspace.ref,role:'workspace' as const,origin:'ui' as const,operation:'herdr.conversation.create',requestId:requestId(),label:workspace.label},
                ...tabs.map(item=>({ref:item.ref,role:'tab' as const,origin:'ui' as const,operation:'herdr.conversation.create',requestId:requestId(),label:item.label})),
                ...panes.map(item=>({ref:item.ref,role:(item.agent?'agent':'terminal') as 'agent'|'terminal',origin:'ui' as const,operation:'herdr.conversation.create',requestId:requestId(),...item.agent?{agentKind:item.agent}:{},label:item.label})),
              ].slice(0,24)})
            }
          }catch{/* The binding is already stored. The client records the same rows again. */}
        }
        ctx.emit({type:'invalidate'})
        return {conversationId:input.conversationId,ref,cwd:input.cwd}
      }finally{creatingBindings.delete(key)}
    }})
    register({...catalog['herdr.conversation.ensure'],id:'herdr.conversation.ensure',run:(input,c)=>{
      connection(c.principal)
      const key=bindingKey(c.principal,input.conversationId)
      if(creatingBindings.has(key))throw new WorkbenchError('MODULE_CONFLICT')
      const pending=ensuring.get(key)
      if(pending)return pending
      const work=ensureConversation({config,model,storage:ctx.storage,context:c,bindingKey:key,cwdKey:cwdKey(c.principal,input.conversationId),createWorkspace,emit:()=>ctx.emit({type:'invalidate'})},{conversationId:input.conversationId,cwd:input.cwd,...input.label?{label:input.label}:{},origin:input.origin}).finally(()=>{if(ensuring.get(key)===work)ensuring.delete(key)})
      ensuring.set(key,work)
      return work
    }})
    register({...catalog['herdr.agents.launch'],id:'herdr.agents.launch',run:(input,c)=>launchAgents({
      config,port,model,storage:ctx.storage,context:c,reserved:reservedPanes,bindingKey:bindingKey(c.principal,input.conversationId),cwdKey:cwdKey(c.principal,input.conversationId),
    },{conversationId:input.conversationId,agents:input.agents,...input.parentConversationId?{parentConversationId:input.parentConversationId}:{}})})
    register({...catalog['herdr.binding.get'],id:'herdr.binding.get',run:async(input,c)=>{
      connection(c.principal)
      const stored=await ctx.storage.read<Json>(bindingKey(c.principal,input.conversationId))
      const parsed=resourceSchema.nullable().safeParse(stored?.value??null)
      if(!parsed.success)throw new WorkbenchError('STORAGE_UNAVAILABLE')
      return {conversationId:input.conversationId,ref:parsed.data,cwd:await readCwd(c.principal,input.conversationId)}
    }})
    register({...catalog['herdr.binding.set'],id:'herdr.binding.set',run:async(input,c)=>{
      connection(c.principal)
      if(input.ref){if(input.ref.kind!=='workspace')throw new WorkbenchError('INVALID_REQUEST');await model.assert(input.ref)}
      const key=bindingKey(c.principal,input.conversationId),stored=await ctx.storage.read(key)
      await ctx.storage.write(key,input.ref,stored?.version??null)
      return {conversationId:input.conversationId,ref:input.ref,cwd:await readCwd(c.principal,input.conversationId)}
    }})
    register({...catalog['herdr.session.resources'],id:'herdr.session.resources',run:async(input,c)=>{
      connection(c.principal)
      assertSessionAccess(c.principal,input.conversationId)
      const ledgers=await loadSessionTree(ctx.storage,input.conversationId)
      return projectResources(input.conversationId,ledgers,model.snapshot())
    }})
    register({...catalog['herdr.session.record'],id:'herdr.session.record',run:async(input,c)=>{
      connection(c.principal)
      assertSessionAccess(c.principal,input.conversationId)
      const ledger=await recordSession(ctx.storage,{conversationId:input.conversationId,...input.parentConversationId?{parentConversationId:input.parentConversationId}:{},entries:input.entries},Date.now())
      ctx.emit({type:'invalidate'})
      return {conversationId:input.conversationId,count:ledger.entries.length}
    }})
  }})
}

export { createHerdrToolBridge } from './tool-bridge.ts'

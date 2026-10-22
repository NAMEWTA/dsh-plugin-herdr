import { createHash } from 'node:crypto'
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
    const action=async(ref:ResourceRef,context:OperationContext,method:string,params:unknown)=>{
      connection(context.principal);await model.assert(ref,true)
      await port.request(method,params,context.signal,true);await model.refresh();return {}
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
      if(input.ref.kind!=='pane'||!config.allowedAgentKinds.includes(input.kind))throw new WorkbenchError('FORBIDDEN')
      return action(input.ref,c,'agent.start',{pane_id:input.ref.id,kind:input.kind,name:input.kind+'-'+input.ref.id.replace(/[^a-zA-Z0-9-]/g,'-'),args:[],timeout_ms:10000})
    }})
    register({...catalog['herdr.terminal.open'],id:'herdr.terminal.open',run:(input,c)=>{connection(c.principal);return terminal.open(input,c)}})
    register({...catalog['herdr.terminal.release'],id:'herdr.terminal.release',run:async(input,c)=>{connection(c.principal);await terminal.release(input.leaseId,c.principal);return {}}})
    ctx.stream({id:'herdr.terminal.frames',capability:'herdr.observe',input:terminalAttachSchema,output:terminalEventSchema,uplink:terminalInputSchema,run:(input,c,uplink)=>{connection(c.principal);return terminal.stream(input,c,uplink)}})
    const bindingKey=(principal:Principal,id:string)=>'binding-'+createHash('sha256').update(id).digest('hex')
    // Serialize per-conversation create-and-bind, without adopting a focused/external workspace.
    const creatingBindings=new Set<string>()
    register({...catalog['herdr.conversation.create'],id:'herdr.conversation.create',run:async(input,c)=>{
      connection(c.principal)
      if(c.principal.conversationId&&c.principal.conversationId!==input.conversationId)throw new WorkbenchError('FORBIDDEN')
      const key=bindingKey(c.principal,input.conversationId)
      if(creatingBindings.has(key))throw new WorkbenchError('MODULE_CONFLICT')
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
        }catch{throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')}
        ctx.emit({type:'invalidate'})
        return {conversationId:input.conversationId,ref}
      }finally{creatingBindings.delete(key)}
    }})
    register({...catalog['herdr.binding.get'],id:'herdr.binding.get',run:async(input,c)=>{
      connection(c.principal)
      const stored=await ctx.storage.read<Json>(bindingKey(c.principal,input.conversationId))
      const parsed=resourceSchema.nullable().safeParse(stored?.value??null)
      if(!parsed.success)throw new WorkbenchError('STORAGE_UNAVAILABLE')
      return {conversationId:input.conversationId,ref:parsed.data}
    }})
    register({...catalog['herdr.binding.set'],id:'herdr.binding.set',run:async(input,c)=>{
      connection(c.principal)
      if(input.ref){if(input.ref.kind!=='workspace')throw new WorkbenchError('INVALID_REQUEST');await model.assert(input.ref)}
      const key=bindingKey(c.principal,input.conversationId),stored=await ctx.storage.read(key)
      await ctx.storage.write(key,input.ref,stored?.version??null)
      return {conversationId:input.conversationId,ref:input.ref}
    }})
  }})
}

export { createHerdrToolBridge } from './tool-bridge.ts'

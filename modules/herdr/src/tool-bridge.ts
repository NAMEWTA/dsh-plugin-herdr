import { randomUUID } from 'node:crypto'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import type { WorkbenchRuntime } from '@workbench/core'
import { bindingSchema, snapshotSchema, resourceSchema, catalog, type ResourceRef } from './contracts/index.ts'
import { resourceKey, sameResource } from './domain/selectors.ts'
/** Shared workspace boundary for all model-initiated operations; no current-focus fallback. */
export function createHerdrToolBridge(runtime: WorkbenchRuntime) {
  async function bound(conversationId: string, principal: Principal) {
    if(principal.conversationId&&principal.conversationId!==conversationId)throw new WorkbenchError('FORBIDDEN')
    const binding = await runtime.invoke({operation:'herdr.binding.get',requestId:randomUUID(),input:{conversationId}},principal)
    if (!binding.ok) throw new WorkbenchError(binding.error.code)
    const {ref} = bindingSchema.parse(binding.data)
    if (!ref) throw new WorkbenchError('FORBIDDEN')
    const state = await runtime.invoke({operation:'herdr.snapshot',requestId:randomUUID(),input:{}},principal)
    if (!state.ok) throw new WorkbenchError(state.error.code)
    const snapshot = snapshotSchema.parse(state.data)
    if (snapshot.stale) throw new WorkbenchError('STALE_SNAPSHOT')
    const workspace = snapshot.workspaces.find(w=>sameResource(w.ref,ref))
    if (!workspace) throw new WorkbenchError('RESOURCE_CHANGED')
    const tabs=snapshot.tabs.filter(t=>t.workspaceId===ref.id),panes=snapshot.panes.filter(p=>p.workspaceId===ref.id)
    return {workspace,tabs,panes,sampledAt:snapshot.sampledAt}
  }
  async function snapshotOf(principal: Principal) {
    const state = await runtime.invoke({operation:'herdr.snapshot',requestId:randomUUID(),input:{}},principal)
    if (!state.ok) throw new WorkbenchError(state.error.code)
    return snapshotSchema.parse(state.data)
  }
  async function remember(conversationId: string, principal: Principal, operation: string, entries: ReadonlyArray<{ref:ResourceRef;role:'workspace'|'tab'|'terminal'|'agent';agentKind?:string;label?:string;lastSeen?:{status:'running'|'exited'|'closed'|'missing';at:number}}>, parentConversationId?: string) {
    if (!principal.conversationId || !entries.length) return
    const recorded = await runtime.invoke({operation:'herdr.session.record',requestId:randomUUID(),input:{conversationId,...parentConversationId?{parentConversationId}:{},entries:entries.map(entry=>({ref:entry.ref,role:entry.role,origin:'tool' as const,operation,requestId:randomUUID(),...entry.agentKind?{agentKind:entry.agentKind}:{},...entry.label?{label:entry.label}:{},...entry.lastSeen?{lastSeen:entry.lastSeen}:{}}))}},principal)
    if (!recorded.ok) throw new WorkbenchError(recorded.error.code==='QUOTA_EXCEEDED'||recorded.error.code==='FORBIDDEN'?recorded.error.code:'OPERATION_OUTCOME_UNKNOWN')
  }
  return {
    async inspect(conversationId: string, principal: Principal): Promise<Json> { return await bound(conversationId,principal) as Json },
    async action(conversationId: string, operation: string, input: Json, principal: Principal, requestId: string, parentConversationId?: string): Promise<Json> {
      if(principal.conversationId&&principal.conversationId!==conversationId)throw new WorkbenchError('FORBIDDEN')
      if(operation==='herdr.workspace.create'){
        const parsed=catalog['herdr.workspace.create'].input.parse(input)
        const result=await runtime.invoke({operation:'herdr.conversation.create',requestId,input:{...parsed,conversationId,confirmed:true}},principal)
        if(!result.ok)throw new WorkbenchError(result.error.code)
        const created=bindingSchema.parse(result.data)
        if(created.ref){
          const snapshot=await snapshotOf(principal)
          const panes=snapshot.panes.filter(pane=>pane.workspaceId===created.ref!.id)
          const tabs=snapshot.tabs.filter(tab=>tab.workspaceId===created.ref!.id)
          await remember(conversationId,principal,operation,[
            {ref:created.ref,role:'workspace',label:parsed.label},
            ...tabs.map(tab=>({ref:tab.ref,role:'tab' as const,label:tab.label})),
            ...panes.map(pane=>({ref:pane.ref,role:pane.agent?'agent' as const:'terminal' as const,...pane.agent?{agentKind:pane.agent}:{},label:pane.label})),
          ],parentConversationId)
        }
        return result.data as Json
      }
      if (!['herdr.resource.rename','herdr.resource.close','herdr.pane.split','herdr.tab.create','herdr.agent.start'].includes(operation)) throw new WorkbenchError('FORBIDDEN')
      const scope = await bound(conversationId,principal)
      if (!input || typeof input !== 'object' || Array.isArray(input) || !('ref' in input)) throw new WorkbenchError('INVALID_REQUEST')
      const ref = resourceSchema.parse(input.ref)
      if (![scope.workspace,...scope.tabs,...scope.panes].some(item=>sameResource(item.ref,ref))) throw new WorkbenchError('FORBIDDEN')
      // Browser-only confirmation booleans are not used as model approval. DSH has already asked the person.
      const result = await runtime.invoke({operation,requestId,input:{...input,...operation==='herdr.resource.close'||operation==='herdr.agent.start'?{confirmed:true}:{}}},principal)
      if (!result.ok) throw new WorkbenchError(result.error.code)
      const after=await snapshotOf(principal)
      const beforeKeys=new Set([scope.workspace,...scope.tabs,...scope.panes].map(item=>resourceKey(item.ref)))
      const seen=new Set([...after.workspaces,...after.tabs,...after.panes].map(item=>resourceKey(item.ref)))
      const removed=[scope.workspace,...scope.tabs,...scope.panes].filter(item=>!seen.has(resourceKey(item.ref)))
      const added=[...after.tabs.filter(item=>item.workspaceId===scope.workspace.ref.id&&!beforeKeys.has(resourceKey(item.ref))).map(item=>({ref:item.ref,role:'tab' as const,label:item.label})),...after.panes.filter(item=>item.workspaceId===scope.workspace.ref.id&&!beforeKeys.has(resourceKey(item.ref))).map(item=>({ref:item.ref,role:item.agent?'agent' as const:'terminal' as const,...item.agent?{agentKind:item.agent}:{},label:item.label}))]
      const roleOf=(kind:ResourceRef['kind'])=>kind==='workspace'?'workspace' as const:kind==='tab'?'tab' as const:'terminal' as const
      await remember(conversationId,principal,operation,[
        ...added,
        ...removed.map(item=>({ref:item.ref,role:roleOf(item.ref.kind),label:item.label,lastSeen:{status:'closed' as const,at:Date.now()}})),
        ...operation==='herdr.agent.start'?[{ref,role:'agent' as const,agentKind:catalog['herdr.agent.start'].output.parse(result.data).kind,label:scope.panes.find(pane=>sameResource(pane.ref,ref))?.label??ref.id}]:[],
      ],parentConversationId)
      return result.data as Json
    },
  }
}

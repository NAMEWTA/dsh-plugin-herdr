import { randomUUID } from 'node:crypto'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import type { WorkbenchRuntime } from '@workbench/core'
import { bindingSchema, snapshotSchema, resourceSchema, catalog } from './contracts/index.ts'
import { sameResource } from './domain/selectors.ts'
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
    return {workspace,tabs:snapshot.tabs.filter(t=>t.workspaceId===ref.id),panes:snapshot.panes.filter(p=>p.workspaceId===ref.id),sampledAt:snapshot.sampledAt}
  }
  return {
    async inspect(conversationId: string, principal: Principal): Promise<Json> { return await bound(conversationId,principal) as Json },
    async action(conversationId: string, operation: string, input: Json, principal: Principal, requestId: string): Promise<Json> {
      if(principal.conversationId&&principal.conversationId!==conversationId)throw new WorkbenchError('FORBIDDEN')
      if(operation==='herdr.workspace.create'){
        const parsed=catalog['herdr.workspace.create'].input.parse(input)
        const result=await runtime.invoke({operation:'herdr.conversation.create',requestId,input:{...parsed,conversationId,confirmed:true}},principal)
        if(!result.ok)throw new WorkbenchError(result.error.code)
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
      return result.data as Json
    },
  }
}

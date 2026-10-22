import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import type { WorkbenchRuntime } from '@workbench/core'
import { z } from 'zod'
/** Domain policy is injected by the composition root; this adapter has no Herdr imports. */
export interface ToolBridge {
  inspect(conversationId: string, principal: Principal): Promise<Json>
  action(conversationId: string, operation: string, input: Json, principal: Principal, requestId: string): Promise<Json>
}
const actionArgs = z.object({operation:z.string().max(128),input:z.json()}).strict()
export function registerTools(ctx: Context, bridge: ToolBridge, capabilities: readonly string[]): void {
  const principal = (exec: ToolExecution): Principal => {
    if (!exec.agent?.id || exec.signal.aborted) throw new WorkbenchError('AUTH_REQUIRED')
    return {id:'dsh-agent:'+exec.agent.id,clientId:'tool:'+exec.callId,signal:exec.signal,capabilities:new Set(capabilities),connectionIds:new Set(['local']),conversationId:exec.agent.id}
  }
  const name = 'workbench_herdr_action'
  // Mandatory human approval is outside model-controlled JSON. Other policies may still deny.
  ctx.on('tools/pre-execute', async (execution,next) => {
    const decision = await next()
    if (execution.name !== name || decision.kind !== 'allow') return decision
    return {kind:'ask',reason:'Workbench creates and binds a new workspace or changes a live resource in the explicitly bound workspace.',displayReason:{en:'Approve this Herdr workspace action?',zh:'是否批准为当前对话创建绑定工作区，或修改已绑定的 Herdr 资源？'}}
  })
  ctx.tools.register(defineTool({name:'workbench_herdr_inspect',description:'Read the explicitly bound Herdr workspace. Fails closed when unbound or replaced; never uses the focused workspace.',parameters:{},output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(_args,exec){const p=principal(exec);return bridge.inspect(p.conversationId!,p)}}))
  ctx.tools.register(defineTool({name,description:'Perform a validated resource action in the explicitly bound workspace after human approval. To start an unbound conversation, use herdr.workspace.create with {label,cwd}; it creates and binds a new workspace, never replaces an existing binding. Other supported operations: herdr.resource.rename, herdr.resource.close, herdr.pane.split, herdr.tab.create, herdr.agent.start. Resource refs must come from inspect. No raw terminal input or implicit adoption.',parameters:{operation:{type:'string',required:true},input:{type:'json',required:true}},output:{schema:{type:'json'},render:(_args,value)=>[{type:'text',text:JSON.stringify(value)}]},async execute(args,exec){const p=principal(exec),input=actionArgs.parse(args);return bridge.action(p.conversationId!,input.operation,input.input,p,randomUUID())}}))
}

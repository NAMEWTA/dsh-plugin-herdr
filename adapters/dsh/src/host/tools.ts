import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { ToolExecution } from '@deepseek-ai/dsh-tools'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
import { z } from 'zod'
/** Domain policy is injected by the composition root; this adapter has no Herdr imports. */
export interface ToolBridge {
  inspect(conversationId: string, principal: Principal, projectPath?: string): Promise<Json>
  action(conversationId: string, operation: string, input: Json, principal: Principal, requestId: string, parentConversationId?: string, projectPath?: string): Promise<Json>
  launch(conversationId: string, principal: Principal, input: Json, requestId: string, projectPath?: string, parentConversationId?: string): Promise<Json>
}
const actionArgs = z.object({operation:z.string().max(128),input:z.json()}).strict()
export const launchArgumentExample = '{"agents":[{"kind":"codex","count":4},{"kind":"claude","count":4}],"send":false}'
const launchDescription = [
  'Start Codex and Claude Code in this session\'s Herdr workspace and do not send them any prompt, text, or keys.',
  'On the first call, if nothing is bound yet, the session project directory is created or reused and bound automatically.',
  'kind: "codex" runs the codex command. "claude" and "claude-code" both run the claude command.',
  'count is an integer from 1 to 8. The total count across groups is at most 8. One call can start several groups.',
  'send must be false or omitted. There is no prompt, text, message, keys, or content field.',
  `Example: ${launchArgumentExample}`,
  'The result lists each started agent\'s name, paneId, terminalId, tabId, and workspaceId.',
].join(' ')
/** Parameter schema shown to the model. The root stays open, so execute rejects unexpected keys. */
export const launchParameters = {
  agents: {
    type: 'array',
    required: true,
    description: `Groups to start. Each item is one kind and a count. Total count must be from 1 to 8. Example: ${launchArgumentExample}`,
    items: {
      type: 'object',
      additionalProperties: false,
      description: 'One agent kind and how many shells to start for it.',
      properties: {
        kind: {
          type: 'string',
          required: true,
          enum: ['codex', 'claude', 'claude-code'],
          description: 'codex runs codex. claude and claude-code both run claude. Do not pass a shell string.',
        },
        count: {
          type: 'integer',
          required: true,
          enum: [1, 2, 3, 4, 5, 6, 7, 8],
          description: 'How many of this kind to start. An integer from 1 to 8.',
        },
      },
    },
  },
  send: {
    type: 'boolean',
    const: false,
    description: 'Must be false or omitted. This tool never sends a prompt or keystrokes.',
  },
} as const
const inspectDescription = 'Read the Herdr workspace for this session. The first call binds the session project directory automatically when nothing is bound yet. INVALID_REQUEST when the session has no project path. Never uses the focused workspace. Another conversation is forbidden.'
const actionDescription = 'Change the workspace already bound to this session after human approval. Supported operations: herdr.resource.rename, herdr.resource.close, herdr.pane.split, herdr.tab.create. Do not use this tool to start agents; call workbench_herdr_launch. herdr.workspace.create without a project path still creates and binds once, and never replaces an existing binding. Resource refs must come from workbench_herdr_inspect. No raw terminal input and no implicit adoption.'
function sessionProjectPath(exec: ToolExecution): string | undefined {
  const cwd = (exec.agent as {session?: {header?: {cwd?: unknown}}} | undefined)?.session?.header?.cwd
  return typeof cwd === 'string' && cwd.length > 0 ? cwd : undefined
}
export function registerTools(ctx: Context, bridge: ToolBridge, capabilities: readonly string[]): void {
  const principal = (exec: ToolExecution): Principal => {
    if (!exec.agent?.id || exec.signal.aborted) throw new WorkbenchError('AUTH_REQUIRED')
    return {id:'dsh-agent:'+exec.agent.id,clientId:'tool:'+exec.callId,signal:exec.signal,capabilities:new Set(capabilities),connectionIds:new Set(['local']),conversationId:exec.agent.id}
  }
  const parentConversationId = (exec: ToolExecution): string | undefined => {
    const agent = exec.agent as {id?: string; parentId?: unknown; parentSessionId?: unknown} | undefined
    const parent = [agent?.parentId, agent?.parentSessionId].find(value => typeof value === 'string' && value.length > 0 && value !== agent?.id)
    return typeof parent === 'string' ? parent : undefined
  }
  const prompts = new Map<string, {reason: string; displayReason: {en: string; zh: string}}>([
    ['workbench_herdr_action', {reason:'Workbench changes a live resource in the workspace bound to this session.', displayReason:{en:'Approve this Herdr workspace action?', zh:'是否批准修改当前会话已绑定的 Herdr 资源？'}}],
    ['workbench_herdr_launch', {reason:'Workbench starts approved agents in the workspace bound to this session and does not send them any content.', displayReason:{en:'Approve starting these agents in this session\'s workspace? Nothing will be sent to them.', zh:'是否批准在当前会话的工作区里启动这些 Agent？本次不会向它们发送内容。'}}],
  ])
  // Mandatory human approval is outside model-controlled JSON. Other policies may still deny.
  ctx.on('tools/pre-execute', async (execution, next) => {
    const decision = await next()
    const prompt = prompts.get(execution.name)
    if (!prompt || decision.kind !== 'allow') return decision
    return {kind:'ask', reason:prompt.reason, displayReason:prompt.displayReason}
  })
  ctx.tools.register(defineTool({
    name:'workbench_herdr_inspect',
    description:inspectDescription,
    parameters:{},
    output:{schema:{type:'json'}, render:(_args, value)=>[{type:'text', text:JSON.stringify(value)}]},
    async execute(_args, exec) {
      const actor = principal(exec)
      return bridge.inspect(actor.conversationId!, actor, sessionProjectPath(exec))
    },
  }))
  ctx.tools.register(defineTool({
    name:'workbench_herdr_launch',
    description:launchDescription,
    parameters:launchParameters,
    timeoutMs:180000,
    output:{schema:{type:'json'}, render:(_args, value)=>[{type:'text', text:JSON.stringify(value)}]},
    async execute(args, exec) {
      const actor = principal(exec)
      const raw = args as Record<string, unknown>
      for (const key of ['prompt', 'text', 'message', 'keys', 'content', 'input']) {
        if (key in raw) throw new WorkbenchError('INVALID_REQUEST', `field ${key} is not accepted. This tool starts agents and does not send them any content. Omit ${key}. Example: ${launchArgumentExample}`)
      }
      const total = args.agents.reduce((sum, group) => sum + group.count, 0)
      if (total < 1 || total > 8) throw new WorkbenchError('INVALID_REQUEST', `field agents total count is ${total}; expected an integer from 1 to 8. Example: ${launchArgumentExample}`)
      return bridge.launch(actor.conversationId!, actor, args, randomUUID(), sessionProjectPath(exec), parentConversationId(exec))
    },
  }))
  ctx.tools.register(defineTool({
    name:'workbench_herdr_action',
    description:actionDescription,
    parameters:{operation:{type:'string', required:true}, input:{type:'json', required:true}},
    output:{schema:{type:'json'}, render:(_args, value)=>[{type:'text', text:JSON.stringify(value)}]},
    async execute(args, exec) {
      const actor = principal(exec)
      const input = actionArgs.parse(args)
      return bridge.action(actor.conversationId!, input.operation, input.input, actor, randomUUID(), parentConversationId(exec), sessionProjectPath(exec))
    },
  }))
}

import { randomUUID } from 'node:crypto'
import { WorkbenchError, type Failure, type Json, type Principal } from '@workbench/contracts'
import type { WorkbenchRuntime } from '@workbench/core'
import { bindingSchema, snapshotSchema, resourceSchema, catalog, type ResourceRef } from './contracts/index.ts'
import { LAUNCH_ARGUMENT_EXAMPLE } from './domain/agent-launch.ts'
import { resourceKey, sameResource } from './domain/selectors.ts'

const NO_PROJECT_PATH = 'This session has no project path, so a workspace cannot be bound automatically. Open the session in a project directory, or bind a workspace manually in the Workbench conversation tab. The focused workspace is never used.'
const READ_ONLY = 'Binding a workspace requires herdr.manage. This identity is read-only and cannot create or bind one.'
const CROSS_CONVERSATION = 'This tool can only use the workspace bound to the current conversation. It will not read or change another conversation, and it will not fall back to the focused workspace.'
const OUTSIDE = 'That resource is outside the workspace bound to this conversation. Call workbench_herdr_inspect and use a ref from that result. The focused workspace is not used.'

/** Shared workspace boundary for all model-initiated operations; no current-focus fallback. */
export function createHerdrToolBridge(runtime: WorkbenchRuntime) {
  function raise(error: Pick<Failure, 'code' | 'detail' | 'issues'>): never {
    const issues = error.issues?.map(issue => `${issue.path || '(root)'}: ${issue.message}`).join('; ')
    const detail = [error.detail, issues].filter(Boolean).join(' ')
    throw new WorkbenchError(error.code, detail || error.code)
  }
  function sameConversation(conversationId: string, principal: Principal) {
    if (principal.conversationId && principal.conversationId !== conversationId) throw new WorkbenchError('FORBIDDEN', CROSS_CONVERSATION)
  }
  async function snapshotOf(principal: Principal) {
    const state = await runtime.invoke({operation:'herdr.snapshot',requestId:randomUUID(),input:{}},principal)
    if (!state.ok) raise(state.error)
    return snapshotSchema.parse(state.data)
  }
  async function ensure(conversationId: string, principal: Principal, projectPath: string | undefined) {
    sameConversation(conversationId, principal)
    const binding = await runtime.invoke({operation:'herdr.binding.get',requestId:randomUUID(),input:{conversationId}},principal)
    if (!binding.ok) raise(binding.error)
    const parsed = bindingSchema.parse(binding.data)
    if (parsed.ref) return parsed
    if (!projectPath) throw new WorkbenchError('INVALID_REQUEST', NO_PROJECT_PATH)
    if (!principal.capabilities.has('herdr.manage')) throw new WorkbenchError('FORBIDDEN', READ_ONLY)
    const label = projectPath.split(/[\\/]/).filter(part => part.length > 0 && part !== '.').at(-1)?.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) || 'workspace'
    const ensured = await runtime.invoke({operation:'herdr.conversation.ensure',requestId:randomUUID(),input:{conversationId,cwd:projectPath,label,origin:'tool',confirmed:true}},principal)
    if (!ensured.ok) raise(ensured.error)
    return bindingSchema.parse({conversationId, ref: ensured.data && typeof ensured.data === 'object' && 'ref' in ensured.data ? ensured.data.ref : null, cwd: projectPath})
  }
  async function bound(conversationId: string, principal: Principal, projectPath?: string) {
    await ensure(conversationId, principal, projectPath)
    const binding = await runtime.invoke({operation:'herdr.binding.get',requestId:randomUUID(),input:{conversationId}},principal)
    if (!binding.ok) raise(binding.error)
    const {ref} = bindingSchema.parse(binding.data)
    if (!ref) throw new WorkbenchError('INVALID_REQUEST', NO_PROJECT_PATH)
    const snapshot = await snapshotOf(principal)
    if (snapshot.stale) throw new WorkbenchError('STALE_SNAPSHOT', 'The Herdr snapshot is stale. Retry this call. The focused workspace is not used.')
    const workspace = snapshot.workspaces.find(item => sameResource(item.ref, ref))
    if (!workspace) throw new WorkbenchError('RESOURCE_CHANGED', 'The bound workspace is no longer in the Herdr snapshot. Retry so the session project path can be bound again. The focused workspace is not used.')
    const tabs = snapshot.tabs.filter(item => item.workspaceId === ref.id)
    const panes = snapshot.panes.filter(item => item.workspaceId === ref.id)
    return {workspace, tabs, panes, sampledAt: snapshot.sampledAt}
  }
  async function remember(conversationId: string, principal: Principal, operation: string, entries: ReadonlyArray<{ref:ResourceRef;role:'workspace'|'tab'|'terminal'|'agent';agentKind?:string;label?:string;lastSeen?:{status:'running'|'exited'|'closed'|'missing';at:number}}>, parentConversationId?: string) {
    if (!principal.conversationId || !entries.length) return
    const recorded = await runtime.invoke({operation:'herdr.session.record',requestId:randomUUID(),input:{conversationId,...parentConversationId?{parentConversationId}:{},entries:entries.map(entry=>({ref:entry.ref,role:entry.role,origin:'tool' as const,operation,requestId:randomUUID(),...entry.agentKind?{agentKind:entry.agentKind}:{},...entry.label?{label:entry.label}:{},...entry.lastSeen?{lastSeen:entry.lastSeen}:{}}))}},principal)
    if (!recorded.ok) throw new WorkbenchError(recorded.error.code === 'QUOTA_EXCEEDED' || recorded.error.code === 'FORBIDDEN' ? recorded.error.code : 'OPERATION_OUTCOME_UNKNOWN', recorded.error.detail)
  }
  return {
    async inspect(conversationId: string, principal: Principal, projectPath?: string): Promise<Json> { return await bound(conversationId, principal, projectPath) as Json },
    async launch(conversationId: string, principal: Principal, input: Json, requestId: string, projectPath?: string, parentConversationId?: string): Promise<Json> {
      sameConversation(conversationId, principal)
      if (!principal.capabilities.has('herdr.control')) throw new WorkbenchError('FORBIDDEN', 'Starting agents requires herdr.control. This identity cannot launch them.')
      const body = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, Json> : {}
      for (const key of ['prompt', 'text', 'message', 'keys', 'content', 'input'] as const) {
        if (key in body) throw new WorkbenchError('INVALID_REQUEST', `field ${key} is not accepted. This tool starts agents and does not send them any content. Omit ${key}. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
      }
      if ('send' in body && body.send !== false) throw new WorkbenchError('INVALID_REQUEST', `field send must be false or omitted. This tool never sends a prompt. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
      if (!Array.isArray(body.agents)) throw new WorkbenchError('INVALID_REQUEST', `field agents must be an array of {kind, count} groups. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
      await bound(conversationId, principal, projectPath)
      const launchInput: Json = {conversationId, agents: body.agents, send: false, confirmed: true}
      if (parentConversationId && typeof launchInput === 'object' && launchInput) launchInput.parentConversationId = parentConversationId
      const result = await runtime.invoke({operation:'herdr.agents.launch',requestId,input:launchInput},principal)
      if (!result.ok) raise(result.error)
      return result.data as Json
    },
    async action(conversationId: string, operation: string, input: Json, principal: Principal, requestId: string, parentConversationId?: string, projectPath?: string): Promise<Json> {
      sameConversation(conversationId, principal)
      if (operation === 'herdr.workspace.create') {
        const existing = await runtime.invoke({operation:'herdr.binding.get',requestId:randomUUID(),input:{conversationId}},principal)
        if (!existing.ok) raise(existing.error)
        const already = bindingSchema.parse(existing.data)
        if (!already.ref && projectPath) {
          await ensure(conversationId, principal, projectPath)
          const boundNow = await runtime.invoke({operation:'herdr.binding.get',requestId:randomUUID(),input:{conversationId}},principal)
          if (!boundNow.ok) raise(boundNow.error)
          return boundNow.data as Json
        }
        // The same request id replays the original create. A new id conflicts once a binding exists.
        const parsed = catalog['herdr.workspace.create'].input.parse(input)
        const result = await runtime.invoke({operation:'herdr.conversation.create',requestId,input:{...parsed,conversationId,confirmed:true}},principal)
        if (!result.ok) {
          if (result.error.code === 'MODULE_CONFLICT') throw new WorkbenchError('MODULE_CONFLICT', 'This conversation already has a workspace. The existing binding was kept. The focused workspace is not used.')
          raise(result.error)
        }
        const created = bindingSchema.parse(result.data)
        if (!already.ref && created.ref) {
          const snapshot = await snapshotOf(principal)
          const panes = snapshot.panes.filter(pane => pane.workspaceId === created.ref!.id)
          const tabs = snapshot.tabs.filter(tab => tab.workspaceId === created.ref!.id)
          await remember(conversationId, principal, operation, [
            {ref:created.ref,role:'workspace',label:parsed.label},
            ...tabs.map(tab => ({ref:tab.ref,role:'tab' as const,label:tab.label})),
            ...panes.map(pane => ({ref:pane.ref,role:pane.agent?'agent' as const:'terminal' as const,...pane.agent?{agentKind:pane.agent}:{},label:pane.label})),
          ], parentConversationId)
        }
        return result.data as Json
      }
      if (!['herdr.resource.rename','herdr.resource.close','herdr.pane.split','herdr.tab.create','herdr.agent.start','herdr.workspace.create'].includes(operation)) {
        throw new WorkbenchError('FORBIDDEN', `Operation ${JSON.stringify(operation)} is not available to the model. Start agents with workbench_herdr_launch. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
      }
      const scope = await bound(conversationId, principal, projectPath)
      if (operation === 'herdr.workspace.create') {
        throw new WorkbenchError('MODULE_CONFLICT', 'This conversation already has a workspace. The existing binding was kept. The focused workspace is not used.')
      }
      if (operation === 'herdr.agent.start') explainAgentStart(input)
      if (!input || typeof input !== 'object' || Array.isArray(input) || !('ref' in input)) {
        throw new WorkbenchError('INVALID_REQUEST', `field ref is required. Use a pane, tab, or workspace ref returned by workbench_herdr_inspect. To start agents without sending a prompt, call workbench_herdr_launch. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
      }
      const ref = resourceSchema.safeParse(input.ref)
      if (!ref.success) throw new WorkbenchError('INVALID_REQUEST', 'field ref must be a resource object with connectionId "local", session, epoch, kind (workspace, tab, or pane), id, and instance. Take it from workbench_herdr_inspect.')
      if (![scope.workspace, ...scope.tabs, ...scope.panes].some(item => sameResource(item.ref, ref.data))) throw new WorkbenchError('FORBIDDEN', OUTSIDE)
      // Browser-only confirmation booleans are not used as model approval. DSH has already asked the person.
      const result = await runtime.invoke({operation,requestId,input:{...input,...operation==='herdr.resource.close'||operation==='herdr.agent.start'?{confirmed:true}:{}}},principal)
      if (!result.ok) raise(result.error)
      const after = await snapshotOf(principal)
      const beforeKeys = new Set([scope.workspace, ...scope.tabs, ...scope.panes].map(item => resourceKey(item.ref)))
      const seen = new Set([...after.workspaces, ...after.tabs, ...after.panes].map(item => resourceKey(item.ref)))
      const removed = [scope.workspace, ...scope.tabs, ...scope.panes].filter(item => !seen.has(resourceKey(item.ref)))
      const added = [
        ...after.tabs.filter(item => item.workspaceId === scope.workspace.ref.id && !beforeKeys.has(resourceKey(item.ref))).map(item => ({ref:item.ref,role:'tab' as const,label:item.label})),
        ...after.panes.filter(item => item.workspaceId === scope.workspace.ref.id && !beforeKeys.has(resourceKey(item.ref))).map(item => ({ref:item.ref,role:item.agent?'agent' as const:'terminal' as const,...item.agent?{agentKind:item.agent}:{},label:item.label})),
      ]
      const roleOf = (kind: ResourceRef['kind']) => kind === 'workspace' ? 'workspace' as const : kind === 'tab' ? 'tab' as const : 'terminal' as const
      await remember(conversationId, principal, operation, [
        ...added,
        ...removed.map(item => ({ref:item.ref,role:roleOf(item.ref.kind),label:item.label,lastSeen:{status:'closed' as const,at:Date.now()}})),
        ...operation === 'herdr.agent.start' ? [{ref:ref.data,role:'agent' as const,agentKind:catalog['herdr.agent.start'].output.parse(result.data).kind,label:scope.panes.find(pane => sameResource(pane.ref, ref.data))?.label ?? ref.data.id}] : [],
      ], parentConversationId)
      return result.data as Json
    },
  }
}

function explainAgentStart(input: Json): void {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new WorkbenchError('INVALID_REQUEST', `herdr.agent.start input must be an object with ref and kind. To start several agents without sending a prompt, call workbench_herdr_launch. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
  }
  if (!('ref' in input)) {
    throw new WorkbenchError('INVALID_REQUEST', `field ref is required and must be a pane from workbench_herdr_inspect. To start several agents without sending a prompt, call workbench_herdr_launch. Example: ${LAUNCH_ARGUMENT_EXAMPLE}`)
  }
  if (!('kind' in input) || typeof input.kind !== 'string') {
    throw new WorkbenchError('INVALID_REQUEST', 'field kind must be "codex", "claude", or "claude-code". codex runs the codex command; claude and claude-code both run the claude command.')
  }
}

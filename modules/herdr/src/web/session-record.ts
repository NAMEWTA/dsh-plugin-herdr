import type { WorkbenchClient } from '@workbench/contracts'
import { call } from './api.ts'

/** Record the workspace the session is showing. The first origin is kept. */
export async function rememberWorkspace(client: WorkbenchClient, conversationId: string, workspaceId: string, origin: 'ui' | 'bound', operation?: string) {
  const snapshot = await call(client, 'herdr.snapshot', {})
  const workspace = snapshot.workspaces.find(item => item.ref.id === workspaceId)
  if (!workspace) return
  const tabs = snapshot.tabs.filter(item => item.workspaceId === workspaceId)
  const panes = snapshot.panes.filter(item => item.workspaceId === workspaceId)
  const stamp = () => crypto.randomUUID()
  const workspaceOperation = operation ?? (origin === 'bound' ? 'herdr.binding.set' : 'herdr.workspace.create')
  await call(client, 'herdr.session.record', {conversationId, entries: [
    {ref: workspace.ref, role: 'workspace' as const, origin, operation: workspaceOperation, requestId: stamp(), label: workspace.label},
    ...tabs.map(item => ({ref: item.ref, role: 'tab' as const, origin, operation: operation ?? 'herdr.tab.create', requestId: stamp(), label: item.label})),
    ...panes.map(item => ({ref: item.ref, role: (item.agent ? 'agent' : 'terminal') as 'agent' | 'terminal', origin, operation: operation ?? (item.agent ? 'herdr.agent.start' : 'herdr.pane.split'), requestId: stamp(), ...item.agent ? {agentKind: item.agent} : {}, label: item.label})),
  ].slice(0, 24)})
}

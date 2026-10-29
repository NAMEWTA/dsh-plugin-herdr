import { useEffect, useSyncExternalStore } from 'react'
import { useWorkbench } from '@workbench/ui'
import { useAction, useBinding } from './api.ts'
import { workspaceLabelFromPath } from './session-bridge.ts'
import { rememberWorkspace } from './session-record.ts'

interface EnsureStatus { key: string; pending: boolean; error: unknown; generation: number }
let status: EnsureStatus = {key: '', pending: false, error: null, generation: 0}
let users = 0
const listeners = new Set<() => void>()
function publish(next: EnsureStatus) { status = next; listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
function readStatus() { return status }

/** Shared auto-bind status. Starting the bind is `useEnsureSessionWorkspace`. */
export function useEnsureStatus() {
  const ui = useWorkbench()
  const current = useSyncExternalStore(subscribe, readStatus, readStatus)
  const path = ui.projectPath
  const conversationId = ui.conversationId
  const key = conversationId && path ? conversationId + '\0' + path : ''
  return {
    canManage: ui.capabilities.has('herdr.manage'),
    ensuring: current.key === key && current.pending,
    error: current.key === key ? current.error : null,
    generation: current.key === key ? current.generation : 0,
    retry() {
      if (!key) return
      publish({key, pending: false, error: null, generation: (status.key === key ? status.generation : 0) + 1})
    },
  }
}

/**
 * Bind this session to a workspace at its project path.
 * The server records the ledger. A second mounted copy waits on the same status.
 */
export function useEnsureSessionWorkspace() {
  const ui = useWorkbench()
  const binding = useBinding()
  const ensure = useAction('herdr.conversation.ensure')
  const view = useEnsureStatus()
  const path = ui.projectPath
  const conversationId = ui.conversationId
  const key = conversationId && path ? conversationId + '\0' + path : ''
  const unbound = !binding.isLoading && !binding.error && !binding.data?.ref
  const mutate = ensure.mutate
  useEffect(() => {
    users += 1
    return () => {
      users -= 1
      if (users === 0) status = {key: '', pending: false, error: null, generation: 0}
    }
  }, [])
  useEffect(() => {
    if (!key || !path || !conversationId || !unbound || !view.canManage) return
    if (status.key === key && (status.pending || status.error)) return
    const label = workspaceLabelFromPath(path, 'workspace')
    publish({key, pending: true, error: null, generation: status.key === key ? status.generation : view.generation})
    mutate({conversationId, cwd: path, label, origin: 'ui', confirmed: true}, {
      onSuccess: value => {
        if (users === 0) return
        publish({key, pending: false, error: null, generation: status.generation})
        if (value.created) void rememberWorkspace(ui.client, conversationId, value.ref.id, 'ui', 'herdr.conversation.ensure').catch(() => {})
        else if (value.reused) void rememberWorkspace(ui.client, conversationId, value.ref.id, 'bound', 'herdr.conversation.ensure').catch(() => {})
      },
      onError: error => { if (users !== 0) publish({key, pending: false, error, generation: status.generation}) },
    })
  }, [key, path, conversationId, unbound, view.canManage, view.generation, mutate, ui.client])
  return view
}

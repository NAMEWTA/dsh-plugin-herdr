import { getBoundPaneIds, getBoundWorkspaceIds } from '../binding-registry.ts'

export interface ResourceSnapshot { panes: Array<{ pane_id: string; workspace_id?: string }> }

/** Destructive-operation policy shared by tool and panel adapters. Fail closed. */
export async function assertCanClose(
  kind: 'workspace' | 'pane', id: string,
  snapshot: () => Promise<ResourceSnapshot>,
  boundPanes: readonly string[] = getBoundPaneIds(),
  boundWorkspaces: readonly string[] = getBoundWorkspaceIds(),
): Promise<void> {
  if (!id.trim()) throw new Error('id must be a non-empty string')
  if (kind === 'pane') {
    if (boundPanes.includes(id)) throw new Error('cannot close the pane hosting a session')
    return
  }
  if (boundWorkspaces.includes(id)) throw new Error('cannot close the workspace hosting a session')
  const snap = await snapshot() // Never turn failed verification into permission.
  const protectedPanes = new Set(boundPanes)
  if (snap.panes.some(pane => pane.workspace_id === id && protectedPanes.has(pane.pane_id))) {
    throw new Error('cannot close the workspace hosting a session')
  }
}

/** Profile-local write policy, not a multi-user authentication boundary. */
export async function canWritePane(paneId: string, snapshot: () => Promise<ResourceSnapshot>): Promise<boolean> {
  if (getBoundPaneIds().includes(paneId)) return true
  const workspaces = new Set(getBoundWorkspaceIds())
  if (workspaces.size === 0) return false
  try {
    const pane = (await snapshot()).panes.find(pane => pane.pane_id === paneId)
    return !!pane?.workspace_id && workspaces.has(pane.workspace_id)
  } catch { return false }
}

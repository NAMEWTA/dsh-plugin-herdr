/** Same-realm handoff from the session header to the DSH right-sidebar tab. */
let opener: (() => void) | undefined
const pageOpeners = new Map<string, () => void>()
let globalPageOpener: (() => void) | undefined

export function bindSessionRailOpener(open: () => void): () => void {
  opener = open
  return () => { if (opener === open) opener = undefined }
}
export function openSessionRail(): void { opener?.() }

/** In-conversation Workbench view, when the host actually passed a view setter. */
export function bindSessionWorkbenchOpener(conversationId: string, open: () => void): () => void {
  pageOpeners.set(conversationId, open)
  return () => { if (pageOpeners.get(conversationId) === open) pageOpeners.delete(conversationId) }
}

/** Global main panel. Used when the rail cannot see the conversation view setter. */
export function bindGlobalWorkbenchOpener(open: () => void): () => void {
  globalPageOpener = open
  return () => { if (globalPageOpener === open) globalPageOpener = undefined }
}

/** Open the Workbench page. False means the caller should navigate inside this shell. */
export function requestWorkbenchPage(conversationId?: string): boolean {
  const open = (conversationId ? pageOpeners.get(conversationId) : undefined) ?? globalPageOpener
  if (!open) return false
  try { open() } catch { return false }
  return true
}

/** Display name for a workspace created from a session project path. */
export function workspaceLabelFromPath(path: string, fallback: string): string {
  const base = path.split(/[\\/]/).filter(part => part.length > 0 && part !== '.').at(-1) ?? ''
  const cleaned = base.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120)
  return cleaned || fallback
}

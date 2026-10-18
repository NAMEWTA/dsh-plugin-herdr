/** Herdr topology invalidations used by both the tracker and Remote stream. */
export const TOPOLOGY_EVENTS: ReadonlySet<string> = new Set([
  'workspace_created', 'workspace_updated', 'workspace_metadata_updated', 'workspace_renamed',
  'workspace_moved', 'workspace_reordered', 'workspace_closed', 'workspace_focused',
  'tab_created', 'tab_closed', 'tab_renamed', 'tab_moved', 'tab_focused',
  'pane_created', 'pane_closed', 'pane_updated', 'pane_focused', 'pane_moved', 'pane_exited', 'layout_updated',
])

/** Same-realm handoff from the session header to the DSH right-sidebar tab. */
let opener: (() => void) | undefined
export function bindSessionRailOpener(open: () => void): () => void {
  opener = open
  return () => { if (opener === open) opener = undefined }
}
export function openSessionRail(): void { opener?.() }

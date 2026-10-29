/** The client sheet is one tag. DSH claims it by data-plugin; a shadow root needs its own copy because document styles do not cross that boundary. */
export const WORKBENCH_STYLE_ID = 'namewta-workbench-styles'
const PLUGIN_ID = '@namewta/dsh-workbench'
const owned = new Set<HTMLStyleElement>()
let installer: ((node?: Node | null) => void) | undefined

function ensureStyle(parent: ParentNode, css: string): void {
  const current = parent.querySelector<HTMLStyleElement>(`style#${WORKBENCH_STYLE_ID}`)
  if (current) {
    if (current.textContent !== css) current.textContent = css
    owned.add(current)
    return
  }
  const style = document.createElement('style')
  style.id = WORKBENCH_STYLE_ID
  style.textContent = css
  style.setAttribute('data-plugin', PLUGIN_ID)
  style.setAttribute('data-plugin-css', `${PLUGIN_ID}/workbench.css`)
  parent.appendChild(style)
  owned.add(style)
}

/** Put the sheet in document.head and, when the mount is inside a shadow root, in that root too. */
export function installWorkbenchStyles(css: string, node?: Node | null): void {
  if (typeof document === 'undefined') return
  ensureStyle(document.head, css)
  const root = node?.getRootNode?.()
  if (typeof ShadowRoot !== 'undefined' && root instanceof ShadowRoot) ensureStyle(root, css)
}

export function bindWorkbenchStyles(install: (node?: Node | null) => void): () => void {
  installer = install
  return () => { if (installer === install) installer = undefined }
}

export function mountWorkbenchStyles(node?: Node | null): void {
  installer?.(node)
}

export function releaseWorkbenchStyles(): void {
  for (const style of owned) style.remove()
  owned.clear()
}

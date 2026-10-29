import { bindWorkbenchPageBridge, mountWorkbench, type WebContext } from '@workbench/dsh/web'
import { bindGlobalWorkbenchOpener, bindSessionRailOpener, bindSessionWorkbenchOpener, herdrWeb, configureTerminalLoader } from '@workbench/herdr/web'
import { bindWorkbenchStyles, installWorkbenchStyles, releaseWorkbenchStyles } from '@workbench/ui'
import styles from './styles.generated.ts'
// The sheet has to exist while the factory runs so DSH can claim it, and again on each
// mount: document.head does not paint a shadow root, and the right pane collapses to
// unstyled text when this sheet is missing.
const install = (node?: Node | null) => installWorkbenchStyles(styles, node)
bindWorkbenchStyles(install)
install()
/** sidebarRight comes from @deepseek-ai/dsh-client-ui-sidebar-right; layout from @deepseek-ai/dsh-client-ui-layout. */
export const inject = ['slots','locale','remote','sessions','sidebarRight','sidebarRightTabs','layout']
export async function apply(ctx: WebContext) {
  // Inline this deferred module into the public DSH client artifact. No private root URL,
  // extra proxy route, CDN request, blob evaluation or weakened CSP is required.
  const reset=configureTerminalLoader(()=>import('./terminal-driver.ts'))
  ctx.effect(()=>reset)
  ctx.effect(() => bindWorkbenchPageBridge((conversationId, open) => bindSessionWorkbenchOpener(conversationId, open)))
  if (ctx.layout) ctx.effect(() => bindGlobalWorkbenchOpener(() => { ctx.layout?.selectPanel('workbench') }))
  if (ctx.sidebarRight) ctx.effect(() => bindSessionRailOpener(() => ctx.sidebarRight?.openTab('herdr')))
  ctx.effect(() => releaseWorkbenchStyles)
  await mountWorkbench(ctx,[herdrWeb])
}

import { mountWorkbench, type WebContext } from '@workbench/dsh/web'
import { bindSessionRailOpener, herdrWeb, configureTerminalLoader } from '@workbench/herdr/web'
import styles from './styles.generated.ts'
// Synchronous injection is claimed and disposed by DSH's documented module loader.
if (typeof document !== 'undefined' && !document.getElementById('namewta-workbench-styles')) {
  const style = document.createElement('style'); style.id = 'namewta-workbench-styles'; style.textContent = styles; document.head.appendChild(style)
}
/** sidebarRight is provided by @deepseek-ai/dsh-client-ui-sidebar-right, declared in package.json dsh.client.inject. */
export const inject = ['slots','locale','remote','sessions','sidebarRight','sidebarRightTabs']
export async function apply(ctx: WebContext) {
  // Inline this deferred module into the public DSH client artifact. No private root URL,
  // extra proxy route, CDN request, blob evaluation or weakened CSP is required.
  const reset=configureTerminalLoader(()=>import('./terminal-driver.ts'))
  ctx.effect(()=>reset)
  if (ctx.sidebarRight) ctx.effect(() => bindSessionRailOpener(() => ctx.sidebarRight?.openTab('herdr')))
  await mountWorkbench(ctx,[herdrWeb])
}

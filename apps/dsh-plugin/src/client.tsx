import { mountWorkbench, type WebContext } from '@workbench/dsh/web'
import { herdrWeb, configureTerminalLoader } from '@workbench/herdr/web'
import { BUILD } from './build.ts'
import styles from './styles.generated.ts'
// Synchronous injection is claimed and disposed by DSH's documented module loader.
if (typeof document !== 'undefined' && !document.getElementById('namewta-workbench-styles')) {
  const style = document.createElement('style'); style.id = 'namewta-workbench-styles'; style.textContent = styles; document.head.appendChild(style)
}
export const inject = ['slots','locale','remote','sessions']
export async function apply(ctx: WebContext) {
  const reset=configureTerminalLoader(()=>import(/* @vite-ignore */ new URL('/_workbench/assets/'+BUILD.sha+'/terminal.js',window.location.origin).href))
  ctx.effect(()=>reset)
  await mountWorkbench(ctx,[herdrWeb])
}

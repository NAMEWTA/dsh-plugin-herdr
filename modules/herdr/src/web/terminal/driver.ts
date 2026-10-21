import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
export interface TerminalDriver { Terminal:typeof Terminal; FitAddon:typeof FitAddon }
export type TerminalLoader = () => Promise<TerminalDriver>
let loader:TerminalLoader=async()=>{throw new Error('Terminal driver is not configured by the application')}
/** The composition root owns asset delivery; the Herdr module owns no host URL. */
export function configureTerminalLoader(next:TerminalLoader):()=>void {
  const previous=loader;loader=next
  return ()=>{if(loader===next)loader=previous}
}
export function loadTerminal():Promise<TerminalDriver>{return loader()}

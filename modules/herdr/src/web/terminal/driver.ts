import type { Terminal } from '@xterm/xterm'
import type { FitAddon } from '@xterm/addon-fit'
export interface TerminalDriver { Terminal:typeof Terminal; FitAddon:typeof FitAddon }
export type TerminalLoader = () => Promise<TerminalDriver>
export class TerminalRendererError extends Error {
  constructor(readonly code: 'TERMINAL_RENDERER_UNAVAILABLE' | 'TERMINAL_INITIALIZATION_FAILED') {
    super(code); this.name = 'TerminalRendererError'
  }
}
interface Registration { load:TerminalLoader; pending?:Promise<TerminalDriver> }
const registrations:Registration[] = []
/** Disposing an older application must not resurrect its loader when the newer one closes. */
export function configureTerminalLoader(load:TerminalLoader):()=>void {
  const registration:Registration={load};registrations.push(registration)
  return ()=>{const index=registrations.indexOf(registration);if(index>=0)registrations.splice(index,1)}
}
/** Single-flight successful loads; failures remain retryable and never start a terminal lease. */
export async function loadTerminal():Promise<TerminalDriver> {
  const registration=registrations.at(-1)
  if(!registration)throw new TerminalRendererError('TERMINAL_RENDERER_UNAVAILABLE')
  if(!registration.pending){
    registration.pending=Promise.resolve().then(()=>registration.load()).then(driver=>{
      if(!driver||typeof driver.Terminal!=='function'||typeof driver.FitAddon!=='function')throw new Error('invalid terminal exports')
      return driver
    }).catch(()=>{registration.pending=undefined;throw new TerminalRendererError('TERMINAL_RENDERER_UNAVAILABLE')})
  }
  return registration.pending
}

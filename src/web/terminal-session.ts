/** Shell adapter for the framework-independent terminal state machine. */
import { subscribeHerdrEvents, waitForHerdrEvents } from './store.ts'
import { getHerdrRemote } from './remote.ts'
import { t, type I18nKey } from './i18n.ts'
import { BrowserTerminalSessionStore as SessionStore } from './features/terminal/session-store.ts'
import type { TerminalSessionTransport, TerminalSessionStoreOptions } from './features/terminal/session-store.ts'
import { createRemoteTerminalTransport } from './features/terminal/remote-transport.ts'
export type { TerminalSize, BrowserSessionStatus, TerminalStoreSignal, EventsHandle, TerminalSessionTransport, TerminalSessionStoreOptions } from './features/terminal/session-store.ts'
export { bytesToBase64 } from './features/terminal/session-store.ts'

const TERMINAL_ERROR_KEYS: Record<string, I18nKey> = {
  terminal_session_unavailable: 'terminal.unavailable', terminal_session_conflict: 'terminal.conflict',
  terminal_session_not_found: 'terminal.notFound', terminal_session_forbidden: 'terminal.forbidden',
  terminal_session_protocol_error: 'terminal.protocolError', terminal_session_frame_gap: 'terminal.frameGap',
  terminal_session_input_backpressure: 'terminal.backpressure', terminal_session_process_exited: 'terminal.exited',
  terminal_session_timeout: 'terminal.timeout',
}
export function localizeTerminalError(code: string | undefined, message: string | undefined): string {
  const key = code ? TERMINAL_ERROR_KEYS[code] : undefined
  return key ? t(key) : message || t('error.terminalRequestFailed')
}
export class TerminalRequestError extends Error {
  constructor(readonly code: string | undefined, message: string | undefined) {
    super(localizeTerminalError(code, message))
    this.name = 'TerminalRequestError'
  }
}
export class BrowserTerminalSessionStore extends SessionStore {
  constructor(transport: TerminalSessionTransport, opts: TerminalSessionStoreOptions = {}) {
    super(transport, { localizeError: localizeTerminalError, ...opts })
  }
}
export function createRemoteTransport(): TerminalSessionTransport {
  return createRemoteTerminalTransport({
    remote: getHerdrRemote,
    subscribe: listener => subscribeHerdrEvents(listener),
    waitForEvents: waitForHerdrEvents,
    error: (code, message) => new TerminalRequestError(code, message),
  })
}
/** @deprecated Transport is Typert Remote, not HTTP fetch. */
export function createFetchTransport(_base = ''): TerminalSessionTransport { return createRemoteTransport() }
export const terminalSessionStore = new BrowserTerminalSessionStore(createRemoteTransport())

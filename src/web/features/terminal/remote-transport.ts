/** One shared carrier plus explicit, bounded attach after start and carrier loss. */
import type { BrowserTerminalEvent, BrowserTerminalCommand, TerminalSessionStartRequest, TerminalAttachRequest } from '../../../contracts/terminal.ts'
import type { TerminalSessionTransport } from './session-store.ts'
export interface TerminalRemote {
  terminalStart(request: TerminalSessionStartRequest): Promise<unknown>
  terminalAttach(request: TerminalAttachRequest): Promise<unknown>
  terminalCommand(request: { session_id: string; command: BrowserTerminalCommand }): Promise<unknown>
  terminalRelease(request: { session_id: string }): Promise<unknown>
}
interface TermEnvelope { type: string; session_id?: string; event?: unknown }
export interface RemoteTransportOptions {
  remote: () => TerminalRemote
  subscribe: (listener: (event: TermEnvelope) => void) => () => void
  waitForEvents?: () => Promise<void>
  error: (code: string | undefined, message: string | undefined) => Error
}
function object(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('invalid terminal response')
  return value as Record<string, unknown>
}
export function createRemoteTerminalTransport(options: RemoteTransportOptions): TerminalSessionTransport {
  const call = async (operation: () => Promise<unknown>) => {
    const response = object(await operation())
    if (response.ok !== true) throw options.error(typeof response.code === 'string' ? response.code : undefined, typeof response.error === 'string' ? response.error : undefined)
    return response
  }
  const deadline = async (operation: Promise<unknown>) => {
    let timer: ReturnType<typeof setTimeout> | undefined
    try { return await Promise.race([operation, new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => reject(options.error('terminal_session_timeout', 'request receipt timed out; submission may have taken effect')), 15000)
      timer.unref?.()
    })]) } finally { if (timer) clearTimeout(timer) }
  }
  return {
    async start(request) {
      const result = await call(() => options.remote().terminalStart(request))
      if (typeof result.session_id !== 'string' || !result.session_id || !Number.isSafeInteger(result.generation) || Number(result.generation) < 1) throw new Error('invalid terminal start result')
      return { sessionId: result.session_id, generation: Number(result.generation) }
    },
    async openEvents(sessionId, _generation, _afterSeq, cb) {
      let active = true
      let attaching = true
      let disconnected = false
      let revision = 0
      let repair: Promise<void> | undefined
      let bytes = 0
      const pending: BrowserTerminalEvent[] = []
      const lifetime = new AbortController()
      let off: () => void = () => {}
      const close = () => { if (!active) return; active = false; ++revision; lifetime.abort(); pending.length = 0; off() }
      const bounded = async <T>(promise: Promise<T>): Promise<T> => {
        let timer: ReturnType<typeof setTimeout> | undefined
        let abort = () => {}
        try {
          return await Promise.race([promise, new Promise<never>((_resolve, reject) => {
            abort = () => reject(new Error('terminal attach cancelled'))
            lifetime.signal.addEventListener('abort', abort, { once: true })
            if (lifetime.signal.aborted) abort()
            timer = setTimeout(() => reject(options.error('terminal_session_timeout', 'terminal attach timed out')), 15000)
            timer.unref?.()
          })])
        } finally { if (timer) clearTimeout(timer); lifetime.signal.removeEventListener('abort', abort) }
      }
      const attach = (): Promise<void> => {
        if (repair) return repair
        attaching = true
        const current = ++revision
        const work = (async () => {
          await bounded(options.waitForEvents?.() ?? Promise.resolve())
          if (!active || revision !== current) return
          const result = await bounded(call(() => options.remote().terminalAttach({ session_id: sessionId })))
          if (!active || revision !== current) return
          if (!Array.isArray(result.events)) throw new Error('invalid terminal attach result')
          let generation = 0
          let lastSeq = -1
          const deliver = (event: BrowserTerminalEvent) => {
            if (event.generation !== undefined && event.generation < generation) return
            if (event.type === 'ready') {
              if (event.generation <= generation) return
              generation = event.generation
              lastSeq = event.afterSeq
            }
            if (event.type === 'frame') {
              if (event.generation === generation && event.seq <= lastSeq) return
              lastSeq = event.seq
            }
            cb(event)
          }
          for (const event of result.events as BrowserTerminalEvent[]) deliver(event)
          for (const event of pending.splice(0)) deliver(event)
          bytes = 0
          attaching = false
        })().finally(() => { if (repair === work) repair = undefined })
        repair = work
        return work
      }
      const failed = (error: unknown) => {
        if (!active) return
        cb({ type: 'error', sessionId, code: (error as { code?: string } | null)?.code ?? 'terminal_session_protocol_error', message: error instanceof Error ? error.message : String(error), retryable: false })
        close()
      }
      // Subscribe before awaiting either carrier readiness or an attach receipt.
      off = options.subscribe(envelope => {
        if (!active) return
        if (envelope.type === 'transport-disconnected') {
          disconnected = true
          if (!attaching) {
            attaching = true
            cb({ type: 'error', sessionId, code: 'terminal_session_frame_gap', message: 'Terminal stream reconnecting', retryable: true })
          }
          return
        }
        if (envelope.type === 'topology' && disconnected) {
          disconnected = false
          void attach().catch(failed) // detects sessions reaped during the outage
        }
        if (envelope.type !== 'term' || envelope.session_id !== sessionId) return
        const event = envelope.event as BrowserTerminalEvent
        if (!attaching) { cb(event); return }
        bytes += new TextEncoder().encode(JSON.stringify(event)).byteLength
        if (pending.length >= 256 || bytes > 64 * 1024 * 1024) {
          failed(options.error('terminal_session_input_backpressure', 'terminal attach buffer exceeded limit'))
          return
        }
        pending.push(event)
      })
      try { await attach(); return { close } }
      catch (error) { close(); throw error }
    },
    async sendCommand(sessionId, command) { await deadline(call(() => options.remote().terminalCommand({ session_id: sessionId, command }))) },
    async release(sessionId) { await deadline(call(() => options.remote().terminalRelease({ session_id: sessionId }))) },
  }
}

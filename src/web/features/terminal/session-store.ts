/** Framework-independent terminal ownership and frame state machine. */
import type { BrowserTerminalCommand, BrowserTerminalEvent, TerminalSessionStartRequest } from '../../../contracts/terminal.ts'
import { MAX_INPUT_BYTES } from '../../../contracts/terminal.ts'
import { InputQueue } from './input-queue.ts'

export interface TerminalSize { cols: number; rows: number }
export type BrowserSessionStatus = 'starting' | 'controlling' | 'conflict' | 'error' | 'closed'
export type TerminalStoreSignal =
  | { type: 'status'; status: BrowserSessionStatus; message?: string }
  | { type: 'frame'; sessionId?: string; generation: number; seq: number; full: boolean; width: number; height: number; bytes: string }
export interface EventsHandle { close(): void }
export interface TerminalSessionTransport {
  start(req: TerminalSessionStartRequest): Promise<{ sessionId: string; generation: number }>
  openEvents(sessionId: string, generation: number, afterSeq: number, cb: (event: BrowserTerminalEvent) => void): Promise<EventsHandle>
  sendCommand(sessionId: string, command: BrowserTerminalCommand): Promise<void>
  release(sessionId: string): Promise<void>
}
interface PaneSession {
  paneId: string
  status: BrowserSessionStatus
  message?: string
  sessionId?: string
  generation: number
  cursorSeq: number
  receivedSeq: number
  hasBaseline: boolean
  readySeen: boolean
  refcount: number
  epoch: number
  commandAbort: AbortController
  handle?: EventsHandle
  graceTimer?: ReturnType<typeof setTimeout>
  readyTimer?: ReturnType<typeof setTimeout>
}
export interface TerminalSessionStoreOptions {
  graceMs?: number
  readyTimeoutMs?: number
  now?: () => number
  localizeError?: (code: string | undefined, message: string | undefined) => string
}
type Listener = (signal: TerminalStoreSignal) => void

export class BrowserTerminalSessionStore {
  private readonly panes = new Map<string, PaneSession>()
  private readonly listeners = new Map<string, Set<Listener>>()
  private unavailableUntil = 0
  private readonly commands: InputQueue<BrowserTerminalCommand>
  private readonly graceMs: number
  private readonly now: () => number
  private readonly message: NonNullable<TerminalSessionStoreOptions['localizeError']>

  constructor(private readonly transport: TerminalSessionTransport, private readonly opts: TerminalSessionStoreOptions = {}) {
    this.commands = new InputQueue((sessionId, command) => transport.sendCommand(sessionId, command), command => new TextEncoder().encode(JSON.stringify(command)).byteLength)
    this.graceMs = opts.graceMs ?? 600
    this.now = opts.now ?? Date.now
    this.message = opts.localizeError ?? ((_code, message) => message || 'Terminal request failed')
  }
  getPane(paneId: string): PaneSession | undefined { return this.panes.get(paneId) }
  getRefCount(paneId: string): number { return this.panes.get(paneId)?.refcount ?? 0 }
  subscribe(paneId: string, cb: Listener): () => void {
    const listeners = this.listeners.get(paneId) ?? new Set<Listener>()
    listeners.add(cb)
    this.listeners.set(paneId, listeners)
    return () => {
      listeners.delete(cb)
      if (listeners.size === 0 && this.listeners.get(paneId) === listeners) this.listeners.delete(paneId)
    }
  }

  requestControl(paneId: string, size: TerminalSize, takeover = false): Promise<void> {
    return this.connect(paneId, size, takeover, !takeover)
  }
  async resynchronize(paneId: string, size: TerminalSize): Promise<void> {
    const session = this.panes.get(paneId)
    if (session?.sessionId && (session.status === 'controlling' || session.status === 'starting')) await this.attachScreen(session)
    else await this.connect(paneId, size, false, false)
  }
  private async connect(paneId: string, size: TerminalSize, takeover: boolean, acquire: boolean): Promise<void> {
    const existing = this.panes.get(paneId)
    if (!takeover && existing && (existing.status === 'starting' || existing.status === 'controlling')) {
      if (acquire) existing.refcount++
      this.cancelGrace(existing)
      // A newly mounted xterm has no screen even when its process is retained.
      if (existing.status === 'controlling' && existing.sessionId) await this.attachScreen(existing)
      else this.emit(paneId, { type: 'status', status: existing.status, message: existing.message })
      return
    }
    if (!takeover && existing?.status === 'conflict') {
      if (acquire) existing.refcount++
      this.cancelGrace(existing)
      this.emit(paneId, { type: 'status', status: 'conflict', message: existing.message })
      return
    }
    const cooling = !takeover && this.now() < this.unavailableUntil
    const ps: PaneSession = existing ?? {
      paneId, status: 'starting', generation: 0, cursorSeq: -1, receivedSeq: 0,
      hasBaseline: false, readySeen: false, refcount: 0, epoch: 0, commandAbort: new AbortController(),
    }
    const oldId = ps.sessionId
    ps.commandAbort.abort()
    ps.commandAbort = new AbortController()
    ps.handle?.close()
    ps.handle = undefined
    this.cancelGrace(ps)
    this.clearReadyTimer(ps)
    ps.refcount = acquire ? ps.refcount + 1 : Math.max(1, ps.refcount)
    const epoch = ++ps.epoch
    ps.status = 'starting'
    ps.message = undefined
    ps.sessionId = undefined
    ps.generation = 0
    ps.cursorSeq = -1
    ps.receivedSeq = 0
    ps.hasBaseline = ps.readySeen = false
    this.panes.set(paneId, ps)
    this.emit(paneId, { type: 'status', status: 'starting' })
    try {
      // Replacement is serialized after release; a stale attempt never starts.
      if (oldId) await this.transport.release(oldId)
      if (!this.current(ps, epoch)) return
      if (cooling) { this.fail(ps, 'terminal_session_unavailable', 'Terminal temporarily unavailable; retry after cooldown'); return }
      this.armReadyTimeout(ps, epoch)
      const { sessionId, generation } = await this.transport.start({ pane_id: paneId, mode: 'control', ...size, takeover })
      if (!this.current(ps, epoch)) {
        await this.transport.release(sessionId)
        return
      }
      ps.sessionId = sessionId
      ps.generation = generation
      this.armReadyTimeout(ps, epoch)
      const handle = await this.transport.openEvents(sessionId, generation, 0, event => this.onEvent(ps, epoch, event))
      if (!this.current(ps, epoch)) { handle.close(); return }
      ps.handle = handle
    } catch (error) {
      if (!this.current(ps, epoch)) return
      const code = (error as { code?: string } | null)?.code
      if (code === 'terminal_session_conflict' || code === 'terminal_session_forbidden') {
        this.clearReadyTimer(ps)
        ps.status = 'conflict'
        ps.message = this.message(code, error instanceof Error ? error.message : String(error))
        this.emit(paneId, { type: 'status', status: 'conflict', message: ps.message })
        return
      }
      if (code === 'terminal_session_unavailable' || /unavailable|不可用|上限/i.test(String(error))) this.unavailableUntil = this.now() + 60_000
      this.fail(ps, code, error instanceof Error ? error.message : String(error))
    }
  }

  async release(paneId: string): Promise<void> {
    const ps = this.panes.get(paneId)
    if (!ps) return
    ps.refcount = Math.max(0, ps.refcount - 1)
    if (ps.refcount !== 0) return
    this.cancelGrace(ps)
    if (this.graceMs === 0) { await this.closePane(ps); return }
    ps.graceTimer = setTimeout(() => {
      if (this.panes.get(paneId) === ps && ps.refcount === 0) void this.closePane(ps)
    }, this.graceMs)
  }
  async dispose(): Promise<void> {
    await Promise.all([...this.panes.values()].map(ps => this.closePane(ps)))
    this.listeners.clear()
  }
  confirmFrame(paneId: string, seq: number, generation?: number, sessionId?: string): void {
    const ps = this.panes.get(paneId)
    if (!ps || !ps.hasBaseline || (generation !== undefined && generation !== ps.generation) || (sessionId !== undefined && sessionId !== ps.sessionId)) return
    if (Number.isSafeInteger(seq) && seq > ps.cursorSeq && seq <= ps.receivedSeq) ps.cursorSeq = seq
  }
  cursor(paneId: string): { generation: number; afterSeq: number } {
    const ps = this.panes.get(paneId)
    return { generation: ps?.generation ?? 0, afterSeq: Math.max(0, ps?.cursorSeq ?? 0) }
  }
  sendCommand(paneId: string, command: BrowserTerminalCommand): void {
    const ps = this.panes.get(paneId)
    if (!ps?.sessionId || ps.status !== 'controlling') return
    const epoch = ps.epoch
    void this.commands.enqueue(ps.sessionId, command, ps.commandAbort.signal).then(() => {
      if (this.current(ps, epoch) && ps.message) {
        ps.message = undefined
        this.emit(paneId, { type: 'status', status: ps.status })
      }
    }).catch(error => {
      if (!this.current(ps, epoch)) return
      ps.message = this.message((error as { code?: string } | null)?.code, error instanceof Error ? error.message : String(error))
      this.emit(paneId, { type: 'status', status: ps.status, message: ps.message })
    })
  }
  sendInput(paneId: string, bytes: Uint8Array): void {
    if (bytes.byteLength > MAX_INPUT_BYTES) {
      const ps = this.panes.get(paneId)
      if (ps) this.emit(paneId, { type: 'status', status: ps.status, message: this.message('terminal_session_input_backpressure', 'Input exceeds 64 KiB; nothing was submitted') })
      return
    }
    this.sendCommand(paneId, { type: 'input', bytes: bytesToBase64(bytes) })
  }
  resize(paneId: string, size: TerminalSize): void { this.sendCommand(paneId, { type: 'resize', ...size }) }
  scroll(paneId: string, direction: 'up' | 'down', lines: number): void { this.sendCommand(paneId, { type: 'scroll', direction, lines }) }

  private async attachScreen(ps: PaneSession): Promise<void> {
    const sessionId = ps.sessionId!
    const epoch = ++ps.epoch
    ps.handle?.close()
    ps.handle = undefined
    ps.status = 'starting'
    ps.readySeen = ps.hasBaseline = false
    ps.cursorSeq = -1
    ps.receivedSeq = 0
    this.emit(ps.paneId, { type: 'status', status: 'starting' })
    this.armReadyTimeout(ps, epoch)
    try {
      const handle = await this.transport.openEvents(sessionId, ps.generation, 0, event => this.onEvent(ps, epoch, event))
      if (!this.current(ps, epoch)) handle.close()
      else ps.handle = handle
    } catch (error) {
      if (this.current(ps, epoch)) this.fail(ps, undefined, error instanceof Error ? error.message : String(error))
    }
  }

  private onEvent(ps: PaneSession, epoch: number, event: BrowserTerminalEvent): void {
    if (!this.current(ps, epoch)) return
    if (event.type !== 'frame' && event.sessionId !== ps.sessionId) return
    if (event.generation !== undefined && event.generation < ps.generation) return
    switch (event.type) {
      case 'ready':
        if (event.generation < ps.generation) return
        if (event.resumed && (!ps.hasBaseline || event.generation !== ps.generation)) {
          this.fail(ps, 'terminal_session_frame_gap', 'Cannot resume without a matching baseline')
          return
        }
        ps.generation = event.generation
        ps.readySeen = true
        if (!event.resumed) {
          ps.hasBaseline = false
          ps.cursorSeq = -1
          ps.receivedSeq = event.afterSeq
          ps.status = 'starting'
          this.armReadyTimeout(ps, epoch)
        }
        break
      case 'frame':
        if (event.generation !== ps.generation || !ps.readySeen) return
        if (ps.hasBaseline && event.seq <= ps.receivedSeq) return // replay/live overlap
        if ((!ps.hasBaseline && !event.full) || event.seq !== ps.receivedSeq + 1) {
          this.fail(ps, 'terminal_session_frame_gap', 'Non-contiguous terminal frame; reconnect required')
          return
        }
        ps.hasBaseline = true
        ps.receivedSeq = event.seq
        this.clearReadyTimer(ps)
        if (ps.status !== 'controlling') {
          ps.status = 'controlling'
          ps.message = undefined
          this.emit(ps.paneId, { type: 'status', status: 'controlling' })
        }
        this.emit(ps.paneId, { type: 'frame', sessionId: ps.sessionId, generation: event.generation, seq: event.seq, full: event.full, width: event.width, height: event.height, bytes: event.bytes })
        break
      case 'conflict':
        this.clearReadyTimer(ps)
        ps.status = 'conflict'
        ps.message = this.message('terminal_session_conflict', event.message)
        this.emit(ps.paneId, { type: 'status', status: ps.status, message: ps.message })
        break
      case 'error':
        if (ps.status === 'conflict' && event.code === 'terminal_session_process_exited') return
        if (event.code === 'terminal_session_frame_gap' && event.retryable) {
          ps.status = 'starting'
          ps.readySeen = ps.hasBaseline = false
          this.armReadyTimeout(ps, epoch)
          this.emit(ps.paneId, { type: 'status', status: 'starting' })
        } else if (event.code === 'terminal_session_not_found' || event.code === 'terminal_session_process_exited') {
          this.clearReadyTimer(ps)
          ps.commandAbort.abort()
          ps.status = 'closed'
          this.emit(ps.paneId, { type: 'status', status: 'closed' })
        } else this.fail(ps, event.code, event.message)
        break
      case 'closed':
        if (ps.status === 'conflict') return
        this.clearReadyTimer(ps)
        ps.commandAbort.abort()
        ps.status = 'closed'
        this.emit(ps.paneId, { type: 'status', status: 'closed' })
        break
    }
  }
  private current(ps: PaneSession, epoch: number): boolean { return this.panes.get(ps.paneId) === ps && ps.epoch === epoch }
  private fail(ps: PaneSession, code?: string, message?: string): void {
    this.clearReadyTimer(ps)
    ps.commandAbort.abort()
    ps.status = 'error'
    ps.message = this.message(code, message)
    ps.readySeen = ps.hasBaseline = false
    ++ps.epoch
    ps.handle?.close()
    ps.handle = undefined
    if (ps.sessionId) void this.transport.release(ps.sessionId).catch(() => {})
    this.emit(ps.paneId, { type: 'status', status: 'error', message: ps.message })
  }
  private armReadyTimeout(ps: PaneSession, epoch: number): void {
    this.clearReadyTimer(ps)
    ps.readyTimer = setTimeout(() => {
      if (!this.current(ps, epoch) || ps.hasBaseline) return
      this.fail(ps, 'terminal_session_timeout', 'Terminal baseline timed out')
      ps.handle?.close()
      if (ps.sessionId) void this.transport.release(ps.sessionId).catch(() => {})
    }, this.opts.readyTimeoutMs ?? 30_000)
    ps.readyTimer.unref?.()
  }
  private clearReadyTimer(ps: PaneSession): void { if (ps.readyTimer) clearTimeout(ps.readyTimer); ps.readyTimer = undefined }
  private cancelGrace(ps: PaneSession): void { if (ps.graceTimer) clearTimeout(ps.graceTimer); ps.graceTimer = undefined }
  private async closePane(ps: PaneSession): Promise<void> {
    if (this.panes.get(ps.paneId) !== ps) return
    ++ps.epoch
    ps.commandAbort.abort()
    ps.status = 'closed'
    this.cancelGrace(ps)
    this.clearReadyTimer(ps)
    ps.handle?.close()
    this.panes.delete(ps.paneId)
    this.emit(ps.paneId, { type: 'status', status: 'closed' })
    if (ps.sessionId) await this.transport.release(ps.sessionId).catch(() => {})
  }
  private emit(paneId: string, signal: TerminalStoreSignal): void {
    for (const cb of [...(this.listeners.get(paneId) ?? [])]) { try { cb(signal) } catch { /* listener isolation */ } }
  }
}
export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/**
 * One owner for terminal processes, replay and leases. Closing processes continue
 * to consume quota until exit/close is observed. See docs/architecture.md.
 */
import type { ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { NDJSONParser, parseFrame, isClosedEvent, type TerminalFrame } from './protocol.ts'
import { resolveHerdrBin, spawnTerminalSession } from './spawn.ts'
import { TerminalSessionError, protocolError } from './errors.ts'
import { isDimension, isInputBase64, MAX_INPUT_BASE64_LENGTH, MAX_SCROLL_LINES } from '../../contracts/terminal.ts'
import type { BrowserTerminalEvent, TerminalSessionMode, TerminalSessionStartRequest } from '../../contracts/terminal.ts'
import type { TerminalSessionConfig } from '../config.ts'

export interface TerminalSessionManagerDeps {
  config: TerminalSessionConfig
  binPath?: string
  socketPath: string
  session?: string
  env?: NodeJS.ProcessEnv
  spawnChild?: typeof spawnTerminalSession
  now?: () => number
  randomId?: () => string
  /** Injectable deadlines for deterministic failure tests. */
  readyTimeoutMs?: number
  shutdownTimeoutMs?: number
}
export interface AttachCursor { generation: number; afterSeq: number }
type Subscriber = (event: BrowserTerminalEvent) => void
export type GlobalFrameListener = (sessionId: string, paneId: string, event: BrowserTerminalEvent) => void
export interface TerminalSessionReport {
  activeProcesses: number
  observers: number
  controllers: number
  limits: { maxObservers: number; maxControllers: number; maxProcesses: number }
  sessions: Array<{ sessionId: string; paneId: string; mode: TerminalSessionMode; generation: number; lastSeq: number; replayBytes: number }>
}
type Frame = Extract<BrowserTerminalEvent, { type: 'frame' }>
interface Session {
  sessionId: string
  paneId: string
  mode: TerminalSessionMode
  cols: number
  rows: number
  takeover: boolean
  generation: number
  lastSeq: number
  fullArmed: boolean
  state: 'starting' | 'live' | 'rebuilding' | 'closing' | 'closed'
  child?: ChildProcess
  parser: NDJSONParser
  subscribers: Set<Subscriber>
  replay: Frame[]
  replayBytes: number
  graceTimer?: ReturnType<typeof setTimeout>
  idleTimer?: ReturnType<typeof setTimeout>
  readyTimer?: ReturnType<typeof setTimeout>
  releasePromise?: Promise<void>
  rebuildPromise?: Promise<void>
  inputBlocked: boolean
  conflictReported: boolean
}

export class TerminalSessionManager {
  private readonly sessions = new Map<string, Session>()
  private readonly globalListeners = new Set<GlobalFrameListener>()
  private readonly terminations = new WeakMap<ChildProcess, Promise<void>>()
  private globalClients = 0
  private disposed = false

  constructor(private readonly deps: TerminalSessionManagerDeps) {}

  get processCount(): number { return this.sessions.size }
  observerCount(): number { return [...this.sessions.values()].filter(s => s.mode === 'observe').length }
  private controllerCount(): number { return [...this.sessions.values()].filter(s => s.mode === 'control').length }

  report(): TerminalSessionReport {
    const { maxObservers, maxControllers, maxProcesses } = this.deps.config
    return {
      activeProcesses: this.processCount,
      observers: this.observerCount(),
      controllers: this.controllerCount(),
      limits: { maxObservers, maxControllers, maxProcesses },
      sessions: [...this.sessions.values()].map(s => ({
        sessionId: s.sessionId, paneId: s.paneId, mode: s.mode,
        generation: s.generation, lastSeq: s.lastSeq, replayBytes: s.replayBytes,
      })),
    }
  }

  start(req: TerminalSessionStartRequest): { sessionId: string; generation: number } {
    const cfg = this.deps.config
    if (this.disposed) throw new TerminalSessionError('terminal_session_unavailable', 'terminal runtime disposed')
    if (!req.pane_id?.trim() || !isDimension(req.cols) || !isDimension(req.rows) || !['observe', 'control'].includes(req.mode)) {
      throw protocolError('invalid terminal start request')
    }
    if (this.processCount >= cfg.maxProcesses) throw new TerminalSessionError('terminal_session_unavailable', '达到全局进程数上限')
    if (req.mode === 'control') {
      if (this.controllerCount() >= cfg.maxControllers) throw new TerminalSessionError('terminal_session_unavailable', '达到全局 controller 上限')
      if ([...this.sessions.values()].some(s => s.mode === 'control' && s.paneId === req.pane_id)) {
        throw new TerminalSessionError('terminal_session_conflict', '该 pane 已有 controller')
      }
    } else if (this.observerCount() >= cfg.maxObservers) {
      throw new TerminalSessionError('terminal_session_unavailable', '达到全局 observer 上限')
    }
    const sessionId = this.deps.randomId?.() ?? randomBytes(16).toString('hex')
    if (this.sessions.has(sessionId)) throw protocolError('duplicate terminal session identifier')
    const s: Session = {
      sessionId, paneId: req.pane_id, mode: req.mode, cols: req.cols, rows: req.rows,
      takeover: req.takeover ?? false, generation: 1, lastSeq: 0, fullArmed: false,
      state: 'starting', parser: new NDJSONParser(cfg.maxNdjsonLineBytes),
      subscribers: new Set(), replay: [], replayBytes: 0, inputBlocked: false, conflictReported: false,
    }
    this.sessions.set(sessionId, s)
    try { this.spawnChild(s) } catch (error) {
      this.finalize(s)
      throw new TerminalSessionError('terminal_session_unavailable', error instanceof Error ? error.message : String(error))
    }
    return { sessionId, generation: s.generation }
  }

  release(sessionId: string, reason?: string): Promise<void> {
    const s = this.sessions.get(sessionId)
    if (!s) return Promise.resolve()
    if (s.releasePromise) return s.releasePromise
    s.state = 'closing'
    this.clearTimers(s)
    this.emit(s, { type: 'closed', sessionId, reason })
    const child = s.child
    const work = child ? this.terminate(child, s.mode === 'control') : Promise.resolve()
    s.releasePromise = work.then(() => { this.finalize(s) }, error => {
      // Do not pretend quota was freed if the child has not actually exited.
      this.emit(s, { type: 'error', sessionId, code: 'terminal_session_timeout', message: String(error), retryable: false })
      throw error
    })
    return s.releasePromise
  }

  /** Explicit, user-confirmed takeover only; normal start never evicts an owner. */
  async releaseControllers(paneId: string): Promise<void> {
    await Promise.all([...this.sessions.values()].filter(s => s.paneId === paneId && s.mode === 'control').map(s => this.release(s.sessionId, 'explicit takeover')))
  }

  async dispose(): Promise<void> {
    this.disposed = true
    await Promise.allSettled([...this.sessions.keys()].map(id => this.release(id, 'runtime disposed')))
    this.globalListeners.clear()
    this.globalClients = 0
  }

  addGlobalListener(cb: GlobalFrameListener): () => void {
    this.globalListeners.add(cb)
    return () => { this.globalListeners.delete(cb) }
  }
  onGlobalClientConnect(): void {
    this.globalClients++
    for (const s of this.sessions.values()) this.cancelGrace(s)
  }
  onGlobalClientDisconnect(): void {
    if (this.globalClients === 0) return
    if (--this.globalClients > 0) return
    for (const s of this.sessions.values()) this.onClientDisconnect(s.sessionId)
  }
  onClientDisconnect(sessionId: string): void {
    const s = this.sessions.get(sessionId)
    if (!s || !this.alive(s) || this.globalClients > 0 || s.subscribers.size > 0) return
    this.cancelGrace(s)
    const generation = s.generation
    s.graceTimer = setTimeout(() => {
      s.graceTimer = undefined
      if (this.sessions.get(sessionId) === s && s.generation === generation && this.globalClients === 0 && s.subscribers.size === 0) {
        void this.release(sessionId, 'disconnect grace').catch(() => {})
      }
    }, this.deps.config.disconnectGraceMs)
    s.graceTimer.unref?.()
  }

  liveSessions(): Array<{ sessionId: string; paneId: string; mode: TerminalSessionMode; generation: number }> {
    return [...this.sessions.values()].filter(s => s.state === 'live' && s.fullArmed)
      .map(s => ({ sessionId: s.sessionId, paneId: s.paneId, mode: s.mode, generation: s.generation }))
  }
  replayLatestFull(sessionId: string): Frame | null {
    const s = this.sessions.get(sessionId)
    if (!s || !this.alive(s)) return null
    return s.replay.findLast(frame => frame.full) ?? null
  }

  /**
   * Used by the production Remote as well as tests. With no cursor return the
   * latest full AND every subsequent diff, never an old full on its own.
   * Listeners must be attached before calling this; rebuilding emits a fresh
   * generation through those listeners if the bounded replay no longer covers it.
   */
  attach(sessionId: string, cursor?: AttachCursor): BrowserTerminalEvent[] {
    const s = this.sessions.get(sessionId)
    if (!s || !this.alive(s)) throw new TerminalSessionError('terminal_session_not_found', 'session 不存在')
    this.cancelGrace(s)
    if (!s.fullArmed || s.state === 'rebuilding') return []
    if (cursor) {
      if (cursor.generation !== s.generation || !Number.isSafeInteger(cursor.afterSeq) || cursor.afterSeq < 0 || cursor.afterSeq > s.lastSeq) {
        this.requestRebuild(s, 'invalid or stale attach cursor')
        return []
      }
      if (cursor.afterSeq === s.lastSeq) return [this.ready(s, true, cursor.afterSeq)]
      const index = s.replay.findIndex(frame => frame.seq === cursor.afterSeq + 1)
      if (index >= 0) return [this.ready(s, true, cursor.afterSeq), ...s.replay.slice(index)]
      this.requestRebuild(s, 'replay buffer cannot cover cursor')
      return []
    }
    const index = s.replay.findLastIndex(frame => frame.full)
    if (index < 0) {
      this.requestRebuild(s, 'full baseline evicted from replay')
      return []
    }
    return [this.ready(s, false, s.replay[index]!.seq - 1), ...s.replay.slice(index)]
  }

  subscribe(sessionId: string, cursor: AttachCursor, cb: Subscriber): () => void {
    const s = this.sessions.get(sessionId)
    if (!s || !this.alive(s)) {
      queueMicrotask(() => cb({ type: 'error', sessionId, code: 'terminal_session_not_found', message: 'session 不存在', retryable: false }))
      return () => {}
    }
    s.subscribers.add(cb)
    this.cancelGrace(s)
    for (const event of this.attach(sessionId, cursor)) cb(event)
    let active = true
    return () => {
      if (!active) return
      active = false
      s.subscribers.delete(cb)
      this.onClientDisconnect(sessionId)
    }
  }

  setBlocked(sessionId: string, blocked: boolean): void {
    const out = this.sessions.get(sessionId)?.child?.stdout
    if (!out || blocked === out.isPaused()) return
    if (blocked) out.pause()
    else out.resume()
  }

  writeCommand(sessionId: string, payload: string): void {
    const s = this.sessions.get(sessionId)
    if (!s || !this.alive(s)) throw new TerminalSessionError('terminal_session_not_found', 'session 不存在')
    if (Buffer.byteLength(payload) > MAX_INPUT_BASE64_LENGTH + 256) throw protocolError('command exceeds size limit')
    let command: Record<string, unknown>
    try { command = JSON.parse(payload) as Record<string, unknown> } catch { throw protocolError('invalid command JSON') }
    if (!command || typeof command !== 'object' || Array.isArray(command)) throw protocolError('invalid command')
    const isResize = command.type === 'terminal.resize'
    if (s.mode !== 'control' && !isResize) throw new TerminalSessionError('terminal_session_forbidden', 'controller-only 命令')
    if (isResize) {
      if (!isDimension(command.cols) || !isDimension(command.rows)) throw protocolError('invalid resize dimensions')
    } else if (command.type === 'terminal.input') {
      if (!isInputBase64(command.bytes)) throw protocolError('invalid or oversized input Base64')
    } else if (command.type === 'terminal.scroll') {
      if (!['up', 'down'].includes(String(command.direction)) || !Number.isSafeInteger(command.lines) || Number(command.lines) < 1 || Number(command.lines) > MAX_SCROLL_LINES) throw protocolError('invalid scroll')
    } else throw protocolError('unsupported terminal command')
    const input = s.child?.stdin
    if (!input?.writable || s.state !== 'live') throw new TerminalSessionError('terminal_session_process_exited', 'terminal process is not writable')
    if (s.inputBlocked || input.writableNeedDrain || (input.writableLength ?? 0) + Buffer.byteLength(payload) > MAX_INPUT_BASE64_LENGTH + 256) {
      throw new TerminalSessionError('terminal_session_input_backpressure', 'input not accepted: terminal buffer is full')
    }
    // false means this write WAS accepted but the next one must wait for drain.
    s.inputBlocked = !input.write(JSON.stringify(command) + '\n')
    if (isResize) { s.cols = Number(command.cols); s.rows = Number(command.rows) }
    this.touch(s)
  }

  private spawnChild(s: Session): void {
    const child = (this.deps.spawnChild ?? spawnTerminalSession)(
      resolveHerdrBin({ binPath: this.deps.binPath, env: this.deps.env }),
      { mode: s.mode, paneId: s.paneId, cols: s.cols, rows: s.rows, takeover: s.takeover },
      this.deps.socketPath, this.deps.session, this.deps.env,
    )
    s.child = child
    s.state = 'live'
    s.inputBlocked = false
    const isCurrent = () => s.child === child && s.state === 'live'
    child.on('error', error => { if (isCurrent()) this.fail(s, new TerminalSessionError('terminal_session_process_exited', error.message)) })
    child.stdin?.on?.('error', error => { if (isCurrent()) this.fail(s, new TerminalSessionError('terminal_session_process_exited', error.message)) })
    child.stdin?.on?.('drain', () => { if (isCurrent()) s.inputBlocked = false })
    child.stdout?.on('data', (chunk: Buffer) => {
      if (isCurrent()) this.onStdout(s, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    let stderrTail = ''
    child.stderr?.on('data', (chunk: Buffer) => {
      if (!isCurrent()) return
      stderrTail = (stderrTail + chunk.toString('utf8')).slice(-8192)
      if (s.mode === 'control' && !s.conflictReported && /\b(already|currently|occupied|conflict)\b/i.test(stderrTail)) {
        s.conflictReported = true
        this.emit(s, { type: 'conflict', sessionId: s.sessionId, message: stderrTail.trim().slice(0, 200) })
      }
    })
    const onExit = () => {
      if (s.child !== child || s.state === 'rebuilding') return
      if (s.state === 'live') this.emit(s, { type: 'error', sessionId: s.sessionId, code: 'terminal_session_process_exited', message: 'terminal process exited', retryable: true })
      this.finalize(s)
    }
    child.once('exit', onExit)
    child.once('close', onExit)
    s.readyTimer = setTimeout(() => {
      if (isCurrent() && !s.fullArmed) this.fail(s, new TerminalSessionError('terminal_session_timeout', 'terminal first full frame timed out'))
    }, this.deps.readyTimeoutMs ?? 30_000)
    s.readyTimer.unref?.()
    this.touch(s)
    this.onClientDisconnect(s.sessionId)
  }

  private requestRebuild(s: Session, reason: string): void {
    if (!this.alive(s) || s.rebuildPromise) return
    s.state = 'rebuilding'
    this.clearTimers(s)
    s.generation++
    s.lastSeq = 0
    s.fullArmed = false
    s.replay = []
    s.replayBytes = 0
    s.parser = new NDJSONParser(this.deps.config.maxNdjsonLineBytes)
    this.emit(s, { type: 'error', sessionId: s.sessionId, code: 'terminal_session_frame_gap', message: reason, retryable: true })
    const old = s.child
    s.rebuildPromise = (old ? this.terminate(old, s.mode === 'control') : Promise.resolve()).then(() => {
      if (!this.alive(s) || this.disposed || this.sessions.get(s.sessionId) !== s) return
      s.child = undefined
      this.spawnChild(s)
    }).catch(error => {
      this.fail(s, new TerminalSessionError('terminal_session_timeout', `terminal rebuild failed: ${String(error)}`))
    }).finally(() => { s.rebuildPromise = undefined })
  }

  private onStdout(s: Session, chunk: Buffer): void {
    const lines = s.parser.push(chunk)
    if (s.parser.exceeded()) { this.fail(s, protocolError('stdout line exceeds limit')); return }
    for (const line of lines) {
      if (s.state !== 'live') return
      let raw: unknown
      try { raw = JSON.parse(line) } catch { this.fail(s, protocolError('invalid JSON line')); return }
      if (isClosedEvent(raw)) { void this.release(s.sessionId, raw.reason).catch(() => {}); return }
      try { this.onFrame(s, parseFrame(raw, this.deps.config)) } catch (error) {
        this.fail(s, error instanceof TerminalSessionError ? error : protocolError(String(error)))
        return
      }
    }
  }
  private onFrame(s: Session, frame: TerminalFrame): void {
    if (!s.fullArmed && !frame.full) { this.fail(s, protocolError('first frame is not full')); return }
    if (frame.seq !== s.lastSeq + 1) { this.requestRebuild(s, `seq gap: expected ${s.lastSeq + 1}, received ${frame.seq}`); return }
    const first = !s.fullArmed
    s.fullArmed = true
    s.lastSeq = frame.seq
    if (s.readyTimer) { clearTimeout(s.readyTimer); s.readyTimer = undefined }
    const event: Frame = { type: 'frame', generation: s.generation, seq: frame.seq, full: frame.full, width: frame.width, height: frame.height, bytes: frame.bytes.toString('base64') }
    s.replay.push(event)
    s.replayBytes += event.bytes.length + 128
    while (s.replay.length && s.replayBytes > this.deps.config.replayBufferBytes) {
      s.replayBytes -= s.replay.shift()!.bytes.length + 128
    }
    if (first) this.emit(s, this.ready(s, false, 0))
    this.emit(s, event)
  }
  private ready(s: Session, resumed: boolean, afterSeq: number): BrowserTerminalEvent {
    return { type: 'ready', sessionId: s.sessionId, mode: s.mode, generation: s.generation, resumed, afterSeq }
  }
  private emit(s: Session, event: BrowserTerminalEvent): void {
    event = { ...event, generation: s.generation }
    for (const cb of [...s.subscribers]) { try { cb(event) } catch { /* isolate listeners */ } }
    for (const cb of [...this.globalListeners]) { try { cb(s.sessionId, s.paneId, event) } catch { /* isolate listeners */ } }
  }
  private alive(s: Session): boolean { return s.state !== 'closing' && s.state !== 'closed' }
  private fail(s: Session, error: TerminalSessionError): void {
    if (!this.alive(s)) return
    this.emit(s, { type: 'error', sessionId: s.sessionId, code: error.code, message: error.message, retryable: error.retryable })
    void this.release(s.sessionId, error.code).catch(() => {})
  }
  private touch(s: Session): void {
    if (s.mode !== 'control') return
    if (s.idleTimer) clearTimeout(s.idleTimer)
    s.idleTimer = setTimeout(() => { void this.release(s.sessionId, 'idle timeout').catch(() => {}) }, this.deps.config.controllerIdleMs)
    s.idleTimer.unref?.()
  }
  private cancelGrace(s: Session): void {
    if (s.graceTimer) clearTimeout(s.graceTimer)
    s.graceTimer = undefined
  }
  private clearTimers(s: Session): void {
    this.cancelGrace(s)
    if (s.idleTimer) clearTimeout(s.idleTimer)
    if (s.readyTimer) clearTimeout(s.readyTimer)
    s.idleTimer = s.readyTimer = undefined
  }
  private finalize(s: Session): void {
    this.clearTimers(s)
    s.state = 'closed'
    if (this.sessions.get(s.sessionId) === s) this.sessions.delete(s.sessionId)
  }

  private terminate(child: ChildProcess, sendRelease: boolean): Promise<void> {
    const existing = this.terminations.get(child)
    if (existing) return existing
    const promise = new Promise<void>((resolve, reject) => {
      if (child.exitCode !== null || child.signalCode != null) { resolve(); return }
      const timeout = this.deps.shutdownTimeoutMs ?? 1000
      let timer: ReturnType<typeof setTimeout> | undefined
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        child.off('exit', done)
        child.off('close', done)
        if (error) reject(error)
        else resolve()
      }
      const done = () => finish()
      child.once('exit', done)
      child.once('close', done)
      const kill = (signal: NodeJS.Signals, next: () => void) => {
        if (settled) return
        try { child.kill(signal) } catch { /* wait for exit/close or escalation */ }
        if (!settled) timer = setTimeout(next, timeout)
      }
      const force = () => kill('SIGKILL', () => finish(new Error('terminal process did not exit after SIGKILL')))
      const soft = () => kill('SIGTERM', force)
      if (sendRelease && child.stdin?.writable) {
        try {
          child.stdin.write('{"type":"terminal.release"}\n')
          child.stdin.end()
          if (!settled) timer = setTimeout(soft, timeout)
        } catch { soft() }
      } else soft()
    })
    this.terminations.set(child, promise)
    return promise
  }
}

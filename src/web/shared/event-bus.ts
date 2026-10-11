/** One physical Remote stream per live group of subscribers, with bounded lifetime. */
export interface EventBusOptions<T> {
  open: () => AsyncIterable<T>
  disconnected: T
  retryMs?: number
  idleGraceMs?: number
}
export class RemoteEventBus<T> {
  private readonly listeners = new Set<(event: T) => void>()
  private readonly readyWaiters = new Set<{ resolve: () => void; reject: (error: Error) => void }>()
  private controller: AbortController | null = null
  private idleTimer?: ReturnType<typeof setTimeout>
  private ready = false
  constructor(private readonly options: EventBusOptions<T>) {}

  subscribe(listener: (event: T) => void): () => void {
    this.listeners.add(listener)
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    this.start()
    let active = true
    return () => {
      if (!active) return
      active = false
      this.listeners.delete(listener)
      if (this.listeners.size !== 0) return
      this.idleTimer = setTimeout(() => {
        this.idleTimer = undefined
        if (this.listeners.size === 0) this.stop()
      }, this.options.idleGraceMs ?? 600)
      this.idleTimer.unref?.()
    }
  }
  waitReady(timeoutMs = 15_000): Promise<void> {
    if (this.ready) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const finish = (error?: Error) => {
        clearTimeout(timer)
        this.readyWaiters.delete(waiter)
        if (error) reject(error)
        else resolve()
      }
      const waiter = { resolve: () => finish(), reject: (error: Error) => finish(error) }
      const timer = setTimeout(() => finish(new Error('Herdr event stream did not open')), timeoutMs)
      timer.unref?.()
      this.readyWaiters.add(waiter)
    })
  }
  stop(): void {
    if (this.idleTimer) clearTimeout(this.idleTimer)
    this.idleTimer = undefined
    const controller = this.controller
    this.controller = null
    this.ready = false
    controller?.abort()
    for (const waiter of [...this.readyWaiters]) waiter.reject(new Error('Herdr event stream stopped'))
  }
  dispose(): void { this.listeners.clear(); this.stop() }
  private start(): void {
    if (this.controller) return
    const controller = new AbortController()
    this.controller = controller
    void this.run(controller)
  }
  private emit(event: T): void {
    for (const listener of [...this.listeners]) { try { listener(event) } catch { /* isolate listeners */ } }
  }
  private async run(controller: AbortController): Promise<void> {
    let attempts = 0
    while (!controller.signal.aborted && this.controller === controller) {
      let iterator: AsyncIterator<T> | undefined
      let accepted = false
      try {
        iterator = this.options.open()[Symbol.asyncIterator]()
        for (;;) {
          const item = await nextOrAbort(iterator, controller.signal)
          if (controller.signal.aborted || this.controller !== controller || item.done) break
          accepted = true
          attempts = 0
          this.ready = true
          for (const waiter of [...this.readyWaiters]) waiter.resolve()
          this.emit(item.value)
        }
      } catch { /* carrier loss reconnects; request/domain errors stay in their DTOs */ }
      finally {
        try { void Promise.resolve(iterator?.return?.()).catch(() => {}) } catch { /* best-effort carrier cancellation */ }
      }
      if (controller.signal.aborted || this.controller !== controller) break
      this.ready = false
      if (accepted) this.emit(this.options.disconnected)
      await delay(Math.min((this.options.retryMs ?? 1000) * 2 ** attempts++, 10_000), controller.signal)
    }
  }
}
function nextOrAbort<T>(iterator: AsyncIterator<T>, signal: AbortSignal): Promise<IteratorResult<T>> {
  return new Promise((resolve, reject) => {
    const abort = () => { cleanup(); resolve({ done: true, value: undefined }) }
    const cleanup = () => signal.removeEventListener('abort', abort)
    if (signal.aborted) { abort(); return }
    signal.addEventListener('abort', abort, { once: true })
    Promise.resolve().then(() => iterator.next()).then(value => { cleanup(); resolve(value) }, error => { cleanup(); reject(error) })
  })
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const done = () => { clearTimeout(timer); signal.removeEventListener('abort', done); resolve() }
    const timer = setTimeout(done, ms)
    timer.unref?.()
    signal.addEventListener('abort', done, { once: true })
    if (signal.aborted) done()
  })
}

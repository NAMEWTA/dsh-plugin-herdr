/** Single-consumer bounded queue. Overflow closes the stream; no silent diff loss. */
export class BoundedAsyncQueue<T> implements AsyncIterableIterator<T> {
  private readonly items: Array<{ value: T; bytes: number }> = []
  private bytes = 0
  private closed = false
  private failure: Error | undefined
  private taken = false
  private waiter?: { resolve: (result: IteratorResult<T>) => void; reject: (error: Error) => void }
  constructor(private readonly maxItems: number, private readonly maxBytes: number, private readonly measure: (value: T) => number) {}
  push(value: T): boolean {
    if (this.closed) return false
    const bytes = this.measure(value)
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes || this.items.length >= this.maxItems || this.bytes + bytes > this.maxBytes) {
      this.close(new Error('event consumer exceeded bounded queue; reconnect for a fresh baseline'))
      return false
    }
    if (this.waiter) {
      const waiter = this.waiter
      this.waiter = undefined
      waiter.resolve({ done: false, value })
    } else {
      this.items.push({ value, bytes })
      this.bytes += bytes
    }
    return true
  }
  close(error?: Error): void {
    if (this.closed) return
    this.closed = true
    this.failure = error
    this.items.length = 0
    this.bytes = 0
    const waiter = this.waiter
    this.waiter = undefined
    if (error) waiter?.reject(error)
    else waiter?.resolve({ done: true, value: undefined })
  }
  [Symbol.asyncIterator](): AsyncIterableIterator<T> {
    if (this.taken) throw new Error('event queue already has a consumer')
    this.taken = true
    return this
  }
  next(): Promise<IteratorResult<T>> {
    if (this.failure) return Promise.reject(this.failure)
    const item = this.items.shift()
    if (item) { this.bytes -= item.bytes; return Promise.resolve({ done: false, value: item.value }) }
    if (this.closed) return Promise.resolve({ done: true, value: undefined })
    if (this.waiter) return Promise.reject(new Error('concurrent next() on event queue'))
    return new Promise((resolve, reject) => { this.waiter = { resolve, reject } })
  }
  return(): Promise<IteratorResult<T>> { this.close(); return Promise.resolve({ done: true, value: undefined }) }
}

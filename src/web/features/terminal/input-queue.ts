/** Bounded per-target FIFO; rejected writes never poison the next queued write. */
export class InputQueue<T> {
  private readonly targets = new Map<string, { tail: Promise<void>; count: number; bytes: number }>()
  constructor(
    private readonly send: (target: string, value: T) => Promise<void>,
    private readonly measure: (value: T) => number,
    private readonly maxCount = 64,
    private readonly maxBytes = 512 * 1024,
  ) {}
  enqueue(target: string, value: T, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return Promise.reject(new Error('input cancelled before submission'))
    const bytes = this.measure(value)
    const queue = this.targets.get(target) ?? { tail: Promise.resolve(), count: 0, bytes: 0 }
    if (!Number.isFinite(bytes) || bytes < 0 || bytes > this.maxBytes || queue.count >= this.maxCount || queue.bytes + bytes > this.maxBytes) {
      return Promise.reject(new Error('input queue limit exceeded; input was not submitted'))
    }
    this.targets.set(target, queue)
    queue.count++
    queue.bytes += bytes
    const request = queue.tail.then(() => {
      if (signal?.aborted) throw new Error('input cancelled before submission')
      return this.send(target, value)
    })
    const finish = () => {
      queue.count--
      queue.bytes -= bytes
      if (queue.count === 0 && this.targets.get(target) === queue) this.targets.delete(target)
    }
    queue.tail = request.then(finish, finish)
    return request
  }
  get pendingTargets(): number { return this.targets.size }
}

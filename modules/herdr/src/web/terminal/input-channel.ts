import type { TerminalInput } from '../../contracts/index.ts'
/** One bounded client-to-server channel. An uncertain input is never retried. */
export class InputChannel implements AsyncIterable<TerminalInput> {
  private items: TerminalInput[] = []
  private waiting: ((result: IteratorResult<TerminalInput>) => void) | null = null
  private closed = false
  private sequence = 0
  private bytes = 0
  private pending = new Map<number, {timer: ReturnType<typeof setTimeout>; bytes: number}>()
  constructor(private readonly onUncertain: () => void, private readonly timeoutMs = 5000) {}
  input(text: string): boolean {
    if (this.closed) return false
    const raw = new TextEncoder().encode(text)
    if (raw.length > 65536 || this.pending.size >= 32 || this.bytes + raw.length > 131072) { this.fail(); return false }
    let binary = ''; for (const byte of raw) binary += String.fromCharCode(byte)
    const sequence = ++this.sequence
    this.bytes += raw.length
    const timer = setTimeout(() => this.fail(), this.timeoutMs)
    this.pending.set(sequence, {timer, bytes: raw.length})
    return this.push({ type: 'input', bytes: btoa(binary), sequence })
  }
  acknowledge(sequence: number): void {
    const pending = this.pending.get(sequence)
    if (!pending) return
    clearTimeout(pending.timer); this.pending.delete(sequence)
    this.bytes = Math.max(0, this.bytes - pending.bytes)
  }
  push(command: TerminalInput): boolean {
    if (this.closed) return false
    if (this.waiting) { const waiting = this.waiting; this.waiting = null; waiting({ done: false, value: command }); return true }
    if (this.items.length >= 64) { this.fail(); return false }
    if (command.type === 'resize') this.items = this.items.filter(i => i.type !== 'resize')
    this.items.push(command); return true
  }
  close(): void {
    if (this.closed) return
    this.closed = true; this.items = []; this.bytes = 0
    for (const pending of this.pending.values()) clearTimeout(pending.timer)
    this.pending.clear(); this.waiting?.({ done: true, value: undefined }); this.waiting = null
  }
  private fail() { if (!this.closed) { this.close(); this.onUncertain() } }
  [Symbol.asyncIterator](): AsyncIterator<TerminalInput> {
    return { next: () => {
      const item = this.items.shift(); if (item) return Promise.resolve({ done: false, value: item })
      if (this.closed) return Promise.resolve({ done: true, value: undefined })
      if (this.waiting) return Promise.reject(new Error('Only one input consumer is allowed'))
      return new Promise(resolve => { this.waiting = resolve })
    }, return: async () => { this.close(); return { done: true, value: undefined } } }
  }
}

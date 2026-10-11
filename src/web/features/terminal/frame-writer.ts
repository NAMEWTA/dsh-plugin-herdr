/** Bounded, callback-driven xterm write pump. A full frame supersedes queued diffs. */
export interface RenderFrame {
  sessionId: string
  generation: number
  seq: number
  full: boolean
  bytes: Uint8Array
}
export interface FrameWriterOptions {
  write: (frame: RenderFrame, done: () => void) => void
  confirm: (frame: RenderFrame) => void
  error: (error: Error) => void
  maxFrames?: number
  maxBytes?: number
}
export class TerminalFrameWriter {
  private queue: RenderFrame[] = []
  private bytes = 0
  private writing = false
  private disposed = false
  private failed = false
  private key = ''
  private lastSeq = -1
  constructor(private readonly options: FrameWriterOptions) {}
  push(frame: RenderFrame): void {
    if (this.disposed || this.failed) return
    const key = frame.sessionId + ':' + frame.generation
    if (frame.full) {
      this.queue = []
      this.bytes = 0
      this.key = key
      this.lastSeq = frame.seq - 1
    }
    if (key !== this.key || frame.seq !== this.lastSeq + 1) { this.fail('terminal frame lacks a contiguous baseline'); return }
    if (this.queue.length >= (this.options.maxFrames ?? 256) || this.bytes + frame.bytes.byteLength > (this.options.maxBytes ?? 64 * 1024 * 1024)) {
      this.fail('terminal renderer queue limit exceeded; resynchronize before accepting input')
      return
    }
    this.lastSeq = frame.seq
    this.queue.push(frame)
    this.bytes += frame.bytes.byteLength
    this.pump()
  }
  reset(): void {
    this.failed = false
    this.queue = []
    this.bytes = 0
    this.key = ''
    this.lastSeq = -1
  }
  dispose(): void { this.disposed = true; this.reset() }
  private fail(message: string): void {
    this.failed = true
    this.queue = []
    this.bytes = 0
    this.options.error(new Error(message))
  }
  private pump(): void {
    if (this.disposed || this.failed || this.writing) return
    const frame = this.queue.shift()
    if (!frame) return
    this.bytes -= frame.bytes.byteLength
    this.writing = true
    let finished = false
    const done = () => {
      if (finished) return
      finished = true
      this.writing = false
      if (this.disposed) return
      if (!this.failed && this.key === frame.sessionId + ':' + frame.generation) this.options.confirm(frame)
      this.pump()
    }
    try { this.options.write(frame, done) }
    catch (error) { this.writing = false; this.fail(error instanceof Error ? error.message : String(error)) }
  }
}

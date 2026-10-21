import type { TerminalEvent } from '../../contracts/index.ts'
type Frame = Extract<TerminalEvent, { type: 'frame' }>
export interface ScreenWriter { reset(): void; resize(cols: number, rows: number): void; write(bytes: Uint8Array, done: () => void): void }
/** An imperative, bounded VT pipeline: terminal bytes never enter React state. */
export class FrameWriter {
  private generation = 0
  private acceptedSeq = 0
  private renderedSeq = 0
  private queued: Array<{ frame: Frame; bytes: Uint8Array }> = []
  private bytes = 0
  private writing = false
  private inFlightBytes = 0
  private disposed = false
  constructor(private readonly screen: ScreenWriter, private readonly onFault: () => void, private readonly maxBytes = 8 * 1024 * 1024, private readonly onRendered?: (frame: Frame) => void) {}
  accept(frame: Frame): boolean {
    if (this.disposed) return false
    if (!Number.isSafeInteger(frame.generation) || !Number.isSafeInteger(frame.seq) || frame.generation < this.generation || frame.seq < 1 || frame.width < 1 || frame.height < 1 || frame.width > 400 || frame.height > 200) return this.fail()
    if (frame.generation > this.generation) {
      if (!frame.full) return this.fail()
      this.generation = frame.generation; this.acceptedSeq = 0
      // Never drop the in-flight write; the following full frame resets it before applying.
      this.queued = []; this.bytes = this.inFlightBytes; this.renderedSeq = 0
    }
    if (frame.seq <= this.acceptedSeq) return true // transport duplicate; never render twice
    if (!frame.full && (this.acceptedSeq === 0 || frame.seq !== this.acceptedSeq + 1)) return this.fail()
    let bytes: Uint8Array
    try {
      if (frame.bytes.length > Math.ceil(this.maxBytes / 3) * 4 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(frame.bytes)) return this.fail()
      const raw = atob(frame.bytes); bytes = Uint8Array.from(raw, c => c.charCodeAt(0))
    } catch { return this.fail() }
    if (this.bytes + bytes.length > this.maxBytes || this.queued.length >= 256) return this.fail()
    this.acceptedSeq = frame.seq; this.bytes += bytes.length; this.queued.push({ frame, bytes }); this.pump(); return true
  }
  cursor() { return { generation: this.generation, afterSeq: this.renderedSeq } }
  dispose() { this.disposed = true; this.queued = []; this.bytes = 0 }
  private fail(): false { if (!this.disposed) { this.dispose(); this.onFault() } return false }
  private pump(): void {
    if (this.disposed || this.writing) return
    const next = this.queued.shift(); if (!next) return
    this.writing = true
    const { frame, bytes } = next
    this.inFlightBytes = bytes.length
    try {
      if (frame.full) this.screen.reset()
      this.screen.resize(frame.width, frame.height)
      this.screen.write(bytes, () => {
        if (this.disposed) return
        this.bytes = Math.max(0, this.bytes - bytes.length); this.writing = false; this.inFlightBytes = 0
        if (frame.generation === this.generation) { this.renderedSeq = frame.seq; this.onRendered?.(frame) }
        this.pump()
      })
    } catch { this.fail() }
  }
}

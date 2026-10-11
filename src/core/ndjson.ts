/** Bounded UTF-8 NDJSON framing shared by local transports. */
export class NDJSONParser {
  private parts: Buffer[] = []
  private length = 0
  private overflow = false
  constructor(private readonly maxLineBytes: number) {}

  push(chunk: Buffer): string[] {
    if (this.overflow) return []
    const lines: string[] = []
    let offset = 0
    while (offset < chunk.length) {
      const newline = chunk.indexOf(0x0a, offset)
      const end = newline < 0 ? chunk.length : newline
      const length = end - offset
      if (this.length + length > this.maxLineBytes) {
        this.overflow = true
        this.parts = []
        this.length = 0
        return []
      }
      if (length) {
        // Copy only the bounded remainder, without retaining a huge source chunk.
        this.parts.push(Buffer.from(chunk.subarray(offset, end)))
        this.length += length
      }
      if (newline < 0) break
      const line = Buffer.concat(this.parts, this.length).toString('utf8')
      this.parts = []
      this.length = 0
      if (line.trim()) lines.push(line)
      offset = newline + 1
    }
    return lines
  }
  exceeded(): boolean { return this.overflow }
}


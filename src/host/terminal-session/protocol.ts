/** Incremental, bounded CLI NDJSON parser. Shared browser frames live in contracts/. */
import { TerminalSessionError, protocolError } from './errors.ts'
import { isDimension } from '../../contracts/terminal.ts'

export interface TerminalFrame {
  seq: number
  width: number
  height: number
  full: boolean
  bytes: Buffer
}
export interface FrameLimits {
  maxDecodedFrameBytes: number
  maxNdjsonLineBytes: number
}

export { NDJSONParser } from '../../core/ndjson.ts'

export function parseFrame(raw: unknown, limits: Pick<FrameLimits, 'maxDecodedFrameBytes'>): TerminalFrame {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw protocolError('frame is not an object')
  const f = raw as Record<string, unknown>
  if (f.type !== 'terminal.frame') throw protocolError(`unexpected event type: ${String(f.type)}`)
  if (typeof f.seq !== 'number' || !Number.isSafeInteger(f.seq) || f.seq < 1) throw protocolError('invalid frame seq')
  if (!isDimension(f.width) || !isDimension(f.height)) throw protocolError('invalid frame dimensions')
  if (typeof f.full !== 'boolean') throw protocolError('invalid frame full flag')
  if (typeof f.bytes !== 'string' || f.bytes.length === 0) throw protocolError('missing frame bytes')
  // Bound the encoded form BEFORE allocation/decoding.
  if (f.bytes.length > 4 * Math.ceil(limits.maxDecodedFrameBytes / 3)) throw protocolError('encoded frame exceeds limit')
  const bytes = Buffer.from(f.bytes, 'base64')
  if (bytes.toString('base64') !== f.bytes) throw protocolError('invalid canonical Base64')
  if (bytes.length > limits.maxDecodedFrameBytes) {
    throw new TerminalSessionError('terminal_session_protocol_error', `frame exceeds limit: ${bytes.length}`)
  }
  return { seq: f.seq, width: f.width, height: f.height, full: f.full, bytes }
}

export function isClosedEvent(raw: unknown): raw is { type: 'terminal.closed'; reason?: string } {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return false
  const value = raw as Record<string, unknown>
  return value.type === 'terminal.closed' && (value.reason === undefined || typeof value.reason === 'string')
}

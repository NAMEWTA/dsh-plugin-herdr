/** Host/browser wire contract. CLI NDJSON is a separate protocol. */
export type TerminalSessionMode = 'observe' | 'control'

export type BrowserTerminalEvent =
  | { type: 'ready'; sessionId: string; mode: TerminalSessionMode; generation: number; resumed: boolean; afterSeq: number }
  | { type: 'frame'; generation: number; seq: number; full: boolean; width: number; height: number; bytes: string }
  | { type: 'conflict'; sessionId: string; message: string; generation?: number }
  | { type: 'closed'; sessionId: string; reason?: string; generation?: number }
  | { type: 'error'; sessionId: string; code: string; message: string; retryable: boolean; generation?: number }

export type BrowserTerminalCommand =
  | { type: 'input'; bytes: string }
  | { type: 'resize'; cols: number; rows: number }
  | { type: 'scroll'; direction: 'up' | 'down'; lines: number }
  | { type: 'release' }

export interface TerminalSessionStartRequest {
  pane_id: string
  mode: TerminalSessionMode
  cols: number
  rows: number
  takeover?: boolean
}

export interface TerminalAttachRequest {
  session_id: string
  generation?: number
  after_seq?: number
}

/** A contiguous baseline/replay, or an empty list while a new baseline is pending. */
export interface TerminalAttachResult {
  ok: boolean
  events?: BrowserTerminalEvent[]
  code?: string
  error?: string
}

export const MAX_TERMINAL_DIMENSION = 1000
export const MAX_INPUT_BYTES = 64 * 1024
export const MAX_INPUT_BASE64_LENGTH = 4 * Math.ceil(MAX_INPUT_BYTES / 3)
export const MAX_SCROLL_LINES = 100_000

export function isDimension(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= MAX_TERMINAL_DIMENSION
}

/** Validate canonical Base64 without depending on Node APIs in browser contracts. */
export function isInputBase64(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > MAX_INPUT_BASE64_LENGTH) return false
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) return false
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0
  if (value.length / 4 * 3 - padding > MAX_INPUT_BYTES) return false
  // Unused bits in the final sextet must be zero (canonical encoding).
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
  if (padding === 2 && (alphabet.indexOf(value[value.length - 3]!) & 15) !== 0) return false
  if (padding === 1 && (alphabet.indexOf(value[value.length - 2]!) & 3) !== 0) return false
  return true
}

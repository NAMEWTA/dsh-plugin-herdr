/** Pure validation of terminal payloads; Host Remote also enforces panel codecs. */
import { isDimension, isInputBase64, MAX_SCROLL_LINES } from '../../contracts/terminal.ts'
import type { TerminalSessionStartRequest } from '../../contracts/terminal.ts'

export function validateStart(body: Record<string, unknown>): { value?: TerminalSessionStartRequest; error?: string } {
  const pane = body.pane_id
  if (typeof pane !== 'string' || !pane.trim()) return { error: 'pane_id is required' }
  if (body.mode !== 'observe' && body.mode !== 'control') return { error: "mode must be 'observe' or 'control'" }
  if (!isDimension(body.cols) || !isDimension(body.rows)) return { error: 'cols/rows must be integers between 1 and 1000' }
  if (body.takeover !== undefined && typeof body.takeover !== 'boolean') return { error: 'takeover must be boolean' }
  return { value: { pane_id: pane.trim(), mode: body.mode, cols: body.cols, rows: body.rows, takeover: body.takeover === true } }
}
export function parseCommand(body: Record<string, unknown>): { value?: { sessionId: string; payload: string; release?: boolean }; error?: string } {
  if (typeof body.session_id !== 'string' || !body.session_id.trim()) return { error: 'session_id is required' }
  if (!body.command || typeof body.command !== 'object' || Array.isArray(body.command)) return { error: 'command is required' }
  const command = body.command as Record<string, unknown>
  const sessionId = body.session_id
  switch (command.type) {
    case 'input':
      if (!isInputBase64(command.bytes)) return { error: 'input.bytes must be canonical Base64 at most 64 KiB decoded' }
      return { value: { sessionId, payload: JSON.stringify({ type: 'terminal.input', bytes: command.bytes }) } }
    case 'resize':
      if (!isDimension(command.cols) || !isDimension(command.rows)) return { error: 'resize.cols/rows must be integers between 1 and 1000' }
      return { value: { sessionId, payload: JSON.stringify({ type: 'terminal.resize', cols: command.cols, rows: command.rows }) } }
    case 'scroll':
      if (command.direction !== 'up' && command.direction !== 'down') return { error: 'scroll.direction must be up|down' }
      if (!Number.isSafeInteger(command.lines) || Number(command.lines) < 1 || Number(command.lines) > MAX_SCROLL_LINES) return { error: 'scroll.lines must be between 1 and 100000' }
      return { value: { sessionId, payload: JSON.stringify({ type: 'terminal.scroll', direction: command.direction, lines: command.lines }) } }
    case 'release': return { value: { sessionId, payload: '', release: true } }
    default: return { error: 'unknown command type' }
  }
}

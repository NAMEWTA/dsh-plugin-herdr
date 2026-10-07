/**
 * Terminal session request checks shared by the Host Remote methods.
 * The Web panel no longer calls HTTP routes; these functions only validate
 * the payloads Remote methods forward to the session manager.
 */

import type { BrowserTerminalCommand, TerminalSessionMode, TerminalSessionStartRequest } from './types.ts'

/** 参数校验：合法返回 value，否则返回错误消息。 */
export function validateStart(body: Record<string, unknown>): { value?: TerminalSessionStartRequest; error?: string } {
  const paneId = body.pane_id
  if (typeof paneId !== 'string' || paneId.trim() === '') return { error: 'pane_id is required' }
  const mode = body.mode
  if (mode !== 'observe' && mode !== 'control') return { error: "mode must be 'observe' or 'control'" }
  const cols = body.cols
  const rows = body.rows
  if (typeof cols !== 'number' || !Number.isInteger(cols) || cols < 1 || cols > 1000) return { error: 'cols must be a positive integer' }
  if (typeof rows !== 'number' || !Number.isInteger(rows) || rows < 1 || rows > 1000) return { error: 'rows must be a positive integer' }
  const takeover = body.takeover
  if (takeover !== undefined && typeof takeover !== 'boolean') return { error: 'takeover must be boolean' }
  return {
    value: {
      pane_id: paneId,
      mode: mode as TerminalSessionMode,
      cols,
      rows,
      takeover: typeof takeover === 'boolean' ? takeover : false,
    },
  }
}

export function parseCommand(body: Record<string, unknown>): { value?: { sessionId: string; payload: string; release?: boolean }; error?: string } {
  const sessionId = body.session_id
  if (typeof sessionId !== 'string' || sessionId.trim() === '') return { error: 'session_id is required' }
  const cmd = body.command
  if (typeof cmd !== 'object' || cmd === null) return { error: 'command is required' }
  const c = cmd as Partial<BrowserTerminalCommand>
  if (c.type === 'input') {
    if (typeof c.bytes !== 'string') return { error: 'input.bytes is required' }
    return { value: { sessionId, payload: JSON.stringify({ type: 'terminal.input', bytes: c.bytes }) } }
  }
  if (c.type === 'resize') {
    if (typeof c.cols !== 'number' || typeof c.rows !== 'number') return { error: 'resize.cols/rows are required' }
    return { value: { sessionId, payload: JSON.stringify({ type: 'terminal.resize', cols: c.cols, rows: c.rows }) } }
  }
  if (c.type === 'scroll') {
    if (c.direction !== 'up' && c.direction !== 'down') return { error: 'scroll.direction must be up|down' }
    if (typeof c.lines !== 'number' || !Number.isInteger(c.lines) || c.lines < 1) return { error: 'scroll.lines must be a positive integer' }
    return { value: { sessionId, payload: JSON.stringify({ type: 'terminal.scroll', direction: c.direction, lines: c.lines }) } }
  }
  if (c.type === 'release') {
    return { value: { sessionId, payload: '', release: true } }
  }
  return { error: 'unknown command type' }
}

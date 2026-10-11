import { createConnection, type Socket } from 'node:net'
import { HerdrError } from '../../core/errors.ts'
import { throwIfAborted } from '../../core/abort.ts'
import { NDJSONParser } from '../../core/ndjson.ts'

export interface SocketOptions { socketPath: string; timeoutMs: number; maxLineBytes?: number }
export interface RequestOptions { signal?: AbortSignal; timeoutMs?: number }
interface Envelope { id?: string; result?: unknown; error?: { code?: string; message?: string } }

/** One request per connection; all completion paths remove the abort listener. */
export function socketRequest(options: SocketOptions, method: string, params: unknown, request: RequestOptions = {}): Promise<{ result?: unknown }> {
  return new Promise((resolve, reject) => {
    throwIfAborted(request.signal)
    const payload = JSON.stringify({ id: 'req_1', method, params }) + '\n'
    if (Buffer.byteLength(payload) > 2 * 1024 * 1024) throw new HerdrError('HERDR_PROTOCOL', 'request exceeds size limit')
    const socket = createConnection(options.socketPath)
    const parser = new NDJSONParser(options.maxLineBytes ?? 16 * 1024 * 1024)
    let settled = false
    const finish = (error?: Error, response?: { result?: unknown }) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      request.signal?.removeEventListener('abort', abort)
      socket.destroy()
      if (error) reject(error)
      else resolve(response ?? {})
    }
    const abort = () => finish(new HerdrError('HERDR_ABORTED', `herdr ${method} cancelled; a sent mutation may have taken effect`))
    const timeout = request.timeoutMs ?? options.timeoutMs
    const timer = setTimeout(() => finish(new HerdrError('HERDR_TIMEOUT', `herdr ${method} timed out after ${timeout}ms`)), timeout)
    socket.on('error', (error: NodeJS.ErrnoException) => finish(new HerdrError('HERDR_UNAVAILABLE', error.code === 'ENOENT' ? `herdr socket not found: '${options.socketPath}'` : error.message)))
    socket.on('close', () => finish(new HerdrError('HERDR_UNAVAILABLE', 'socket closed before response')))
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) { abort(); return }
    socket.on('connect', () => {
      if (settled || request.signal?.aborted) return
      socket.write(payload)
    })
    socket.on('data', (chunk: Buffer) => {
      if (settled) return
      const lines = parser.push(chunk)
      if (parser.exceeded()) { finish(new HerdrError('HERDR_PROTOCOL', 'socket response exceeds line limit')); return }
      for (const line of lines) {
        let envelope: Envelope
        try { envelope = JSON.parse(line) as Envelope } catch { finish(new HerdrError('HERDR_PROTOCOL', 'invalid socket JSON')); return }
        if (!envelope || envelope.id !== 'req_1') continue
        if (envelope.error) finish(new HerdrError('HERDR_ERROR', `${envelope.error.code ?? 'unknown'}: ${envelope.error.message ?? ''}`, envelope.error.code))
        else finish(undefined, { result: envelope.result })
        return
      }
    })
  })
}

/** Dedicated event connection. A generation owns its own parser and cancellation. */
export function socketSubscribe(options: SocketOptions, subscriptions: Array<{ type: string }>, onEvent: (event: unknown) => void, signal: AbortSignal): Promise<Socket> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const socket = createConnection(options.socketPath)
    const parser = new NDJSONParser(options.maxLineBytes ?? 16 * 1024 * 1024)
    let settled = false
    const fail = (error: Error) => {
      clearTimeout(timer)
      socket.destroy()
      if (!settled) { settled = true; reject(error) }
    }
    const abort = () => fail(new HerdrError('HERDR_ABORTED', 'subscription cancelled'))
    const timer = setTimeout(() => fail(new HerdrError('HERDR_TIMEOUT', 'events.subscribe handshake timed out')), options.timeoutMs)
    signal.addEventListener('abort', abort, { once: true })
    socket.on('error', error => fail(new HerdrError('HERDR_UNAVAILABLE', error.message)))
    socket.on('close', () => { clearTimeout(timer); signal.removeEventListener('abort', abort); if (!settled) fail(new HerdrError('HERDR_UNAVAILABLE', 'socket closed before subscribe response')) })
    if (signal.aborted) { abort(); return }
    socket.on('connect', () => { if (!signal.aborted) socket.write(JSON.stringify({ id: 'sub_1', method: 'events.subscribe', params: { subscriptions } }) + '\n') })
    socket.on('data', (chunk: Buffer) => {
      const lines = parser.push(chunk)
      if (parser.exceeded()) { fail(new HerdrError('HERDR_PROTOCOL', 'subscription line exceeds limit')); return }
      for (const line of lines) {
        let envelope: Envelope
        try { envelope = JSON.parse(line) as Envelope } catch { fail(new HerdrError('HERDR_PROTOCOL', 'invalid subscription JSON')); return }
        if (!envelope || typeof envelope !== 'object') { fail(new HerdrError('HERDR_PROTOCOL', 'invalid subscription envelope')); return }
        if (envelope.id === 'sub_1' && !settled) {
          if (envelope.error) { fail(new HerdrError('HERDR_ERROR', envelope.error.message ?? '', envelope.error.code)); return }
          settled = true
          clearTimeout(timer)
          resolve(socket)
        } else if (!envelope.id && settled) {
          try { onEvent(envelope) } catch { /* isolate downstream listeners */ }
        }
      }
    })
  })
}
export async function socketPing(socketPath: string, timeoutMs = 5000, signal?: AbortSignal): Promise<{ version: string; protocol: number } | null> {
  try {
    const { result } = await socketRequest({ socketPath, timeoutMs }, 'ping', {}, { signal })
    const value = result as { version?: unknown; protocol?: unknown } | undefined
    return typeof value?.version === 'string' && typeof value.protocol === 'number' ? { version: value.version, protocol: value.protocol } : null
  } catch (error) { if (signal?.aborted) throw error; return null }
}

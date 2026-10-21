import type { Json, PlatformEvent, RequestEnvelope, Result, WorkbenchClient } from '@workbench/contracts'
import { remoteDefinitions } from '../contract.ts'
interface Handle extends AsyncIterable<unknown> { send(value: unknown): void; end(): void; dispose(): void }
export interface RemoteNamespace {
  connect(request: Record<string, never>): Promise<unknown>
  request(request: { clientId: string; envelope: RequestEnvelope }): Promise<unknown>
  disconnect(request: { clientId: string }): Promise<unknown>
  events(request: { clientId: string }): Handle
  stream(request: { clientId: string; envelope: RequestEnvelope }): Handle
}
export class GatewayError extends Error { constructor(readonly code: string) { super(code) } }
/** The gateway envelope is distinct from the domain Result. Unwrap exactly once. */
export function unwrap(value: unknown): unknown {
  if (!value || typeof value !== 'object' || !('ok' in value)) throw new GatewayError('CONNECTION_UNAVAILABLE')
  if (value.ok === true && 'value' in value) return value.value
  throw new GatewayError('AUTH_REQUIRED')
}
export class DshClient implements WorkbenchClient {
  private connection: Promise<string> | undefined
  private id: string | undefined
  private closed = false
  private readonly handles = new Set<Handle>()
  constructor(private readonly remote: RemoteNamespace) {}
  private connect(): Promise<string> {
    if (this.closed) return Promise.reject(new GatewayError('AUTH_REQUIRED'))
    if (!this.connection) this.connection = this.remote.connect({}).then(raw => {
      const result = remoteDefinitions.connect.result.parse(unwrap(raw))
      if (this.closed) { void this.remote.disconnect({clientId:result.clientId}); throw new GatewayError('AUTH_REQUIRED') }
      this.id = result.clientId; return result.clientId
    }).catch(error => { this.connection = undefined; throw error })
    return this.connection
  }
  async request<T = Json>(envelope: RequestEnvelope, signal?: AbortSignal): Promise<Result<T>> {
    if (signal?.aborted) throw new GatewayError('CANCELLED')
    const clientId = await this.connect()
    if (signal?.aborted) throw new GatewayError('CANCELLED')
    try {
      const result = remoteDefinitions.request.result.parse(unwrap(await this.remote.request({ clientId, envelope })))
      if (!result.ok && result.error.code === 'AUTH_REQUIRED') this.reset(clientId)
      if (signal?.aborted) throw new GatewayError('CANCELLED')
      return result as Result<T>
    } catch (error) { if (error instanceof GatewayError && error.code === 'AUTH_REQUIRED') this.reset(clientId); throw error }
  }
  async *events(signal: AbortSignal): AsyncGenerator<PlatformEvent> {
    const clientId = await this.connect()
    if (signal.aborted) return
    const handle = this.remote.events({ clientId }); this.handles.add(handle)
    const abort = () => handle.dispose(); signal.addEventListener('abort', abort, {once:true})
    try { for await (const event of handle) { if (signal.aborted) break; yield remoteDefinitions.events.result.parse(event) } }
    finally { signal.removeEventListener('abort', abort); handle.dispose(); this.handles.delete(handle); this.reset(clientId) }
  }
  async *stream(envelope: RequestEnvelope, uplink: AsyncIterable<unknown>, signal: AbortSignal): AsyncGenerator<unknown> {
    const clientId = await this.connect()
    if (signal.aborted) return
    const handle = this.remote.stream({ clientId, envelope }); this.handles.add(handle)
    const abort = () => handle.dispose(); signal.addEventListener('abort', abort, {once:true})
    const iterator = uplink[Symbol.asyncIterator]()
    const producer = (async () => {
      try { while (!signal.aborted) { const next = await iterator.next(); if (next.done || signal.aborted) break; handle.send(next.value) } }
      catch { handle.dispose() }
    })()
    try { for await (const event of handle) { if (signal.aborted) break; yield event } }
    finally { signal.removeEventListener('abort', abort); handle.dispose(); this.handles.delete(handle); void iterator.return?.(); void producer.catch(() => {}) }
  }
  close(): void {
    if (this.closed) return
    this.closed = true; for (const handle of this.handles) handle.dispose(); this.handles.clear()
    const id = this.id; this.id = undefined; this.connection = undefined
    if (id) void this.remote.disconnect({clientId:id}).catch(() => {})
  }
  private reset(id: string) { if (this.id === id) { this.id = undefined; this.connection = undefined } }
}

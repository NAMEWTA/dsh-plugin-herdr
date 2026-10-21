import type { Json, PlatformEvent, Principal, RequestEnvelope, Result, WorkbenchClient } from '@workbench/contracts'
import { BoundedAsyncQueue, WorkbenchRuntime } from '@workbench/core'
/** In-memory carrier for deterministic module integration tests; not shipped in the plugin. */
export function memoryClient(runtime: WorkbenchRuntime, principal: Principal): WorkbenchClient {
  return {
    async request<T = Json>(request: RequestEnvelope, signal?: AbortSignal): Promise<Result<T>> {
      return runtime.invoke(request, {...principal, signal:signal ? AbortSignal.any([principal.signal,signal]) : principal.signal}) as Promise<Result<T>>
    },
    stream(request,uplink,signal) { return runtime.stream(request,{...principal,signal:AbortSignal.any([principal.signal,signal])},uplink) },
    async *events(signal) {
      const queue = new BoundedAsyncQueue<PlatformEvent>(64,65536,()=>256)
      const off = runtime.subscribe(event => queue.push(event))
      const close = () => queue.close(); signal.addEventListener('abort',close,{once:true})
      try { if (signal.aborted) return; for await (const event of queue) yield event }
      finally { signal.removeEventListener('abort',close); queue.close(); await off() }
    },
  }
}
export function testPrincipal(capabilities: readonly string[], clientId = 'test-client'): Principal {
  return {id:'test-operator',clientId,capabilities:new Set(capabilities),connectionIds:new Set(['local']),signal:new AbortController().signal}
}

import type { AuditRecord, Contribution, Disposer, Json, ModuleManifest, ModuleState, ModuleStatus, PlatformEvent, Principal, RequestEnvelope, Result } from '@workbench/contracts'
import type { AuditSink, Clock, ModuleContext, Operation, StreamOperation, StorageDriver, WorkbenchModule } from '@workbench/sdk'
import { WorkbenchError, failure, requireCapability } from './errors.ts'
interface Entry {
  module: WorkbenchModule
  state: ModuleState
  error?: ModuleStatus['error']
  controller: AbortController
  cleanup: Disposer[]
  operations: Map<string, Operation>
  streams: Map<string, StreamOperation>
  contributions: Map<string, Contribution>
  requests: Set<Promise<unknown>>
}
interface JournalEntry { fingerprint: string; at: number; settled: boolean; promise: Promise<Result<unknown>> }
export interface RuntimeOptions {
  readonly storage: StorageDriver
  readonly audit: AuditSink
  readonly clock?: Clock
  readonly drainTimeoutMs?: number
  readonly maxRequests?: number
  readonly journalCapacity?: number
  readonly journalTtlMs?: number
}
const id = /^[a-z][a-z0-9-]{0,63}$/
const operationId = /^[a-z][a-z0-9-]*(?:\.[a-z][a-zA-Z0-9-]*)+$/
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value) ?? 'null'
}
/** Trusted first-party modules, not an arbitrary-code sandbox. */
export class WorkbenchRuntime {
  private readonly entries = new Map<string, Entry>()
  private readonly listeners = new Set<(event: PlatformEvent) => void>()
  private readonly journal = new Map<string, JournalEntry>()
  private revision = 0
  private closed = false
  private readonly now: () => number
  constructor(private readonly options: RuntimeOptions) { this.now = () => options.clock?.now() ?? Date.now() }
  register(module: WorkbenchModule): void {
    if (this.closed) throw new WorkbenchError('MODULE_UNAVAILABLE')
    this.validateManifest(module.manifest)
    if (this.entries.has(module.manifest.id)) throw new WorkbenchError('MODULE_CONFLICT', 'Duplicate module ID')
    this.entries.set(module.manifest.id, { module, state: 'registered', controller: new AbortController(), cleanup: [], operations: new Map(), streams: new Map(), contributions: new Map(), requests: new Set() })
  }
  validateGraph(): string[] {
    const visited = new Set<string>(), visiting = new Set<string>(), order: string[] = []
    const visit = (name: string) => {
      if (visiting.has(name)) throw new WorkbenchError('MODULE_CONFLICT', 'Dependency cycle')
      if (visited.has(name)) return
      const entry = this.entries.get(name)
      if (!entry) throw new WorkbenchError('DEPENDENCY_UNAVAILABLE', 'Missing dependency')
      visiting.add(name)
      for (const dep of entry.module.manifest.dependencies) visit(dep)
      visiting.delete(name); visited.add(name); order.push(name)
    }
    for (const key of this.entries.keys()) visit(key)
    return order
  }
  async startAll(): Promise<void> {
    for (const name of this.validateGraph()) await this.start(name)
  }
  async start(name: string): Promise<void> {
    if (this.closed) throw new WorkbenchError('MODULE_UNAVAILABLE')
    this.validateGraph()
    const entry = this.get(name)
    if (entry.state === 'active') return
    if (entry.state === 'starting' || entry.state === 'draining' || entry.cleanup.length || entry.requests.size) throw new WorkbenchError('MODULE_CONFLICT')
    if (entry.module.manifest.dependencies.some(dep => this.get(dep).state !== 'active')) {
      entry.state = 'failed'; entry.error = 'DEPENDENCY_UNAVAILABLE'; this.emit(name, 'modules'); return
    }
    entry.state = 'starting'; delete entry.error
    entry.controller = new AbortController()
    const context: ModuleContext = {
      signal: entry.controller.signal,
      storage: this.options.storage.scope(name),
      operation: <I, O>(definition: Operation<I, O>) => {
        if (entry.state !== 'starting' || !definition.id.startsWith(name + '.') || !operationId.test(definition.id) || entry.operations.has(definition.id) || entry.streams.has(definition.id)) throw new WorkbenchError('MODULE_CONFLICT')
        if (!entry.module.manifest.capabilities.includes(definition.capability)) throw new WorkbenchError('FORBIDDEN')
        const erased: Operation = { ...definition, auditTarget: definition.auditTarget ? input => definition.auditTarget!(input as I) : undefined, run: (input, ctx) => definition.run(input as I, ctx) }
        entry.operations.set(definition.id, erased)
      },
      stream: <I, O, U>(definition: StreamOperation<I, O, U>) => {
        if (entry.state !== 'starting' || !definition.id.startsWith(name + '.') || !operationId.test(definition.id) || entry.streams.has(definition.id) || entry.operations.has(definition.id) || !entry.module.manifest.capabilities.includes(definition.capability)) throw new WorkbenchError('MODULE_CONFLICT')
        entry.streams.set(definition.id, { ...definition, run: (input, ctx, uplink) => definition.run(input as I, ctx, uplink as AsyncIterable<U>) })
      },
      contribution: contribution => {
        const declared = entry.module.manifest.contributions.find(item => item.id === contribution.id)
        if (entry.state !== 'starting' || !declared || canonical(declared) !== canonical(contribution) || entry.contributions.has(contribution.id)) throw new WorkbenchError('MODULE_CONFLICT')
        entry.contributions.set(contribution.id, contribution)
      },
      own: disposer => {
        if (entry.controller.signal.aborted) throw new WorkbenchError('MODULE_UNAVAILABLE')
        entry.cleanup.push(disposer)
      },
      emit: event => { if (!entry.controller.signal.aborted) this.emit(name, event.type) },
      interval: (callback, ms) => {
        if (!Number.isFinite(ms) || ms < 100 || ms > 86_400_000) throw new WorkbenchError('INVALID_REQUEST')
        let busy = false
        const timer = setInterval(() => {
          if (busy || entry.controller.signal.aborted) return
          busy = true
          const job = Promise.resolve().then(callback).catch(() => this.emit(name, 'gap')).finally(() => { busy = false; entry.requests.delete(job) })
          entry.requests.add(job)
        }, ms)
        entry.cleanup.push(() => clearInterval(timer))
      },
    }
    try {
      await entry.module.start(context)
      if (entry.controller.signal.aborted) throw new WorkbenchError('MODULE_UNAVAILABLE')
      entry.state = 'active'
    } catch (error) {
      entry.controller.abort()
      entry.streams.clear(); entry.operations.clear(); entry.contributions.clear()
      const cleaned = await this.cleanup(entry)
      entry.state = 'failed'; entry.error = cleaned ? failure(error, '').code : 'MODULE_DRAIN_FAILED'
    }
    this.emit(name, 'modules')
  }
  async stop(name: string): Promise<void> {
    const entry = this.get(name)
    if (entry.state === 'stopped' || entry.state === 'disposed') return
    if (entry.state === 'starting' || entry.state === 'draining') throw new WorkbenchError('MODULE_CONFLICT')
    if ([...this.entries.values()].some(other => other.state === 'active' && other.module.manifest.dependencies.includes(name))) throw new WorkbenchError('MODULE_CONFLICT', 'Active dependent')
    entry.state = 'draining'; this.emit(name, 'modules')
    entry.controller.abort()
    const pending = [...entry.requests]
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<boolean>(resolve => { timer = setTimeout(() => resolve(false), this.options.drainTimeoutMs ?? 5000) })
    const drained = await Promise.race([Promise.allSettled(pending).then(() => true), timeout])
    if (timer) clearTimeout(timer)
    const cleaned = await this.cleanup(entry)
    entry.streams.clear(); entry.operations.clear(); entry.contributions.clear()
    if (!drained || !cleaned) { entry.state = 'failed'; entry.error = 'MODULE_DRAIN_FAILED'; this.emit(name, 'modules'); throw new WorkbenchError('MODULE_DRAIN_FAILED') }
    entry.state = 'stopped'; delete entry.error; this.emit(name, 'modules')
  }
  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    for (const name of this.validateGraph().reverse()) {
      try { await this.stop(name); this.get(name).state = 'disposed' } catch { /* retain failed state and quota diagnostics */ }
    }
    this.listeners.clear(); this.journal.clear()
  }
  statuses(): ModuleStatus[] {
    return [...this.entries.values()].map(entry => ({ manifest: entry.module.manifest, state: entry.state, activeRequests: entry.requests.size, ...(entry.error ? { error: entry.error } : {}) }))
  }
  contributions(principal: Principal): Contribution[] {
    return [...this.entries.values()].filter(entry => entry.state === 'active').flatMap(entry => [...entry.contributions.values()]).filter(item => principal.capabilities.has(item.capability)).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || a.id.localeCompare(b.id))
  }
  subscribe(listener: (event: PlatformEvent) => void): Disposer { this.listeners.add(listener); return () => { this.listeners.delete(listener) } }
  async invoke(request: RequestEnvelope, principal: Principal): Promise<Result<unknown>> {
    const started = this.now()
    let target: string | undefined
    const rejected = async (error: unknown): Promise<Result<unknown>> => {
      const fault = failure(error, request.requestId)
      await this.audit(principal, request, started, fault.code === 'OPERATION_OUTCOME_UNKNOWN' ? 'unknown' : 'rejected', fault.code, target)
      return { ok: false, error: fault }
    }
    try {
      if (!principal.id || !principal.clientId || principal.signal.aborted) throw new WorkbenchError('AUTH_REQUIRED')
      if (!/^[a-zA-Z0-9_-]{8,128}$/.test(request.requestId) || !operationId.test(request.operation)) throw new WorkbenchError('INVALID_REQUEST')
      const [name] = request.operation.split('.')
      const entry = this.get(name!)
      if (entry.state !== 'active' || this.closed) throw new WorkbenchError('MODULE_UNAVAILABLE')
      const operation = entry.operations.get(request.operation)
      if (!operation) throw new WorkbenchError('NOT_FOUND')
      requireCapability(principal, operation.capability)
      if(new TextEncoder().encode(JSON.stringify(request.input)).byteLength>1_048_576)throw new WorkbenchError('QUOTA_EXCEEDED')
      const input = operation.input.safeParse(request.input)
      if (!input.success) {
        await this.audit(principal, request, started, 'rejected', 'INVALID_REQUEST')
        return { ok: false, error: { code: 'INVALID_REQUEST', requestId: request.requestId, retryable: false,
          issues: input.error.issues.slice(0, 16).map(issue => ({ path: issue.path.map(String).join('.'), message: issue.message.slice(0, 160) })) } }
      }
      target = operation.auditTarget?.(input.data)?.slice(0,400)
      const key = principal.id + ':' + principal.clientId + ':' + request.requestId
      // The journal is in memory only; request contents are never logged or persisted.
      const fingerprint = canonical({ operation: request.operation, input: input.data })
      this.expireJournal()
      const prior = this.journal.get(key)
      if (operation.kind === 'action' && prior) {
        if (prior.fingerprint !== fingerprint) throw new WorkbenchError('IDEMPOTENCY_CONFLICT')
        return prior.promise
      }
      if (entry.requests.size >= (this.options.maxRequests ?? 32)) throw new WorkbenchError('QUOTA_EXCEEDED')
      if (operation.kind === 'action' && this.journal.size >= (this.options.journalCapacity ?? 1000)) throw new WorkbenchError('QUOTA_EXCEEDED')
      const execute = async (): Promise<Result<unknown>> => {
        try {
          const signal = AbortSignal.any([principal.signal, entry.controller.signal])
          if (signal.aborted) throw new WorkbenchError('CANCELLED')
          // Ensure durable audit availability before any mutation, without storing input.
          if (operation.kind === 'action') await this.options.audit.append({ at: this.now(), actor: principal.id, client: principal.clientId, module: name!, operation: request.operation, requestId: request.requestId, outcome: 'accepted', durationMs: 0, ...(target ? {target} : {}) })
          const value = await operation.run(input.data, { principal, signal, requestId: request.requestId })
          const checked = operation.output.safeParse(value)
          if (!checked.success) throw new WorkbenchError(operation.kind === 'action' ? 'OPERATION_OUTCOME_UNKNOWN' : 'INTERNAL_ERROR')
          if(operation.kind==='action')await this.audit(principal, request, started, 'succeeded', undefined, target, true)
          return { ok: true, data: checked.data, requestId: request.requestId }
        } catch (error) { return rejected(error) }
      }
      const work = Promise.resolve().then(execute)
      entry.requests.add(work)
      void work.finally(() => entry.requests.delete(work)).catch(() => {})
      if (operation.kind === 'action') {
        const receipt = { fingerprint, at: this.now(), promise: work, settled: false }
        this.journal.set(key, receipt)
        void work.finally(() => { receipt.settled = true; receipt.at = this.now() }).catch(() => {})
      }
      return work
    } catch (error) { return rejected(error) }
  }
  async *stream(request: RequestEnvelope, principal: Principal, input: AsyncIterable<unknown>): AsyncGenerator<unknown> {
    if (this.closed || !principal.id || !principal.clientId || principal.signal.aborted) throw new WorkbenchError('AUTH_REQUIRED')
    if(!/^[a-zA-Z0-9_-]{8,128}$/.test(request.requestId)||!operationId.test(request.operation))throw new WorkbenchError('INVALID_REQUEST')
    const entry = this.get(request.operation.split('.')[0] ?? '')
    const operation = entry.streams.get(request.operation)
    if (entry.state !== 'active' || !operation) throw new WorkbenchError('MODULE_UNAVAILABLE')
    requireCapability(principal, operation.capability)
    if (entry.requests.size >= (this.options.maxRequests ?? 32)) throw new WorkbenchError('QUOTA_EXCEEDED')
    const parsed = operation.input.safeParse(request.input)
    if (!parsed.success) throw new WorkbenchError('INVALID_REQUEST')
    const signal = AbortSignal.any([entry.controller.signal, principal.signal])
    let release: () => void = () => {}
    const lifetime = new Promise<void>(resolve => { release = resolve })
    entry.requests.add(lifetime)
    async function *validated(): AsyncGenerator<unknown> {
      for await (const value of input) {
        requireCapability({ ...principal, signal }, operation!.capability)
        const result = operation!.uplink.safeParse(value)
        if (!result.success) throw new WorkbenchError('INVALID_REQUEST')
        yield result.data
      }
    }
    try {
      for await (const value of operation.run(parsed.data, {principal, signal, requestId:request.requestId}, validated())) {
        requireCapability({ ...principal, signal }, operation.capability)
        const checked = operation.output.safeParse(value)
        if (!checked.success) throw new WorkbenchError('INTERNAL_ERROR')
        yield checked.data
      }
    } finally { release(); entry.requests.delete(lifetime) }
  }
  private emit(moduleId: string, type: PlatformEvent['type']): void {
    const event = { moduleId, type, revision: ++this.revision }
    for (const listener of this.listeners) { try { listener(event) } catch { /* isolate consumers */ } }
  }
  private get(name: string): Entry {
    const entry = this.entries.get(name)
    if (!entry) throw new WorkbenchError('NOT_FOUND')
    return entry
  }
  private validateManifest(manifest: ModuleManifest): void {
    if (!id.test(manifest.id) || manifest.platformApi !== 1 || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(manifest.version)) throw new WorkbenchError('UNSUPPORTED_VERSION')
    const seen = new Set<string>()
    for (const item of manifest.contributions) {
      if (!item.id.startsWith(manifest.id + '.') || seen.has(item.id) || !manifest.capabilities.includes(item.capability)) throw new WorkbenchError('MODULE_CONFLICT')
      seen.add(item.id)
    }
    if (new Set(manifest.dependencies).size !== manifest.dependencies.length || manifest.dependencies.some(name => !id.test(name))) throw new WorkbenchError('MODULE_CONFLICT')
  }
  private async cleanup(entry: Entry): Promise<boolean> {
    const pending = entry.cleanup.splice(0).reverse()
    const failed: Disposer[] = []
    for (const stop of pending) {
      const work = Promise.resolve().then(stop)
      let timer: ReturnType<typeof setTimeout> | undefined
      try { await Promise.race([work,new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new WorkbenchError('MODULE_DRAIN_FAILED')),this.options.drainTimeoutMs??5000)})]) }
      catch { failed.unshift(()=>work) }
      finally { if(timer)clearTimeout(timer) }
    }
    entry.cleanup = failed
    return failed.length === 0
  }
  private expireJournal(): void {
    const cutoff = this.now() - (this.options.journalTtlMs ?? 600_000)
    for (const [key, value] of this.journal) if (value.settled && value.at < cutoff) this.journal.delete(key)
  }
  private async audit(principal: Principal, request: RequestEnvelope, started: number, outcome: AuditRecord['outcome'], code?: AuditRecord['code'], target?: string, requireReceipt = false): Promise<void> {
    try { await this.options.audit.append({ at: this.now(), actor: principal.id, client: principal.clientId, module: request.operation.split('.')[0] ?? 'unknown', operation: request.operation, requestId: request.requestId, outcome, durationMs: Math.max(0, this.now() - started), ...(code ? { code } : {}), ...(target ? {target} : {}) }) }
    catch { if (requireReceipt) throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN') }
  }
}

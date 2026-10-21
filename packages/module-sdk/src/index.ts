import type { AuditRecord, Contribution, Disposer, Json, ModuleManifest, PlatformEvent, Principal } from '@workbench/contracts'
export interface Validator<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: readonly { path: readonly PropertyKey[]; message: string }[] } }
}
export interface OperationContext {
  readonly principal: Principal
  readonly signal: AbortSignal
  readonly requestId: string
}
export interface Operation<I = unknown, O = unknown> {
  /** Metadata only: never return keys, output, paths or credentials. */
  readonly auditTarget?: (input: I) => string | undefined
  readonly id: string
  readonly kind: 'query' | 'action'
  readonly capability: string
  readonly input: Validator<I>
  readonly output: Validator<O>
  /** Only mutations with a request ID enter the bounded idempotency journal. */
  readonly run: (input: I, context: OperationContext) => O | Promise<O>
}
export interface StreamOperation<I = unknown, O = unknown, U = unknown> {
  readonly id: string
  readonly capability: string
  readonly input: Validator<I>
  readonly output: Validator<O>
  readonly uplink: Validator<U>
  readonly run: (input: I, context: OperationContext, uplink: AsyncIterable<U>) => AsyncIterable<O>
}
export interface Stored<T extends Json> { readonly version: number; readonly value: T }
export interface ScopedStorage {
  read<T extends Json>(key: string): Promise<Stored<T> | null>
  /** CAS; expectedVersion null means the key must not exist. */
  write<T extends Json>(key: string, value: T, expectedVersion: number | null): Promise<Stored<T>>
}
export interface StorageDriver {
  scope(namespace: string): ScopedStorage
}
export interface ModuleContext {
  readonly signal: AbortSignal
  readonly storage: ScopedStorage
  operation<I, O>(definition: Operation<I, O>): void
  stream<I, O, U>(definition: StreamOperation<I, O, U>): void
  contribution(contribution: Contribution): void
  /** Register the disposer before creating work that can fail. Cleanup is LIFO and awaited. */
  own(disposer: Disposer): void
  emit(event: Omit<PlatformEvent, 'revision' | 'moduleId'>): void
  interval(callback: () => void | Promise<void>, milliseconds: number): void
}
export interface WorkbenchModule {
  readonly manifest: ModuleManifest
  readonly start: (context: ModuleContext) => void | Promise<void>
}
export interface AuditSink {
  append(record: AuditRecord): Promise<void>
  read(limit: number): Promise<readonly AuditRecord[]>
}
export interface Clock { now(): number }
export function defineModule(module: WorkbenchModule): WorkbenchModule { return module }

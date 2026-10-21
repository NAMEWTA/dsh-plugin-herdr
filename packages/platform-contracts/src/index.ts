/** Environment-neutral wire vocabulary. Never put module-specific DTOs here. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export type Disposer = () => void | Promise<void>
export type Locale = 'zh' | 'en'
export type Localized = Readonly<Record<Locale, string>>
export type ModuleState = 'registered' | 'starting' | 'active' | 'draining' | 'stopped' | 'failed' | 'disposed'
export interface Contribution {
  readonly id: string
  readonly title: Localized
  readonly kind: 'route' | 'command' | 'settings' | 'widget'
  readonly capability: string
  readonly order?: number
}
export interface ModuleManifest {
  readonly id: string
  readonly version: string
  readonly platformApi: 1
  readonly title: Localized
  readonly description: Localized
  readonly dependencies: readonly string[]
  readonly capabilities: readonly string[]
  readonly contributions: readonly Contribution[]
}
export interface ModuleStatus {
  readonly manifest: ModuleManifest
  readonly state: ModuleState
  readonly error?: ErrorCode
  readonly activeRequests: number
}
/** Only a trusted host adapter may construct a Principal; it never comes from request JSON. */
export interface Principal {
  readonly id: string
  readonly clientId: string
  readonly capabilities: ReadonlySet<string>
  readonly connectionIds: ReadonlySet<string>
  readonly signal: AbortSignal
  readonly conversationId?: string
}
export type ErrorCode =
  | 'AUTH_REQUIRED' | 'FORBIDDEN' | 'INVALID_REQUEST' | 'NOT_FOUND' | 'MODULE_UNAVAILABLE'
  | 'MODULE_DRAIN_FAILED' | 'MODULE_CONFLICT' | 'UNSUPPORTED_VERSION' | 'DEPENDENCY_UNAVAILABLE'
  | 'CONNECTION_UNAVAILABLE' | 'STALE_SNAPSHOT' | 'RESOURCE_CHANGED' | 'OWNERSHIP_REQUIRED'
  | 'LEASE_CONFLICT' | 'LEASE_EXPIRED' | 'STREAM_RESYNC_REQUIRED' | 'QUOTA_EXCEEDED'
  | 'OPERATION_OUTCOME_UNKNOWN' | 'IDEMPOTENCY_CONFLICT' | 'CANCELLED' | 'STORAGE_UNAVAILABLE'
  | 'INTERNAL_ERROR' | 'INPUT_BACKPRESSURE'
export interface Failure {
  readonly code: ErrorCode
  readonly requestId: string
  readonly retryable: boolean
  readonly issues?: readonly { path: string; message: string }[]
}
export type Result<T> = { readonly ok: true; readonly data: T; readonly requestId: string }
  | { readonly ok: false; readonly error: Failure }
export interface RequestEnvelope {
  readonly operation: string
  readonly requestId: string
  readonly input: Json
}
export interface AuditRecord {
  readonly at: number
  readonly actor: string
  readonly client: string
  readonly module: string
  readonly operation: string
  readonly requestId: string
  readonly outcome: 'accepted' | 'succeeded' | 'rejected' | 'unknown'
  readonly target?: string
  readonly durationMs: number
  readonly code?: ErrorCode
}
export interface PlatformEvent {
  readonly type: 'invalidate' | 'modules' | 'gap' | 'heartbeat'
  readonly moduleId: string
  readonly revision: number
}
export interface PlatformSnapshot {
  readonly apiVersion: 1
  readonly build: { readonly version: string; readonly sha: string }
  readonly modules: readonly ModuleStatus[]
  readonly capabilities: readonly string[]
}
export interface RouteLocation { readonly id: string; readonly params: Readonly<Record<string, string>> }
export interface WorkbenchClient {
  request<T = Json>(request: RequestEnvelope, signal?: AbortSignal): Promise<Result<T>>
  stream(request: RequestEnvelope, uplink: AsyncIterable<unknown>, signal: AbortSignal): AsyncIterable<unknown>
  events(signal: AbortSignal): AsyncIterable<PlatformEvent>
}

export { WorkbenchError, failure, requireCapability } from './errors.ts'

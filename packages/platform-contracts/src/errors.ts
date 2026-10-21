import type { ErrorCode, Failure } from './index.ts'
export class WorkbenchError extends Error {
  constructor(readonly code: ErrorCode, message: string = code) { super(message); this.name = 'WorkbenchError' }
}
export function failure(error: unknown, requestId: string): Failure {
  const code = error instanceof WorkbenchError ? error.code : 'INTERNAL_ERROR'
  return { code, requestId, retryable: code === 'CONNECTION_UNAVAILABLE' || code === 'STALE_SNAPSHOT' }
}
export function requireCapability(principal: { capabilities: ReadonlySet<string>; signal: AbortSignal }, capability: string): void {
  if (principal.signal.aborted) throw new WorkbenchError('AUTH_REQUIRED')
  if (!principal.capabilities.has(capability)) throw new WorkbenchError('FORBIDDEN')
}

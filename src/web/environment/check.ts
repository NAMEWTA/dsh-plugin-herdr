/** One explicit management action. Environment checks never install or start software. */
export interface EnvironmentRemote<T> {
  start(): Promise<unknown>
  environment(): Promise<T>
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

/** Bounded plain-text diagnostic, not a dump of RPC objects, environment or credentials. */
export function setupFailureDetail(error: unknown): string | null {
  const body = record(error)
  const raw = typeof error === 'string' ? error
    : typeof body?.message === 'string' ? body.message
    : typeof body?.error === 'string' ? body.error
    : typeof body?.code === 'string' ? body.code
    : null
  if (!raw) return null
  const text = raw
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/((?:token|api[_-]?key|password)\s*[=:]\s*)[^\s&,;]+/gi, '$1[redacted]')
    .replace(/Bearer\s+[^\s,;]+/gi, 'Bearer [redacted]')
    .trim()
  return text ? text.slice(0, 1000) : null
}

/** Do not discard a failed start's error and accidentally present a healthy probe as success. */
export async function checkEnvironment<T>(remote: EnvironmentRemote<T>, start = false): Promise<T> {
  if (start) {
    const result = await remote.start()
    if (record(result)?.ok !== true) {
      throw new Error(setupFailureDetail(result) ?? 'herdr_start_unconfirmed')
    }
  }
  return remote.environment()
}

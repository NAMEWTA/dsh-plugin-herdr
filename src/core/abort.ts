import { HerdrError } from './errors.ts'

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new HerdrError('HERDR_ABORTED', 'operation cancelled; already-sent mutations may have taken effect')
}
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal)
    const abort = () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); reject(new HerdrError('HERDR_ABORTED', 'operation cancelled during retry delay')) }
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve() }, ms)
    signal?.addEventListener('abort', abort, { once: true })
    if (signal?.aborted) abort()
  })
}

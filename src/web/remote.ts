// Client-side access to the Herdr Host Remote namespace.
// The namespace is installed by ctx.remote.$mount(); components read it through
// this holder so data code can be tested without a browser.
//
// dsh-api-gateway 客户端约定：direct 方法返回 Result 信封
//   { ok: true, value } | { ok: false, error: RemoteError }
// stream 方法（events）返回可异步迭代的句柄，逐项产出原始值、失败时抛出。
// setHerdrRemote() 把原始命名空间包装成 HerdrRemote：direct 方法解包 value、
// 失败转为 throw，调用方拿到的就是 host 方法的返回值本身。

import type { HerdrRemote } from './herdr-remote.js'

export type { HerdrRemote }

/** Methods the gateway exposes as streams (no Result envelope). */
const STREAM_METHODS = new Set<string>(['events'])

export class HerdrRemoteError extends Error {
  readonly code: string | undefined
  constructor(message: string, code?: string) {
    super(message)
    this.name = 'HerdrRemoteError'
    this.code = code
  }
}

type RemoteResult = { ok: true; value: unknown } | { ok: false; error: { message?: unknown; code?: unknown } }

/** Gateway Result 信封判定（host 返回值本身从不同时带 ok:true 与 value 键）。 */
export function isRemoteResult(value: unknown): value is RemoteResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const record = value as Record<string, unknown>
  if (record.ok === true) return Object.hasOwn(record, 'value')
  if (record.ok === false) return record.error !== null && typeof record.error === 'object'
  return false
}

/** 解包一次 Result 信封；非信封值原样返回（测试替身 / 未来直出的网关）。 */
export function unwrapRemoteResult<T = unknown>(result: unknown): T {
  if (!isRemoteResult(result)) return result as T
  if (result.ok) return result.value as T
  const message = typeof result.error.message === 'string' ? result.error.message : 'herdr remote call failed'
  throw new HerdrRemoteError(message, typeof result.error.code === 'string' ? result.error.code : undefined)
}

type RawMethod = (...args: unknown[]) => unknown

/** 包装原始 remote 命名空间：direct 方法解包，stream 方法透传。 */
export function adaptHerdrRemote(raw: unknown): HerdrRemote {
  const source = raw as Record<string, RawMethod | undefined>
  const cache = new Map<string, RawMethod>()
  return new Proxy({} as HerdrRemote, {
    get(_target, prop) {
      if (typeof prop !== 'string' || prop === 'then') return undefined
      const hit = cache.get(prop)
      if (hit) return hit
      const call = (args: unknown[]): unknown => {
        const method = source[prop]
        if (typeof method !== 'function') throw new HerdrRemoteError(`herdr remote method ${prop} is not mounted`)
        return Reflect.apply(method, source, args)
      }
      const fn: RawMethod = STREAM_METHODS.has(prop)
        ? (...args) => call(args)
        : async (...args) => unwrapRemoteResult(await call(args))
      cache.set(prop, fn)
      return fn
    },
  })
}

let remote: HerdrRemote | null = null

export function setHerdrRemote(next: unknown): void {
  remote = next == null ? null : adaptHerdrRemote(next)
}

export function getHerdrRemote(): HerdrRemote {
  if (!remote) throw new Error('herdr remote is not mounted')
  return remote
}

export async function remoteJson<T>(call: Promise<unknown>): Promise<T> {
  return await call as T
}

// 客户端 Remote 装配：把 herdr 面板服务挂到 ctx.remote，并在 remote.herdr 就绪后交给 store。
//
// dsh 0.2.1-alpha.1 的两条约束（违反任一条都会让 web 入口 "did not activate"）：
// 1. ctx.remote.$mount() 只接受 { package, descriptors }（Remote contribution），不接受 host face；
// 2. ctx.remote 的命名空间受 cordis inject 保护：直接读 ctx.remote.herdr 会抛
//    'cannot get property "remote.herdr" without inject'，必须经 ctx.inject(['remote.herdr']) 取得。
import { TYPERT_REMOTE } from './typert-remote.ts'
import { setHerdrRemote, type HerdrRemote } from './remote.ts'

export interface RemoteMountCtx {
  remote?: { $mount(contribution: unknown): Promise<() => Promise<void>> }
  effect(register: () => (() => void) | void): unknown
  inject(deps: string[], callback: (scope: RemoteMountScope) => unknown): unknown
}

export interface RemoteMountScope {
  remote: { herdr: HerdrRemote }
  effect(register: () => (() => void) | void): unknown
}

export async function mountHerdrRemote(ctx: RemoteMountCtx, contribution: unknown = TYPERT_REMOTE): Promise<void> {
  if (!ctx.remote?.$mount) return
  const dispose = await ctx.remote.$mount(contribution)
  ctx.effect(() => () => { void dispose() })
  ctx.inject(['remote.herdr'], scope => {
    setHerdrRemote(scope.remote.herdr)
    scope.effect(() => () => setHerdrRemote(null))
  })
}

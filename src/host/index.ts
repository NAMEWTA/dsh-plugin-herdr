import type { Context } from '@deepseek-ai/cordis'
import type { Config as ConfigType } from './config.ts'
import * as provider from './provider.ts'
import * as runtime from './runtime.ts'

// cordis 通过模块导出的 Config 校验插件配置并填充默认值
export { Config } from './config.ts'

export const name = 'dsh-plugin-herdr'
export const inject: string[] = []

/**
 * 唯一的 host 入口。
 *
 * cordis 4 要求访问服务的 fiber 显式 inject 该服务，所以 ctx.herdr 的提供者
 * 与消费者仍是两个 fiber，但都作为本入口的子插件装配：先挂 provider（ctx.herdr、
 * preset），再挂 runtime（inject tools/herdr/jobs：工具、面板、事件）。
 * 两者都 await，入口在子插件就绪后才变为 ACTIVE（Loader.await / HMR）。
 * tools/jobs 晚到时 runtime 自动等待，不阻塞入口。
 */
export async function apply(ctx: Context, config: ConfigType) {
  await ctx.plugin({ name: provider.name, inject: [], apply: provider.apply }, config)
  await ctx.plugin({ name: runtime.name, inject: runtime.inject, apply: runtime.apply }, config)
}

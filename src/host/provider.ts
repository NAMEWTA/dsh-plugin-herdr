import type { Context } from '@deepseek-ai/cordis'
import { SocketHerdrClient } from './herdr/socket.ts'
import { resolveSocketPath, type Config } from './config.ts'
import { registerHerdrPreset } from './preset.ts'
import { createLogger } from './log.ts'

// cordis 通过模块导出的 Config 校验插件配置并填充默认值
export { Config } from './config.ts'

export const name = 'dsh-plugin-herdr-provider'

/**
 * 提供者插件：注册 ctx.herdr 服务（DESIGN.md §3.2 能力分层）。
 *
 * cordis 4 的服务解析要求：访问某服务的 fiber 必须显式 inject 该服务
 * （fiber.store 只快照 inject 声明的依赖），否则解析链走到根上下文会抛
 * "cannot get property X without inject"。因此提供者与消费者必须拆成
 * 两个插件：本模块提供服务，index.ts 作为消费者 inject ['tools', 'herdr']。
 *
 * 全量迁移后传输固定为 socket（CLI 传输已移除）。路径未配置时仍挂载
 * ctx.herdr，连接推迟到真正调用（Windows 默认没有 POSIX socket 路径）。
 *
 * 面板数据由消费者插件的 Typert Remote 暴露；本插件不注册 HTTP 路由。
 */
const UNCONFIGURED_SOCKET_PATH = process.platform === 'win32'
  ? '\\\\.\\pipe\\herdr-unconfigured'
  : '/tmp/herdr-unconfigured.sock'

export async function apply(ctx: Context, config: Config) {
  // Herdr mode is a registry preset. The registry removes it with this plugin.
  registerHerdrPreset(ctx, createLogger(ctx, 'preset'))

  const socketPath = resolveSocketPath(config)
  if (!socketPath) {
    createLogger(ctx, 'client').warn(
      'herdr socket path is unset; ctx.herdr is mounted and connects only after config.socketPath or HERDR_SOCKET_PATH is set',
    )
  }
  // Loader.await 只跟踪入口 fiber 的 inertia。herdr 由这个子插件提供；
  // 入口若先变成 ACTIVE，消费者会在 HMR 验收时停在 LOADING（fiber state 1）。
  await ctx.plugin(SocketHerdrClient, { socketPath: socketPath ?? UNCONFIGURED_SOCKET_PATH, timeoutMs: config.timeoutMs })
}

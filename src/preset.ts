import type { Context } from '@deepseek-ai/cordis'

export const HERDR_PRESET_ID = 'herdr'
export const HERDR_PRESET_NAME_ZH = 'Herdr 模式'
export const HERDR_PRESET_NAME_EN = 'Herdr mode'
export const HERDR_PRESET_DESCRIPTION_ZH = '会话绑定 Herdr——本对话视为运行在 Herdr 中的 Agent，状态实时显示在 Herdr 侧边栏，优先使用 herdr 工具操作 workspace / pane / agent。'
export const HERDR_PRESET_DESCRIPTION_EN = 'Binds the session to Herdr: the conversation runs as an Agent inside Herdr, its status shows live in the Herdr sidebar, and herdr tools operate workspace / pane / agent.'
/** Registry presets store one name. English surfaces still replace this text in the DOM. */
export const HERDR_PRESET_NAME = HERDR_PRESET_NAME_ZH
export const HERDR_PRESET_DESCRIPTION = HERDR_PRESET_DESCRIPTION_ZH

const HERDR_PERSONA = `你是运行在 Herdr 模式下的编码 Agent。优先使用 herdr_pane_run、herdr_agent_start、herdr_agent_prompt、herdr_agent_wait、herdr_pane_read 和 herdr_snapshot。不要为每条命令新建 pane，不要创建新的 workspace，也不要使用一次性 agent 执行参数。`

interface PresetRegistry {
  register(definition: {
    id: string
    name?: string
    description?: string
    plugins: Array<{ id?: string; name: string; config?: Record<string, unknown> }>
  }): Promise<() => Promise<void>> | (() => Promise<void>)
}

interface PresetLogger {
  info(message: string, ...args: unknown[]): void
  warn(message: string, ...args: unknown[]): void
}

/** Register the Herdr preset. The registry removes it when this plugin unloads. */
export function registerHerdrPreset(ctx: Context, logger: PresetLogger): () => void {
  let stop: (() => Promise<void>) | null = null
  ctx.inject(['agentPresets'], injected => {
    const registry = (injected as unknown as { agentPresets: PresetRegistry }).agentPresets
    void Promise.resolve(registry.register({
      id: HERDR_PRESET_ID,
      name: HERDR_PRESET_NAME,
      description: HERDR_PRESET_DESCRIPTION,
      plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: HERDR_PERSONA } },
        { id: 'herdr-session-mode', name: '@namewta/dsh-plugin-herdr/session-mode', config: { paneId: '', label: '' } },
      ],
    })).then(disposer => {
      stop = disposer
      logger.info('preset "%s" registered', HERDR_PRESET_ID)
    }).catch(error => {
      logger.warn('preset registration failed: %s', error instanceof Error ? error.message : String(error))
    })
  })
  return () => { void stop?.() }
}

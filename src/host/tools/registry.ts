import type { Context } from '@deepseek-ai/cordis'
import { registerSnapshot } from './snapshot.ts'
import { registerAgentList } from './agent-list.ts'
import { registerPaneRun } from './pane-run.ts'
import { registerAgentWait } from './agent-wait.ts'
import { registerWorkspaceCreate } from './workspace-create.ts'
import { registerPaneSplit } from './pane-split.ts'
import { registerPaneSendKeys } from './pane-send-keys.ts'
import { registerPaneRead } from './pane-read.ts'
import { registerPaneLayout } from './pane-layout.ts'
import { registerLayoutApply } from './layout-apply.ts'
import { registerAgentPrompt } from './agent-prompt.ts'
import { registerAgentStart } from './agent-start.ts'
import { registerAgentExplain } from './agent-explain.ts'
import { registerAgentSendKeys } from './agent-send-keys.ts'
import { registerNotification } from './notification.ts'
import { registerWorkspaceClose } from './workspace-close.ts'
import { registerPaneClose } from './pane-close.ts'
import { registerWorkspaceRename } from './workspace-rename.ts'
import { registerPaneRename } from './pane-rename.ts'

/** 工具注册所需的运行期选项（来自插件 Config）。 */
export interface HerdrToolOptions {
  allowBackground: boolean
}

/** 一个 herdr_* 工具：名称 + 注册函数（注册即挂到 ctx.tools，随 fiber 释放）。 */
export interface HerdrToolEntry {
  readonly name: string
  readonly register: (ctx: Context, opts: HerdrToolOptions) => void
}

/** 全部 herdr_* 工具的唯一清单；contract 测试遍历它。 */
export const HERDR_TOOLS: readonly HerdrToolEntry[] = [
  { name: 'herdr_snapshot', register: ctx => registerSnapshot(ctx) },
  { name: 'herdr_agent_list', register: ctx => registerAgentList(ctx) },
  { name: 'herdr_pane_run', register: (ctx, opts) => registerPaneRun(ctx, { allowBackground: opts.allowBackground }) },
  { name: 'herdr_agent_wait', register: (ctx, opts) => registerAgentWait(ctx, { allowBackground: opts.allowBackground }) },
  { name: 'herdr_workspace_create', register: ctx => registerWorkspaceCreate(ctx) },
  { name: 'herdr_pane_split', register: ctx => registerPaneSplit(ctx) },
  { name: 'herdr_pane_send_keys', register: ctx => registerPaneSendKeys(ctx) },
  { name: 'herdr_pane_read', register: ctx => registerPaneRead(ctx) },
  { name: 'herdr_pane_layout', register: ctx => registerPaneLayout(ctx) },
  { name: 'herdr_layout_apply', register: ctx => registerLayoutApply(ctx) },
  { name: 'herdr_agent_prompt', register: ctx => registerAgentPrompt(ctx) },
  { name: 'herdr_agent_start', register: ctx => registerAgentStart(ctx) },
  { name: 'herdr_agent_explain', register: ctx => registerAgentExplain(ctx) },
  { name: 'herdr_agent_send_keys', register: ctx => registerAgentSendKeys(ctx) },
  { name: 'herdr_notification', register: ctx => registerNotification(ctx) },
  { name: 'herdr_workspace_close', register: ctx => registerWorkspaceClose(ctx) },
  { name: 'herdr_pane_close', register: ctx => registerPaneClose(ctx) },
  { name: 'herdr_workspace_rename', register: ctx => registerWorkspaceRename(ctx) },
  { name: 'herdr_pane_rename', register: ctx => registerPaneRename(ctx) },
]

export function registerHerdrTools(ctx: Context, opts: HerdrToolOptions): void {
  for (const tool of HERDR_TOOLS) tool.register(ctx, opts)
}

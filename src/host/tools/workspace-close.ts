import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { assertCanClose } from '../application/resources.ts'
import { throwIfAborted } from '../../core/abort.ts'
import { requireNonEmpty, toToolError } from './shared.ts'
export function registerWorkspaceClose(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'herdr_workspace_close', description: 'Close a workspace and all its panes (destructive). Refuses active session workspaces; failed preflight never grants permission.',
    parameters: { workspace_id: { type: 'string', required: true, description: 'Workspace to close' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true }, closed_panes: { type: 'number', required: true } } }, render: (_args, value) => [{ type: 'text', text: `workspace closed (${(value as { closed_panes: number }).closed_panes} panes observed before close)` }] },
    async execute(args, exec) {
      try {
        requireNonEmpty(args.workspace_id, 'workspace_id')
        throwIfAborted(exec.signal)
        const snapshot = await ctx.herdr.snapshot(exec.signal)
        await assertCanClose('workspace', args.workspace_id, async () => snapshot)
        throwIfAborted(exec.signal)
        await ctx.herdr.workspaceClose(args.workspace_id, exec.signal)
        return { ok: true, closed_panes: snapshot.panes.filter(pane => pane.workspace_id === args.workspace_id).length }
      } catch (error) { toToolError(error) }
    },
  }))
}

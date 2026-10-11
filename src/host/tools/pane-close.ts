import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { assertCanClose } from '../application/resources.ts'
import { throwIfAborted } from '../../core/abort.ts'
import { requireNonEmpty, toToolError } from './shared.ts'
export function registerPaneClose(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'herdr_pane_close', description: 'Close a Herdr pane and its processes (destructive). Refuses panes hosting active DSH sessions.',
    parameters: { pane_id: { type: 'string', required: true, description: 'Pane to close' } },
    output: { schema: { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean', required: true } } }, render: () => [{ type: 'text', text: 'pane closed' }] },
    async execute(args, exec) {
      try {
        requireNonEmpty(args.pane_id, 'pane_id')
        throwIfAborted(exec.signal)
        await assertCanClose('pane', args.pane_id, () => ctx.herdr.snapshot(exec.signal))
        throwIfAborted(exec.signal)
        await ctx.herdr.paneClose(args.pane_id, exec.signal)
        return { ok: true }
      } catch (error) { toToolError(error) }
    },
  }))
}

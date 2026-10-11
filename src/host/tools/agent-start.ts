import { defineTool } from '@deepseek-ai/dsh-tools'
import type { Context } from '@deepseek-ai/cordis'
import { getBindingRegistry } from '../binding-registry.ts'
import { launchAgent } from '../application/agent-launch.ts'
import { toToolError } from './shared.ts'
export function registerAgentStart(ctx: Context) {
  ctx.tools.register(defineTool({
    name: 'herdr_agent_start',
    description: 'Start an interactive coding agent in a Herdr pane. By default create a sibling pane in this session workspace. Use configuration arguments only; submit tasks afterward with herdr_agent_prompt. A timeout may mean startup occurred: inspect before retrying.',
    parameters: {
      kind: { type: 'string', required: true, description: 'Installed agent kind, e.g. pi, codex, claude' },
      name: { type: 'string', description: 'Unique lowercase name; defaults to the first free <kind>-<n>' },
      pane_id: { type: 'string', description: 'Existing shell pane; defaults to a sibling of this session pane' },
      args: { type: 'array', items: { type: 'string' }, description: 'Native configuration flags only; no task text or one-shot flags' },
      timeout_ms: { type: 'number', description: 'Integer startup budget > 3000 and <= 300000 ms; default 30000' },
    },
    output: {
      schema: { type: 'object', additionalProperties: false, properties: { pane_id: { type: 'string' }, workspace_id: { type: 'string' }, agent: { type: 'string' }, display_agent: { type: 'string' }, status: { type: 'string' }, name: { type: 'string' }, kind: { type: 'string' } } },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      try {
        const binding = exec.agent ? getBindingRegistry().get(exec.agent.id) : undefined
        const info = await launchAgent(ctx.herdr, args, binding?.pane_id, exec.signal)
        return {
          kind: args.kind,
          ...(info.pane_id ? { pane_id: info.pane_id } : {}), ...(info.workspace_id ? { workspace_id: info.workspace_id } : {}),
          ...(info.agent != null ? { agent: info.agent } : {}), ...(info.display_agent != null ? { display_agent: info.display_agent } : {}),
          ...(info.agent_status ? { status: info.agent_status } : {}), ...(info.name != null ? { name: info.name } : {}),
        }
      } catch (error) { toToolError(error) }
    },
  }))
}

import Schema from '@deepseek-ai/schemastery'
import { homedir } from 'node:os'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import { WorkbenchError } from '@workbench/contracts'
export interface HostConfig { dataDirectory?: string; socket?: string; session: string; binary?: string; workspaceRoot?: string; readOnly: boolean; pollMs: number; toolsEnabled: boolean; maxObservers: number; maxControllers: number; maxProcesses: number }
export const Config: Schema<HostConfig> = Schema.object({
  dataDirectory: Schema.string(), socket: Schema.string(), session: Schema.string().default('default'), binary: Schema.string(),
  workspaceRoot: Schema.string(), readOnly: Schema.boolean().default(false), pollMs: Schema.number().min(500).max(30000).default(3000), toolsEnabled: Schema.boolean().default(true),
  maxObservers: Schema.number().min(0).max(64).default(8), maxControllers: Schema.number().min(0).max(16).default(2), maxProcesses: Schema.number().min(1).max(128).default(16),
})
const validator = z.object({dataDirectory:z.string().optional(),socket:z.string().optional(),session:z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default('default'),binary:z.string().optional(),workspaceRoot:z.string().optional(),readOnly:z.boolean().default(false),pollMs:z.number().int().min(500).max(30000).default(3000),toolsEnabled:z.boolean().default(true),maxObservers:z.number().int().min(0).max(64).default(8),maxControllers:z.number().int().min(0).max(16).default(2),maxProcesses:z.number().int().min(1).max(128).default(16)}).strict()
export function resolveConfig(input: unknown, profileDirectory: string, env: NodeJS.ProcessEnv = process.env) {
  const config = validator.parse(input)
  const socket = config.socket ?? env.WORKBENCH_HERDR_SOCKET ?? (config.session === 'default' ? join(homedir(),'.config','herdr','herdr.sock') : join(homedir(),'.config','herdr','sessions',config.session,'herdr.sock'))
  const dataDirectory = config.dataDirectory ?? join(profileDirectory,'workbench')
  const workspaceRoot = config.workspaceRoot ?? process.cwd()
  const binary = config.binary ?? env.WORKBENCH_HERDR_BINARY
  if (![socket,dataDirectory,workspaceRoot].every(isAbsolute) || (binary && !isAbsolute(binary))) throw new WorkbenchError('INVALID_REQUEST')
  return {...config,socket,dataDirectory,workspaceRoot,binary}
}

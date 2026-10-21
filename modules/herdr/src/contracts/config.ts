import { z } from 'zod'
export const terminalConfigSchema = z.object({
  enabled: z.boolean().default(true),
  binPath: z.string().min(1).optional(),
  maxObservers: z.number().int().min(0).max(64).default(8),
  maxControllers: z.number().int().min(0).max(16).default(2),
  maxProcesses: z.number().int().min(1).max(128).default(16),
  controllerIdleMs: z.number().int().min(1000).max(3_600_000).default(300_000),
  disconnectGraceMs: z.number().int().min(100).max(30_000).default(1000),
  maxDecodedFrameBytes: z.number().int().min(1024).max(33_554_432).default(8_388_608),
  maxNdjsonLineBytes: z.number().int().min(1024).max(50_331_648).default(12_582_912),
  replayBufferBytes: z.number().int().min(1024).max(100_663_296).default(8_388_608),
}).strict()
export type TerminalSessionConfig = z.infer<typeof terminalConfigSchema>
export const connectionConfigSchema = z.object({
  id: z.literal('local').default('local'),
  socketPath: z.string().min(1),
  session: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).default('default'),
  timeoutMs: z.number().int().min(500).max(30_000).default(5000),
  pollMs: z.number().int().min(500).max(30_000).default(3000),
  rootDirectory: z.string().min(1),
  allowedAgentKinds: z.array(z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/)).max(16).default(['claude', 'codex']),
  terminal: terminalConfigSchema.default(() => terminalConfigSchema.parse({})),
}).strict()
export type ConnectionConfig = z.infer<typeof connectionConfigSchema>

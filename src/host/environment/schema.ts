import { z } from 'zod'
import type { HerdrEnvironmentReport } from '../../core/environment.ts'

/** The new read-only Remote has a real wire codec instead of an unknown placeholder. */
export const environmentSchema: z.ZodType<HerdrEnvironmentReport> = z.strictObject({
  checkedAt: z.number().finite(),
  host: z.strictObject({ platform: z.string(), arch: z.string(), hostname: z.string(), nodeVersion: z.string(), wsl: z.boolean() }),
  supported: z.boolean(),
  cli: z.strictObject({ state: z.enum(['available', 'missing', 'unusable', 'unsupported']), path: z.string().nullable(), version: z.string().nullable() }),
  packageManagers: z.strictObject({ npm: z.boolean(), pnpm: z.boolean() }),
  connection: z.strictObject({ socketPath: z.string().nullable(), session: z.string().nullable(), running: z.boolean(), version: z.string().nullable(), protocol: z.number().int().nullable() }),
  terminal: z.strictObject({ enabled: z.boolean(), available: z.boolean() }),
  verified: z.strictObject({ version: z.string(), protocol: z.number().int() }),
})

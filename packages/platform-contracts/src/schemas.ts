import { z } from 'zod'
export const localizedSchema=z.object({zh:z.string(),en:z.string()}).strict()
export const contributionSchema=z.object({id:z.string(),kind:z.enum(['route','command','settings','widget']),title:localizedSchema,capability:z.string(),order:z.number().optional()}).strict()
export const manifestSchema=z.object({id:z.string(),version:z.string(),platformApi:z.literal(1),title:localizedSchema,description:localizedSchema,dependencies:z.array(z.string()),capabilities:z.array(z.string()),contributions:z.array(contributionSchema)}).strict()
export const moduleStatusSchema=z.object({manifest:manifestSchema,state:z.enum(['registered','starting','active','draining','stopped','failed','disposed']),error:z.string().optional(),activeRequests:z.number().int()}).strict()
export const platformSnapshotSchema=z.object({apiVersion:z.literal(1),build:z.object({version:z.string(),sha:z.string()}),modules:z.array(moduleStatusSchema),capabilities:z.array(z.string()),contributions:z.array(contributionSchema)}).strict()
export const auditSchema=z.object({at:z.number(),actor:z.string(),client:z.string(),module:z.string(),operation:z.string(),requestId:z.string(),outcome:z.enum(['accepted','succeeded','rejected','unknown']),durationMs:z.number(),code:z.string().optional(),target:z.string().optional()}).strict()
export const requestSchema=z.object({operation:z.string().min(3).max(128),requestId:z.string().regex(/^[a-zA-Z0-9_-]{8,128}$/),input:z.json()}).strict()
export const failureSchema=z.object({code:z.string(),requestId:z.string(),retryable:z.boolean(),issues:z.array(z.object({path:z.string(),message:z.string()})).optional(),detail:z.string().max(500).optional()}).strict()
export const resultSchema=z.discriminatedUnion('ok',[z.object({ok:z.literal(true),requestId:z.string(),data:z.json()}).strict(),z.object({ok:z.literal(false),error:failureSchema}).strict()])
export const platformEventSchema=z.object({type:z.enum(['invalidate','modules','gap','heartbeat']),moduleId:z.string(),revision:z.number().int()}).strict()
export const preferencesSchema=z.object({version:z.literal(1),locale:z.enum(['zh','en']),theme:z.enum(['system','light','dark']),density:z.enum(['comfortable','compact'])}).strict()
export type Preferences=z.infer<typeof preferencesSchema>
export const platformOperations={
  'platform.snapshot':{kind:'query',capability:'platform.read',input:z.object({}).strict(),output:platformSnapshotSchema},
  'platform.module.set':{kind:'action',capability:'platform.manage',input:z.object({id:z.string().regex(/^[a-z][a-z0-9-]{0,63}$/),enabled:z.boolean(),confirmed:z.literal(true)}).strict(),output:z.object({}).strict()},
  'platform.audit':{kind:'query',capability:'platform.manage',input:z.object({limit:z.number().int().min(1).max(200).default(100)}).strict(),output:z.array(auditSchema)},
} as const

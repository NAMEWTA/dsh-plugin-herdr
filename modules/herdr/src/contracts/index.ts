import { z } from 'zod'
export const stateSchema = z.enum(['working', 'blocked', 'idle', 'done', 'unknown'])
export type AgentState = z.infer<typeof stateSchema>
export const resourceSchema = z.object({
  connectionId: z.literal('local'), session: z.string().min(1), epoch: z.string().min(1),
  kind: z.enum(['workspace', 'tab', 'pane']), id: z.string().min(1).max(128), instance: z.string().min(1),
}).strict()
export type ResourceRef = z.infer<typeof resourceSchema>
export const paneSchema = z.object({
  ref: resourceSchema, workspaceId: z.string(), tabId: z.string(), terminalId: z.string(),
  label: z.string(), title: z.string(), agent: z.string().nullable(), state: stateSchema,
  stateSequence: z.number().int().nonnegative(), cwd: z.string().nullable(), revision: z.number().int().nonnegative(),
  ownership: z.enum(['external', 'created', 'adopted']),
}).strict()
export type Pane = z.infer<typeof paneSchema>
export const workspaceSchema = z.object({ref: resourceSchema, label: z.string(), paneCount: z.number().int(), tabCount: z.number().int(), ownership: z.enum(['external', 'created', 'adopted'])}).strict()
export type Workspace = z.infer<typeof workspaceSchema>
export const tabSchema = z.object({ref: resourceSchema, workspaceId: z.string(),label: z.string(),ownership:z.enum(['external','created','adopted'])}).strict()
export const snapshotSchema = z.object({
  connectionId: z.literal('local'), session: z.string(), epoch: z.string(),
  revision: z.number().int(), sampledAt: z.number().nonnegative(), receivedAt: z.number().nonnegative(),
  connection: z.enum(['connecting','online','offline','incompatible']), stale: z.boolean(),
  eventStream: z.enum(['connected','polling']), eventGap: z.boolean(),
  version: z.string().nullable(), protocol: z.number().nullable(), error: z.string().nullable(),
  workspaces: z.array(workspaceSchema),tabs: z.array(tabSchema),panes: z.array(paneSchema),
  activity: z.array(z.object({id:z.string(),at:z.number(),type:z.string(),resourceId:z.string().nullable()})),
}).strict()
export type HerdrSnapshot = z.infer<typeof snapshotSchema>
export const environmentSchema = z.object({
  platform: z.string(), arch: z.string(), binary: z.string().nullable(), version: z.string().nullable(),
  installation: z.enum(['installed','missing','unknown']), connected: z.boolean(), verified: z.boolean(),
  socketPath: z.string(), session: z.string(), rootDirectory: z.string(),
  streaming: z.boolean(), supported: z.boolean(), error: z.string().nullable(),
  bridgeProcesses: z.number().int(), observers: z.number().int(), controllers:z.number().int(),
  limits:z.object({maxObservers:z.number(),maxControllers:z.number(),maxProcesses:z.number()}),
  agentKinds:z.array(z.string()),
  process:z.object({pid:z.number().int(),startedAt:z.number(),sampledAt:z.number(),cpuPercent:z.number().nullable(),rssBytes:z.number().int(),source:z.literal('node-process')}),
  replayBytes:z.number().int(),subscriptions:z.number().int(),closingProcesses:z.number().int(),
}).strict()
export type EnvironmentReport = z.infer<typeof environmentSchema>
export const inspectorCommandSchema = z.object({
  id:z.enum(['snapshot','pane','layout','process','output','agent']), command:z.string().max(16384),
}).strict()
export const paneInspectionSchema = z.object({
  sampledAt:z.number(),pane:paneSchema,workspace:workspaceSchema,tab:tabSchema,
  socketPath:z.string(),session:z.string(),binary:z.string().nullable(),
  commands:z.array(inspectorCommandSchema).max(6),
}).strict()
export type PaneInspection = z.infer<typeof paneInspectionSchema>
export const empty = z.object({}).strict()
const label = z.string().trim().min(1).max(120).refine(v=> !/[\x00-\x1f\x7f]/.test(v), 'Control characters are not allowed')
const confirmed = z.literal(true)
export const terminalOpenSchema = z.object({ref:resourceSchema, mode:z.enum(['observe','control']), cols:z.number().int().min(1).max(400), rows:z.number().int().min(1).max(200), takeover:z.boolean().default(false), confirmed:z.boolean().default(false)}).strict()
export const terminalLeaseSchema = z.object({leaseId:z.string(),sessionId:z.string(),generation:z.number().int(),mode:z.enum(['observe','control']),ref:resourceSchema,expiresAt:z.number()}).strict()
export type TerminalLease = z.infer<typeof terminalLeaseSchema>
export const terminalAttachSchema = z.object({leaseId:z.string().min(16).max(128),cursor:z.object({generation:z.number().int().positive(),afterSeq:z.number().int().nonnegative()}).optional()}).strict()
export const terminalInputSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('input'),bytes:z.string().max(87384),sequence:z.number().int().positive()}).strict(),
  z.object({type:z.literal('resize'),cols:z.number().int().min(1).max(400),rows:z.number().int().min(1).max(200)}).strict(),
  z.object({type:z.literal('scroll'),direction:z.enum(['up','down']),lines:z.number().int().min(1).max(10000)}).strict(),
  z.object({type:z.literal('release')}).strict(),
])
export type TerminalInput = z.infer<typeof terminalInputSchema>
export const terminalEventSchema = z.discriminatedUnion('type',[
  z.object({type:z.literal('ready'),sessionId:z.string(),mode:z.enum(['observe','control']),generation:z.number(),resumed:z.boolean(),afterSeq:z.number()}),
  z.object({type:z.literal('frame'),generation:z.number(),seq:z.number(),full:z.boolean(),width:z.number(),height:z.number(),bytes:z.string().max(44739244)}),
  z.object({type:z.literal('closed'),sessionId:z.string(),reason:z.string().optional(),generation:z.number().optional()}),
  z.object({type:z.literal('conflict'),sessionId:z.string(),message:z.string(),generation:z.number().optional()}),
  z.object({type:z.literal('error'),sessionId:z.string(),code:z.string(),message:z.string(),retryable:z.boolean(),generation:z.number().optional()}),
  z.object({type:z.literal('ack'),sequence:z.number().int().positive()}),
])
export type TerminalEvent = z.infer<typeof terminalEventSchema>
export const bindingSchema = z.object({conversationId:z.string(),ref:resourceSchema.nullable()}).strict()
export const catalog = {
  'herdr.snapshot': {kind:'query',capability:'herdr.read',input:empty,output:snapshotSchema},
  'herdr.pane.inspect': {kind:'query',capability:'herdr.read',input:z.object({ref:resourceSchema}).strict(),output:paneInspectionSchema},
  'herdr.environment': {kind:'query',capability:'herdr.read',input:empty,output:environmentSchema},
  'herdr.server.start': {kind:'action',capability:'herdr.settings',input:z.object({confirmed}).strict(),output:environmentSchema},
  'herdr.workspace.create': {kind:'action',capability:'herdr.manage',input:z.object({label,cwd:z.string().min(1).max(4096)}).strict(),output:resourceSchema},
  'herdr.conversation.create': {kind:'action',capability:'herdr.manage',input:z.object({conversationId:z.string().min(1).max(128),label,cwd:z.string().min(1).max(4096),confirmed}).strict(),output:bindingSchema},
  'herdr.tab.create': {kind:'action',capability:'herdr.manage',input:z.object({ref:resourceSchema,label}).strict(),output:resourceSchema},
  'herdr.resource.rename': {kind:'action',capability:'herdr.manage',input:z.object({ref:resourceSchema,label}).strict(),output:empty},
  'herdr.resource.close': {kind:'action',capability:'herdr.manage',input:z.object({ref:resourceSchema,confirmed}).strict(),output:empty},
  'herdr.resource.adopt': {kind:'action',capability:'herdr.manage',input:z.object({ref:resourceSchema,confirmed}).strict(),output:empty},
  'herdr.pane.split': {kind:'action',capability:'herdr.manage',input:z.object({ref:resourceSchema,direction:z.enum(['horizontal','vertical'])}).strict(),output:resourceSchema},
  'herdr.agent.start': {kind:'action',capability:'herdr.control',input:z.object({ref:resourceSchema,kind:z.string().min(1).max(64),confirmed}).strict(),output:empty},
  'herdr.terminal.open': {kind:'action',capability:'herdr.observe',input:terminalOpenSchema,output:terminalLeaseSchema},
  'herdr.terminal.release': {kind:'action',capability:'herdr.observe',input:z.object({leaseId:z.string().min(16).max(128)}).strict(),output:empty},
  'herdr.binding.get': {kind:'query',capability:'herdr.read',input:z.object({conversationId:z.string().min(1).max(128)}).strict(),output:bindingSchema},
  'herdr.binding.set': {kind:'action',capability:'herdr.manage',input:z.object({conversationId:z.string().min(1).max(128),ref:resourceSchema.nullable(),confirmed}).strict(),output:bindingSchema},
} as const
export type OperationId = keyof typeof catalog
export type Input<K extends OperationId> = z.input<(typeof catalog)[K]['input']>
export type Output<K extends OperationId> = z.output<(typeof catalog)[K]['output']>

import { stat } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { WorkbenchError } from '@workbench/contracts'
import { socketRequest, socketSubscribe } from './transport.ts'
import { HerdrError } from '../common/errors.ts'
import type { SessionSnapshot } from './protocol.generated.ts'
import type { ConnectionConfig } from '../../contracts/config.ts'
import { z } from 'zod'
import { canonicalizeStatus } from '../../domain/status.ts'
const state=z.preprocess(value=>canonicalizeStatus(value), z.enum(['idle','working','blocked','done','unknown']))
const rawPane=z.object({pane_id:z.string(),workspace_id:z.string(),tab_id:z.string(),terminal_id:z.string(),revision:z.number().int(),agent_status:state,agent:z.string().nullish(),label:z.string().nullish(),title:z.string().nullish(),terminal_title_stripped:z.string().nullish(),cwd:z.string().nullish(),foreground_cwd:z.string().nullish(),focused:z.boolean().default(false)}).passthrough()
const rawAgent=rawPane.omit({label:true}).extend({name:z.string().nullish(),state_change_seq:z.number().int().optional()})
const rawWorkspace=z.object({workspace_id:z.string(),label:z.string(),pane_count:z.number().int(),tab_count:z.number().int(),active_tab_id:z.string(),agent_status:state,focused:z.boolean(),number:z.number()}).passthrough()
const rawTab=z.object({tab_id:z.string(),workspace_id:z.string(),label:z.string(),pane_count:z.number().int(),agent_status:state,focused:z.boolean(),number:z.number()}).passthrough()
const rawSnapshot=z.object({version:z.string(),protocol:z.number().int(),panes:z.array(rawPane),agents:z.array(rawAgent),workspaces:z.array(rawWorkspace),tabs:z.array(rawTab),layouts:z.array(z.unknown()).default([])}).passthrough()
export interface HerdrPort {
  snapshot(signal?:AbortSignal):Promise<SessionSnapshot>
  identity():Promise<string>
  request(method:string,params:unknown,signal?:AbortSignal,mutation?:boolean,timeoutMs?:number):Promise<unknown>
  subscribe(onEvent:(event:unknown)=>void,onClose:()=>void,signal:AbortSignal):Promise<()=>void>
}
export class LocalHerdrClient implements HerdrPort {
  private readonly incarnation=randomUUID()
  constructor(private readonly config:ConnectionConfig) {}
  async request(method:string,params:unknown,signal?:AbortSignal,mutation=false,timeoutMs?:number):Promise<unknown> {
    try {return (await socketRequest(this.config,method,params,{signal,...timeoutMs?{timeoutMs}:{}})).result}
    catch(error) {
      const detail=error instanceof HerdrError&&error.message?error.message.slice(0,500):undefined
      if (error instanceof HerdrError && error.code==='HERDR_ERROR') throw new WorkbenchError('INVALID_REQUEST', detail)
      if (signal?.aborted&&!mutation) throw new WorkbenchError('CANCELLED')
      throw new WorkbenchError(mutation?'OPERATION_OUTCOME_UNKNOWN':'CONNECTION_UNAVAILABLE', detail)
    }
  }
  async snapshot(signal?:AbortSignal):Promise<SessionSnapshot> {
    const result=await this.request('session.snapshot',{},signal)
    const wrapper=z.object({snapshot:rawSnapshot}).safeParse(result)
    if (!wrapper.success) throw new WorkbenchError('CONNECTION_UNAVAILABLE')
    // Runtime validation above covers every field consumed by this module. Layouts are not consumed.
    return wrapper.data.snapshot as SessionSnapshot
  }
  async identity():Promise<string> {
    try {const s=await stat(this.config.socketPath,{bigint:true});if(!s.isSocket())throw new Error('not socket');return `${this.incarnation}:${s.dev}:${s.ino}:${s.ctimeNs}`}
    catch {throw new WorkbenchError('CONNECTION_UNAVAILABLE')}
  }
  async subscribe(onEvent:(event:unknown)=>void,onClose:()=>void,signal:AbortSignal):Promise<()=>void> {
    const socket=await socketSubscribe(this.config,['workspace.created','workspace.updated','workspace.metadata_updated','workspace.renamed','workspace.closed','tab.created','tab.closed','tab.renamed','pane.created','pane.closed','pane.updated','pane.exited','layout.updated'].map(type=>({type})),onEvent,signal)
    socket.once('close',onClose)
    return ()=>{socket.removeListener('close',onClose);socket.destroy()}
  }
}

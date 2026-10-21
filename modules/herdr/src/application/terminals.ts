import { randomBytes } from 'node:crypto'
import { WorkbenchError, requireCapability, type Principal } from '@workbench/contracts'
import type { OperationContext } from '@workbench/sdk'
import type { z } from 'zod'
import { terminalOpenSchema, terminalAttachSchema, type TerminalLease, type TerminalInput, type TerminalEvent } from '../contracts/index.ts'
import { isInputBase64 } from '../contracts/terminal.ts'
import { TerminalSessionManager } from '../infrastructure/terminal/manager.ts'
import { TerminalSessionError } from '../infrastructure/terminal/errors.ts'
import { BoundedAsyncQueue } from '../infrastructure/common/async-queue.ts'
import { resourceKey } from '../domain/selectors.ts'
import type { HerdrReadModel } from './read-model.ts'
interface Lease { value:TerminalLease; owner:string; client:string; signal:AbortSignal; cleanup:()=>void; lastInput:number; streams:number; revoked:boolean }
/** Capability tokens are returned only to their admitted client and never placed in URLs or logs. */
export class TerminalLeases {
  private readonly leases=new Map<string,Lease>()
  private readonly locks=new Map<string,Promise<unknown>>()
  private closed=false
  constructor(readonly manager:TerminalSessionManager,private readonly model:HerdrReadModel,private readonly enabled:boolean) {}
  async open(request:z.infer<typeof terminalOpenSchema>,ctx:OperationContext):Promise<TerminalLease> {
    if(this.closed||!this.enabled)throw new WorkbenchError('MODULE_UNAVAILABLE')
    if(request.ref.kind!=='pane')throw new WorkbenchError('INVALID_REQUEST')
    const key=resourceKey(request.ref),prior=this.locks.get(key)??Promise.resolve()
    const work=prior.catch(()=>{}).then(async()=>{
      if(this.closed||ctx.signal.aborted)throw new WorkbenchError('CANCELLED')
      requireCapability(ctx.principal,'herdr.observe')
      if(request.mode==='control'){
        requireCapability(ctx.principal,'herdr.control')
        if(!request.confirmed)throw new WorkbenchError('FORBIDDEN')
      }
      await this.model.assert(request.ref,request.mode==='control')
      const active=[...this.leases.values()].filter(l=>!l.revoked&&l.value.mode==='control'&&resourceKey(l.value.ref)===key)
      if(request.mode==='control'&&active.length){
        if(!request.takeover||!request.confirmed)throw new WorkbenchError('LEASE_CONFLICT')
        for(const lease of active)await this.revoke(lease)
      }
      if(ctx.signal.aborted)throw new WorkbenchError('CANCELLED')
      let start:{sessionId:string;generation:number}
      try {start=this.manager.start({pane_id:request.ref.id,mode:request.mode,cols:request.cols,rows:request.rows,takeover:request.takeover})}
      catch(error){throw mapTerminalError(error)}
      const value:TerminalLease={leaseId:randomBytes(24).toString('base64url'),sessionId:start.sessionId,generation:start.generation,mode:request.mode,ref:request.ref,expiresAt:Date.now()+3_600_000}
      const abort=()=>{void this.revoke(lease).catch(()=>{})}
      // principal.signal is the client lifetime, not the opening RPC lifetime.
      const lease:Lease={value,owner:ctx.principal.id,client:ctx.principal.clientId,signal:ctx.principal.signal,cleanup:()=>ctx.principal.signal.removeEventListener('abort',abort),lastInput:0,streams:0,revoked:false}
      ctx.principal.signal.addEventListener('abort',abort,{once:true});this.leases.set(value.leaseId,lease)
      if(ctx.principal.signal.aborted){await this.revoke(lease);throw new WorkbenchError('AUTH_REQUIRED')}
      return value
    })
    this.locks.set(key,work)
    try{return await work}finally{if(this.locks.get(key)===work)this.locks.delete(key)}
  }
  async release(id:string,principal:Principal):Promise<void> {const lease=this.leases.get(id);if(!lease)return;this.assertOwner(lease,principal);await this.revoke(lease)}
  async dispose():Promise<void> {
    this.closed=true
    await Promise.allSettled([...this.locks.values()])
    const outcomes=await Promise.allSettled([...this.leases.values()].map(l=>this.revoke(l)))
    await this.manager.dispose()
    if(outcomes.some(v=>v.status==='rejected')||this.manager.processCount)throw new WorkbenchError('MODULE_DRAIN_FAILED')
  }
  async reconcile():Promise<void> {
    const s=this.model.snapshot(),keys=new Set(s.panes.map(p=>resourceKey(p.ref)))
    for(const lease of this.leases.values())if(s.stale||!keys.has(resourceKey(lease.value.ref))||Date.now()>lease.value.expiresAt)await this.revoke(lease)
  }
  async *stream(request:z.infer<typeof terminalAttachSchema>,ctx:OperationContext,uplink:AsyncIterable<TerminalInput>):AsyncGenerator<TerminalEvent> {
    const lease=this.leases.get(request.leaseId)
    if(!lease)throw new WorkbenchError('LEASE_EXPIRED')
    this.assertOwner(lease,ctx.principal)
    if(lease.streams)throw new WorkbenchError('LEASE_CONFLICT')
    await this.model.assert(lease.value.ref)
    const queue=new BoundedAsyncQueue<TerminalEvent>(256,16*1024*1024,e=>e.type==='frame'?e.bytes.length:512)
    const abort=()=>queue.close()
    ctx.signal.addEventListener('abort',abort,{once:true})
    lease.streams++
    let unlisten:()=>void=()=>{}
    const cleanup=()=>{unlisten();ctx.signal.removeEventListener('abort',abort);queue.close();lease.streams--}
    try {
      unlisten=this.manager.subscribe(lease.value.sessionId,request.cursor,event=>{
        // A terminal that closed before subscribe has no future frames. End immediately,
        // rather than leaving a browser waiting forever after a one-off error event.
        if(event.type==='closed'){queue.close(new WorkbenchError('LEASE_EXPIRED'));return}
        if(event.type==='conflict'){queue.close(new WorkbenchError('LEASE_CONFLICT'));return}
        if(event.type==='error'){
          if(!event.retryable){queue.close(new WorkbenchError(event.code==='terminal_session_input_backpressure'?'INPUT_BACKPRESSURE':'LEASE_EXPIRED'));return}
          event={...event,message:event.code}
        }
        if(!queue.push(event))void this.revoke(lease).catch(()=>{})
      })
      const consume=(async()=>{
        try {
          for await(const command of uplink){
            if(ctx.signal.aborted)break
            this.assertOwner(lease,ctx.principal)
            if(command.type==='release'){await this.revoke(lease);queue.close();break}
            if(command.type==='input'||command.type==='scroll'){
              requireCapability(ctx.principal,'herdr.control')
              if(lease.value.mode!=='control')throw new WorkbenchError('FORBIDDEN')
            }
            // Resource identity is checked against fresh authority before every write; input is never replayed.
            await this.model.assert(lease.value.ref,lease.value.mode==='control')
            this.assertOwner(lease,ctx.principal)
            if(command.type==='input'){
              if(!isInputBase64(command.bytes)||command.sequence!==lease.lastInput+1)throw new WorkbenchError('INVALID_REQUEST')
              this.manager.writeCommand(lease.value.sessionId,JSON.stringify({type:'terminal.input',bytes:command.bytes}))
              lease.lastInput=command.sequence
              queue.push({type:'ack',sequence:command.sequence})
            }else if(command.type==='resize')this.manager.writeCommand(lease.value.sessionId,JSON.stringify({type:'terminal.resize',cols:command.cols,rows:command.rows}))
            else this.manager.writeCommand(lease.value.sessionId,JSON.stringify({type:'terminal.scroll',direction:command.direction,lines:command.lines}))
          }
        }catch(error){queue.close(mapTerminalError(error))}
      })()
      void consume.catch(()=>{})
      for await(const event of queue){this.assertOwner(lease,ctx.principal);yield event}
    }finally{
      cleanup()
      // A dropped transport revokes control. Reconnecting never silently restores write authority.
      await this.revoke(lease)
    }
  }
  private assertOwner(lease:Lease,p:Principal):void {
    if(lease.owner!==p.id||lease.client!==p.clientId)throw new WorkbenchError('FORBIDDEN')
    if(lease.revoked||lease.signal.aborted||p.signal.aborted||Date.now()>lease.value.expiresAt)throw new WorkbenchError('LEASE_EXPIRED')
    requireCapability(p,'herdr.observe')
  }
  private async revoke(lease:Lease):Promise<void> {
    lease.revoked=true;lease.cleanup()
    await this.manager.release(lease.value.sessionId,'lease released')
    this.leases.delete(lease.value.leaseId)
  }
}
function mapTerminalError(error:unknown):WorkbenchError {
  if(error instanceof WorkbenchError)return error
  if(error instanceof TerminalSessionError){
    if(error.code==='terminal_session_conflict')return new WorkbenchError('LEASE_CONFLICT')
    if(error.code==='terminal_session_input_backpressure')return new WorkbenchError('INPUT_BACKPRESSURE')
    if(error.code==='terminal_session_unavailable')return new WorkbenchError('QUOTA_EXCEEDED')
    if(error.code==='terminal_session_forbidden')return new WorkbenchError('FORBIDDEN')
    return new WorkbenchError('LEASE_EXPIRED')
  }
  return new WorkbenchError('INTERNAL_ERROR')
}

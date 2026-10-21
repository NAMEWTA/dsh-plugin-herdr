import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import { WorkbenchError, failure, type PlatformEvent } from '@workbench/contracts'
import { WorkbenchRuntime, BoundedAsyncQueue } from '@workbench/core'
import { remoteDefinitions,remoteMethods } from '../contract.ts'
import { ClientSessions } from './clients.ts'
export class WorkbenchRemote extends TypertRemoteService {
  declare static readonly [Symbol.hasInstance]:(value:unknown)=>boolean
  constructor(ctx:Context,private readonly runtime:WorkbenchRuntime,private readonly clients:ClientSessions){super(ctx,'workbench',{namespace:'workbench'})}
  private invocation(){const invocation=this.ctx.invocation;if(!invocation?.peer?.id||invocation.signal.aborted)throw new WorkbenchError('AUTH_REQUIRED');return invocation}
  connect(request:unknown){remoteDefinitions.connect.request.parse(request);return this.clients.connect(this.invocation().peer.id)}
  async request(request:unknown){
    const parsed=remoteDefinitions.request.request.parse(request)
    if(Buffer.byteLength(JSON.stringify(parsed))>1_048_576)throw new WorkbenchError('QUOTA_EXCEEDED')
    const call=this.invocation(),principal=this.clients.principal(parsed.clientId,call.peer.id)
    return this.runtime.invoke(parsed.envelope,principal)
  }
  disconnect(request:unknown){const parsed=remoteDefinitions.disconnect.request.parse(request);this.clients.disconnect(parsed.clientId,this.invocation().peer.id);return {}}
  async *events(request:unknown):AsyncGenerator<PlatformEvent>{
    const parsed=remoteDefinitions.events.request.parse(request),call=this.invocation()
    const principal=this.clients.principal(parsed.clientId,call.peer.id),detach=this.clients.attach(parsed.clientId,call.peer.id)
    const signal=AbortSignal.any([call.signal,principal.signal])
    const queue=new BoundedAsyncQueue<PlatformEvent>(64,65536,()=>256)
    const stop=this.runtime.subscribe(event=>{if(event.type==='modules'||principal.capabilities.has(event.moduleId+'.read'))queue.push(event)})
    const abort=()=>queue.close();signal.addEventListener('abort',abort,{once:true})
    const heartbeat=setInterval(()=>queue.push({type:'heartbeat',moduleId:'platform',revision:0}),10000);heartbeat.unref?.()
    queue.push({type:'modules',moduleId:'platform',revision:0})
    try{if(signal.aborted)return;for await(const event of queue)yield event}
    finally{stop();clearInterval(heartbeat);signal.removeEventListener('abort',abort);queue.close();detach()}
  }
  async *stream(request:unknown):AsyncGenerator<unknown>{
    const parsed=remoteDefinitions.stream.request.parse(request),call=this.invocation(),principal=this.clients.principal(parsed.clientId,call.peer.id)
    const signal=AbortSignal.any([principal.signal,call.signal])
    try{yield* this.runtime.stream(parsed.envelope,{...principal,signal},call.uplink())}
    catch(error){throw new Error(failure(error,parsed.envelope.requestId).code)}
  }
}
const prototype = WorkbenchRemote.prototype as unknown as Record<string, unknown>
for (const method of remoteMethods) {
  const original = prototype[method]
  if (typeof original !== 'function') throw new Error(`Missing Remote method: ${method}`)
  const decorator = remoteDefinitions[method].mode === 'stream' ? Remote({ mode: 'stream' }) : Remote
  const context = { kind: 'method' as const, name: method, static: false, private: false,
    addInitializer(initializer: (this: unknown) => void) { initializer.call(Object.create(prototype)) } }
  ;(decorator as (method: unknown, context: object) => void)(original, context)
}

import { randomBytes } from 'node:crypto'
import { WorkbenchError, type Principal } from '@workbench/contracts'
interface Client { peer:string; controller:AbortController; expires:ReturnType<typeof setTimeout>|undefined; streams:number }
/** DSH authenticates an operator, not an individual browser tab. Issue a separate ephemeral client capability. */
export class ClientSessions {
  private readonly clients=new Map<string,Client>()
  private closed=false
  constructor(private readonly capabilities:readonly string[],private readonly graceMs=3000){}
  connect(peer:string):{clientId:string;capabilities:string[]} {
    if(!peer||this.closed)throw new WorkbenchError('AUTH_REQUIRED')
    if(this.clients.size>=32)throw new WorkbenchError('QUOTA_EXCEEDED')
    const clientId=randomBytes(24).toString('base64url'),client:Client={peer,controller:new AbortController(),expires:undefined,streams:0}
    this.clients.set(clientId,client);this.expire(clientId,client,10000)
    return {clientId,capabilities:[...this.capabilities]}
  }
  principal(id:string,peer:string):Principal {
    const client=this.clients.get(id)
    if(!peer||!client||client.peer!==peer||client.controller.signal.aborted)throw new WorkbenchError('AUTH_REQUIRED')
    return {id:peer,clientId:id,signal:client.controller.signal,capabilities:new Set(this.capabilities),connectionIds:new Set(['local'])}
  }
  attach(id:string,peer:string):()=>void {
    this.principal(id,peer);const client=this.clients.get(id)!
    if(client.streams>=1)throw new WorkbenchError('MODULE_CONFLICT')
    if(client.expires)clearTimeout(client.expires);client.expires=undefined;client.streams++
    let active=true
    return()=>{if(!active)return;active=false;client.streams--;this.expire(id,client,this.graceMs)}
  }
  disconnect(id:string,peer:string):void {this.principal(id,peer);this.remove(id)}
  dispose():void {this.closed=true;for(const id of this.clients.keys())this.remove(id)}
  private expire(id:string,client:Client,ms:number):void {client.expires=setTimeout(()=>this.remove(id),ms);client.expires.unref?.()}
  private remove(id:string):void {const client=this.clients.get(id);if(!client)return;if(client.expires)clearTimeout(client.expires);client.controller.abort();this.clients.delete(id)}
}

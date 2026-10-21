import { randomUUID } from 'node:crypto'
import { WorkbenchError } from '@workbench/contracts'
import type { HerdrSnapshot, ResourceRef } from '../contracts/index.ts'
import type { ConnectionConfig } from '../contracts/config.ts'
import type { HerdrPort } from '../infrastructure/herdr-api/client.ts'
import { resourceKey, sameResource } from '../domain/selectors.ts'
export class HerdrReadModel {
  private snapshotValue:HerdrSnapshot
  private inFlight:Promise<HerdrSnapshot>|undefined
  private identity=''
  private dirty=false
  private restart=true
  private instances=new Map<string,string>()
  private previousStates=new Map<string,{state:string,seq:number}>()
  private readonly ownership=new Map<string,'created'|'adopted'>()
  constructor(private readonly port:HerdrPort,private readonly config:ConnectionConfig,private readonly signal:AbortSignal,private readonly changed:()=>void) {
    this.snapshotValue={connectionId:'local',session:config.session,epoch:'unavailable',revision:0,sampledAt:0,receivedAt:0,connection:'connecting',stale:true,eventStream:'polling',eventGap:false,version:null,protocol:null,error:null,workspaces:[],panes:[],tabs:[],activity:[]}
  }
  snapshot():HerdrSnapshot {return structuredClone(this.snapshotValue)}
  event(raw:unknown):void {
    if(this.signal.aborted)return
    const e=raw&&typeof raw==='object'?raw as Record<string,unknown>:{}
    const data=(e.event??e.data??e) as Record<string,unknown>
    const type=typeof data.type==='string'?data.type:'changed'
    if(type==='events_lost'){this.snapshotValue.stale=true;this.snapshotValue.eventGap=true;this.restart=true}
    const id=typeof data.pane_id==='string'?data.pane_id:typeof data.workspace_id==='string'?data.workspace_id:null
    if(type.includes('closed')&&id)this.instances.delete(id)
    this.snapshotValue.activity=[{id:randomUUID(),at:Date.now(),type,resourceId:id},...this.snapshotValue.activity].slice(0,100)
    this.dirty=true
    void this.refresh().catch(()=>{})
  }
  stream(connected:boolean):void {
    this.snapshotValue.eventStream=connected?'connected':'polling'
    if(!connected){this.snapshotValue.eventGap=true;this.restart=true;this.snapshotValue.stale=true}
    this.changed()
  }
  refresh():Promise<HerdrSnapshot> {
    if(this.inFlight)return this.inFlight
    const run=async()=>{
      // Dirty during a fetch triggers a second authoritative fetch, not a guessed patch.
      let iterations=0
      do {
        this.dirty=false
        try {
          const before=await this.port.identity()
          const raw=await this.port.snapshot(this.signal)
          const after=await this.port.identity()
          if(before!==after)throw new WorkbenchError('RESOURCE_CHANGED')
          if(this.signal.aborted)throw new WorkbenchError('CANCELLED')
          if(this.identity!==after||this.restart){this.identity=after;this.restart=false;this.instances.clear();this.previousStates.clear();this.ownership.clear();this.snapshotValue.epoch=randomUUID()}
          const epoch=this.snapshotValue.epoch
          const ref=(kind:ResourceRef['kind'],id:string,terminal?:string):ResourceRef=>{
            let instance=terminal??this.instances.get(id)
            if(!instance){instance=randomUUID();this.instances.set(id,instance)}
            return {connectionId:'local',session:this.config.session,epoch,kind,id,instance}
          }
          const agents=new Map(raw.agents.map(a=>[a.pane_id,a]))
          const panes=raw.panes.map(p=>{
            const a=agents.get(p.pane_id),r=ref('pane',p.pane_id,p.terminal_id),key=resourceKey(r)
            const state=a?.agent_status??p.agent_status??'unknown',prior=this.previousStates.get(key)
            const seq=a?.state_change_seq??(prior?prior.seq+(prior.state===state?0:1):0)
            this.previousStates.set(key,{state,seq})
            return {ref:r,workspaceId:p.workspace_id,tabId:p.tab_id,terminalId:p.terminal_id,
              label:p.label??a?.name??p.title??p.pane_id,title:p.terminal_title_stripped??p.title??'',
              agent:a?.agent??p.agent??null,state,stateSequence:seq,cwd:p.foreground_cwd??p.cwd??null,revision:p.revision,
              ownership:this.ownership.get(key)??'external' as const}
          })
          const paneKeys=new Set(panes.map(p=>resourceKey(p.ref)))
          for(const key of this.previousStates.keys())if(!paneKeys.has(key))this.previousStates.delete(key)
          const live=new Set([...raw.workspaces.map(w=>w.workspace_id),...raw.tabs.map(t=>t.tab_id)])
          for(const id of this.instances.keys())if(!live.has(id))this.instances.delete(id)
          this.snapshotValue={...this.snapshotValue,revision:this.snapshotValue.revision+1,sampledAt:Date.now(),receivedAt:Date.now(),connection:raw.protocol===22?'online':'incompatible',stale:raw.protocol!==22,version:raw.version,protocol:raw.protocol,error:raw.protocol===22?null:'UNSUPPORTED_VERSION',panes,
            workspaces:raw.workspaces.map(w=>{const r=ref('workspace',w.workspace_id);return {ref:r,label:w.label,paneCount:w.pane_count,tabCount:w.tab_count,ownership:this.ownership.get(resourceKey(r))??'external'}}),
            tabs:raw.tabs.map(t=>{const r=ref('tab',t.tab_id);return {ref:r,label:t.label,workspaceId:t.workspace_id,ownership:this.ownership.get(resourceKey(r))??'external'}})}
          const resources=new Set([...this.snapshotValue.workspaces,...this.snapshotValue.tabs,...panes].map(item=>resourceKey(item.ref)))
          for(const key of this.ownership.keys())if(!resources.has(key))this.ownership.delete(key)
        }catch(error){
          if(this.signal.aborted)throw error
          this.snapshotValue={...this.snapshotValue,receivedAt:Date.now(),connection:'offline',stale:true,error:error instanceof WorkbenchError?error.code:'CONNECTION_UNAVAILABLE'}
          this.restart=true
        }
        this.changed()
      }while(this.dirty&&++iterations<2&&!this.signal.aborted)
      return this.snapshot()
    }
    this.inFlight=run().finally(()=>{this.inFlight=undefined})
    return this.inFlight
  }
  async assert(ref:ResourceRef,write=false):Promise<void> {
    const s=await this.refresh()
    if(s.stale||s.connection!=='online')throw new WorkbenchError('STALE_SNAPSHOT')
    const found=[...s.workspaces,...s.tabs,...s.panes].some(item=>sameResource(item.ref,ref))
    if(!found)throw new WorkbenchError('RESOURCE_CHANGED')
    if(write&&!this.ownership.has(resourceKey(ref)))throw new WorkbenchError('OWNERSHIP_REQUIRED')
  }
  mark(ref:ResourceRef,ownership:'created'|'adopted'):void {this.ownership.set(resourceKey(ref),ownership);this.changed()}
  find(kind:ResourceRef['kind'],id:string):ResourceRef {
    const s=this.snapshotValue
    const item=[...s.panes,...s.workspaces,...s.tabs].find(v=>v.ref.kind===kind&&v.ref.id===id)
    if(!item)throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
    return item.ref
  }
}

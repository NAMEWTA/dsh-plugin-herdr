import { useState } from 'react'
import { Activity, Circle, CircleCheck, CircleHelp, PauseCircle, RefreshCw, Terminal } from 'lucide-react'
import { Badge, Button, ErrorNotice, Field, Input, Modal, Notice, useWorkbench } from '@workbench/ui'
import { resourceSchema, type AgentState, type HerdrSnapshot, type Pane, type ResourceRef } from '../contracts/index.ts'
import { resourceKey } from '../domain/selectors.ts'
import { useHerdrText } from './messages.ts'
import { useAction } from './api.ts'
export function Status({state}:{state:AgentState}){const h=useHerdrText(),Icon={working:Activity,blocked:PauseCircle,idle:Circle,done:CircleCheck,unknown:CircleHelp}[state];return <Badge tone={state==='blocked'?'warning':state==='working'?'info':state==='done'?'success':'neutral'}><Icon size={12}/>{h(state)}</Badge>}
export function Health({snapshot,onRefresh}:{snapshot:HerdrSnapshot;onRefresh:()=>void}){
  const h=useHerdrText(),{t,locale}=useWorkbench()
  return <><div className="wb-actions wb-small"><Badge tone={snapshot.connection==='online'?'success':snapshot.connection==='connecting'?'neutral':'warning'}>{h(snapshot.connection)}</Badge><span className="wb-muted">{h('local')} · {snapshot.session}</span><span className="wb-muted">{h('readAt')} {snapshot.sampledAt?new Date(snapshot.sampledAt).toLocaleTimeString(locale==='zh'?'zh-CN':'en-US'):'—'}</span><Badge>{h(snapshot.eventStream==='connected'?'stream':'polling')}</Badge><Button variant="ghost" size="sm" onClick={onRefresh}><RefreshCw size={13}/>{t('refresh')}</Button></div>{snapshot.stale&&<Notice tone="warning" title={snapshot.connection==='incompatible'?t('UNSUPPORTED_VERSION'):t('offline')}>{t('offlineHint')}</Notice>}{snapshot.eventGap&&<p className="wb-muted wb-small">{h('gap')}</p>}</>
}
export function goToPane(ui:ReturnType<typeof useWorkbench>,pane:Pane,mode:'observe'|'control'='observe'){ui.navigate('herdr.terminal',{target:JSON.stringify(pane.ref),intent:mode,visit:crypto.randomUUID()})}
export function readTarget(params:Readonly<Record<string,string>>):ResourceRef|null{try{const parsed=resourceSchema.safeParse(JSON.parse(params.target??'null'));return parsed.success?parsed.data:null}catch{return null}}
export function ResourceActions({refValue,label,ownership,stale,onClosed}:{refValue:ResourceRef;label:string;ownership:'created'|'adopted'|'external';stale:boolean;onClosed?:()=>void}){
  const ui=useWorkbench(),{t,capabilities}=ui,h=useHerdrText(),[renameOpen,setRenameOpen]=useState(false),[newLabel,setNewLabel]=useState(label)
  const adopt=useAction('herdr.resource.adopt'),rename=useAction('herdr.resource.rename'),close=useAction('herdr.resource.close')
  const busy=adopt.isPending||rename.isPending||close.isPending,error=adopt.error??rename.error??close.error
  if(!capabilities.has('herdr.manage'))return <Badge>{t('readOnly')}</Badge>
  const target=label+' · '+refValue.id+' · '+refValue.instance.slice(0,12)
  return <div className="wb-stack"><div className="wb-actions">
    {ownership==='external'?<Button size="sm" disabled={stale||busy} onClick={()=>void(async()=>{if(await ui.confirm({title:h('adoptTitle'),description:h('adoptBody'),target}))adopt.mutate({ref:refValue,confirmed:true})})()}>{h('adopt')}</Button>:<><Button size="sm" disabled={stale||busy} onClick={()=>{setNewLabel(label);setRenameOpen(true)}}>{h('rename')}</Button><Button size="sm" variant="ghost" disabled={stale||busy} onClick={()=>void(async()=>{if(await ui.confirm({title:h('closeTitle'),description:h('closeBody'),danger:true,target}))close.mutate({ref:refValue,confirmed:true},{onSuccess:onClosed})})()}>{h('closeResource')}</Button></>}
  </div>{error&&<ErrorNotice error={error}/>}<Modal open={renameOpen} onOpenChange={setRenameOpen} title={h('rename')} description={h('renameHint')}><form onSubmit={e=>{e.preventDefault();rename.mutate({ref:refValue,label:newLabel},{onSuccess:()=>setRenameOpen(false)})}} className="wb-stack"><Field label={h('name')}><Input data-wb-initial-focus required maxLength={120} value={newLabel} onChange={e=>setNewLabel(e.target.value)}/></Field><div className="wb-dialog-footer"><Button onClick={()=>setRenameOpen(false)}>{t('cancel')}</Button><Button variant="primary" type="submit" disabled={rename.isPending||!newLabel.trim()}>{t('save')}</Button></div></form></Modal></div>
}

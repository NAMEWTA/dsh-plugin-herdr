import { useState } from 'react'
import { Inbox, Pin, Terminal } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNotice, PageHeader, PageControls, SectionHeader, Skeleton, useWorkbench } from '@workbench/ui'
import type { HerdrSnapshot, Pane } from '../contracts/index.ts'
import { attention, resourceKey, stateKey } from '../domain/selectors.ts'
import { useSnapshot } from './api.ts'
import { useAttentionMarks } from './attention-store.ts'
import { useHerdrText } from './messages.ts'
import { goToPane, Health, Status } from './parts.tsx'
export function AttentionList({snapshot,limit}:{snapshot:HerdrSnapshot;limit?:number}){
  const ui=useWorkbench(),h=useHerdrText(),{marks,update}=useAttentionMarks(),[frozen,setFrozen]=useState<Pane[]|null>(null),[page,setPage]=useState(0)
  const all=attention(snapshot,new Set(Object.entries(marks).filter(([,m])=>m.seen).map(([k])=>k))).filter(p=>(marks[stateKey(p)]?.snoozeUntil??0)<Date.now()).sort((a,b)=>Number(!!marks[stateKey(b)]?.pinned)-Number(!!marks[stateKey(a)]?.pinned))
  const source=frozen??all,current=Math.min(page,Math.max(0,Math.ceil(source.length/50)-1)),items=limit?source.slice(0,limit):source.slice(current*50,(current+1)*50)
  return <Card><SectionHeader title={h('attention')} description={h('attentionHint')} action={all.length>0?<Button size="sm" onClick={()=>update(all.filter(p=>p.state==='done').map(stateKey),{seen:Date.now()})}>{h('markAllSeen')}</Button>:undefined}/>
    {!items.length?<EmptyState icon={<Inbox size={28}/>} title={h('attentionEmpty')} description={h('attentionEmptyHint')}/>:<div data-wb-attention onFocusCapture={()=>{if(!frozen)setFrozen(all)}} onBlurCapture={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setFrozen(null)}}>
      {items.map(p=><div className="wb-row" key={resourceKey(p.ref)}><div className="wb-row-main"><div className="wb-actions"><strong>{p.label}</strong><Status state={p.state}/>{marks[stateKey(p)]?.pinned&&<Badge><Pin size={11}/>{h('pinned')}</Badge>}</div><span className="wb-small wb-muted">{p.workspaceId} / {p.ref.id} · {h('rawSource')}</span></div><div className="wb-actions"><Button size="sm" disabled={snapshot.stale} onClick={()=>{if(p.state==='done')update([stateKey(p)],{seen:Date.now()});goToPane(ui,p)}}><Terminal size={13}/>{h('inspect')}</Button><Button size="sm" variant="ghost" onClick={()=>update([stateKey(p)],{pinned:!marks[stateKey(p)]?.pinned})}>{h(marks[stateKey(p)]?.pinned?'unpin':'pin')}</Button>{!limit&&<Button size="sm" variant="ghost" onClick={()=>{update([stateKey(p)],{snoozeUntil:Date.now()+900000});setFrozen(null)}}>{h('snooze')}</Button>}</div></div>)}
    </div>}
    {!limit&&<PageControls count={source.length} page={current} size={50} onPage={value=>{setFrozen(null);setPage(value)}}/>}
  </Card>
}
export function AttentionPage(){const h=useHerdrText(),query=useSnapshot();return <><PageHeader title={h('attention')} description={h('attentionHint')}/>{query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error}/>:query.data&&<><Health snapshot={query.data} onRefresh={()=>void query.refetch()}/><AttentionList snapshot={query.data}/></>}</>}
export function AttentionWidget(){const query=useSnapshot();return query.data?<AttentionList snapshot={query.data} limit={5}/>:null}

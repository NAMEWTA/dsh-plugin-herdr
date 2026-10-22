import { useEffect, useRef, useState } from 'react'
import { Copy, Eye, Keyboard, LockKeyhole, PlugZap, Square, ClipboardPaste, ChevronLeft, Terminal } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Modal, Notice, PageHeader, Select, Skeleton, Textarea, useWorkbench, type PageProps } from '@workbench/ui'
import type { Pane, TerminalLease } from '../../contracts/index.ts'
import { resourceKey } from '../../domain/selectors.ts'
import { useSnapshot, call } from '../api.ts'
import { Health, readTarget, Status } from '../parts.tsx'
import { useHerdrText } from '../messages.ts'
import { TerminalScreen, type ScreenHandle } from './screen.tsx'
import { loadTerminal } from './driver.ts'

/** A resource link starts observation. URL intent can request a dialog, never grant control. */
export function TerminalPage({route}:PageProps) {
  const ui=useWorkbench(),h=useHerdrText(),query=useSnapshot(),[chosen,setChosen]=useState('')
  const target=readTarget(route.params),panes=query.data?.panes??[]
  useEffect(()=>setChosen(''),[route.params.target,route.params.visit])
  const selected=panes.find(p=>resourceKey(p.ref)===(chosen||(target&&resourceKey(target))))
  const workspace=query.data?.workspaces.find(w=>w.ref.id===selected?.workspaceId)
  return <div className="wb-stack wb-terminal-page">
    <PageHeader title={selected?.label||h('terminal')} description={workspace?(workspace.label+' / '+(query.data?.tabs.find(t=>t.ref.id===selected?.tabId)?.label??selected?.tabId)):h('terminalHint')} actions={workspace?<Button variant="ghost" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(workspace.ref)})}><ChevronLeft size={15}/>{h('workspaces')}</Button>:undefined}/>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>:query.data&&<>
      <Health snapshot={query.data} onRefresh={()=>void query.refetch()}/>
      <div className="wb-pane-switcher"><Field label={h('selectPane')}><Select value={selected?resourceKey(selected.ref):''} onChange={e=>setChosen(e.target.value)}><option value="">{h('selectPane')}</option>{panes.map(p=><option key={resourceKey(p.ref)} value={resourceKey(p.ref)}>{p.label||p.ref.id} · {query.data?.workspaces.find(w=>w.ref.id===p.workspaceId)?.label??p.workspaceId}</option>)}</Select></Field>{selected&&<Status state={selected.state}/>}</div>
      {target&&!selected&&<Notice tone="warning">{ui.t('RESOURCE_CHANGED')}</Notice>}
      {selected?<PaneSession key={resourceKey(selected.ref)+':'+(route.params.visit??'')} pane={selected} stale={query.data.stale} initialMode={!chosen&&route.params.intent==='control'?'control':'observe'}/>:<EmptyState icon={<Terminal size={30}/>} title={h('selectPane')} description={h('viewFirst')}/>}
    </>}
  </div>
}

function PaneSession({pane,stale,initialMode}:{pane:Pane;stale:boolean;initialMode:'observe'|'control'}) {
  const ui=useWorkbench(),h=useHerdrText()
  const [lease,setLease]=useState<TerminalLease|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState<unknown>(null),[paste,setPaste]=useState<string|null>(null)
  const handle=useRef<ScreenHandle|null>(null),currentLease=useRef<TerminalLease|null>(null),epoch=useRef(0),alive=useRef(false),inFlight=useRef(false)
  const latest=useRef({ui,h,pane,stale});latest.current={ui,h,pane,stale}
  const stop=async()=>{
    epoch.current++;inFlight.current=false;const current=currentLease.current;currentLease.current=null;handle.current=null
    if(alive.current){setLease(null);setBusy(false);setPaste(null)}
    if(current)await call(ui.client,'herdr.terminal.release',{leaseId:current.leaseId})
  }
  const open=async(mode:'observe'|'control',takeover=false)=>{
    if(inFlight.current)return
    const {ui,h,pane,stale}=latest.current
    if(stale||!ui.capabilities.has(mode==='control'?'herdr.control':'herdr.observe')||(mode==='control'&&pane.ownership==='external'&&!ui.capabilities.has('herdr.manage')))return
    inFlight.current=true;const before=epoch.current;setBusy(true);setError(null)
    if(mode==='control'){
      const confirmed=await ui.confirm({title:h(takeover?'takeoverTitle':'controlTitle'),description:h(takeover?'takeoverBody':pane.ownership==='external'?'controlExternalBody':'controlBody'),danger:true,target:pane.label||pane.ref.id})
      if(!alive.current||before!==epoch.current)return
      if(!confirmed){inFlight.current=false;setBusy(false);return}
    }
    const released=stop(),ticket=epoch.current;inFlight.current=true;setBusy(true)
    try{
      await released
      await loadTerminal()
      if(!alive.current||ticket!==epoch.current)return
      if(mode==='control'&&pane.ownership==='external')await call(ui.client,'herdr.resource.adopt',{ref:pane.ref,confirmed:true})
      if(!alive.current||ticket!==epoch.current)return
      const next=await call(ui.client,'herdr.terminal.open',{ref:pane.ref,mode,cols:100,rows:28,confirmed:mode==='control',takeover})
      if(!alive.current||ticket!==epoch.current){await call(ui.client,'herdr.terminal.release',{leaseId:next.leaseId});return}
      currentLease.current=next;setLease(next)
    }catch(e){if(alive.current&&ticket===epoch.current)setError(e)}finally{if(alive.current&&ticket===epoch.current){inFlight.current=false;setBusy(false)}}
  }
  useEffect(()=>{
    alive.current=true;void open(initialMode)
    return()=>{alive.current=false;epoch.current++;inFlight.current=false;const current=currentLease.current;currentLease.current=null;if(current)void call(ui.client,'herdr.terminal.release',{leaseId:current.leaseId}).catch(()=>{})}
  },[])
  const copy=async()=>{const text=handle.current?.copy();if(!text)return;try{await navigator.clipboard.writeText(text);ui.notify(h('copied'))}catch{ui.notify(h('copyFailed'),'danger')}}
  const editable=ui.capabilities.has('herdr.control')&&(pane.ownership!=='external'||ui.capabilities.has('herdr.manage'))&&!stale
  return <><Card className="wb-terminal-canvas">
    <div className="wb-terminal-actions"><div className="wb-actions"><Badge tone={lease?.mode==='control'?'warning':'neutral'}>{busy?ui.t('loading'):lease?h(lease.mode==='control'?'controlling':'observing'):h('terminalStopped')}</Badge><span className="wb-small wb-muted">{pane.agent??'Shell'}</span></div><div className="wb-actions">
      <Button size="sm" disabled={busy||stale||!ui.capabilities.has('herdr.observe')} onClick={()=>void open('observe')}><Eye size={15}/>{h('observe')}</Button>
      <Button size="sm" variant="primary" disabled={!editable||busy||lease?.mode==='control'} onClick={()=>void open('control')}><Keyboard size={15}/>{h('control')}</Button>
      <Button size="sm" variant="ghost" disabled={!editable||busy} onClick={()=>void open('control',true)}><LockKeyhole size={15}/>{h('takeover')}</Button>
      <Button size="sm" variant="ghost" disabled={!lease&&!busy} onClick={()=>void stop().catch(setError)}><Square size={14}/>{h('release')}</Button>
    </div></div>
    {error!=null&&<ErrorNotice error={error} retry={!busy&&!stale&&ui.capabilities.has('herdr.observe')?()=>void open('observe'):undefined}/>}
    {lease?<TerminalScreen key={lease.leaseId} lease={lease} onReady={value=>{handle.current=value}} onPaste={setPaste} onClose={failure=>{void stop().catch(()=>{});if(alive.current)setError(failure)}}/>:busy?<Skeleton/>:<EmptyState icon={<PlugZap size={32}/>} title={h('terminalStopped')} description={h('terminalStoppedHint')}/>}
    <div className="wb-terminal-utility"><span className="wb-small wb-muted">{h('viewFirst')}</span><div className="wb-actions"><Button size="sm" variant="ghost" disabled={!lease} onClick={()=>void copy()}><Copy size={14}/>{h('copy')}</Button><Button size="sm" variant="ghost" disabled={lease?.mode!=='control'||stale} onClick={()=>setPaste('')}><ClipboardPaste size={14}/>{h('paste')}</Button></div></div>
  </Card><Modal open={paste!==null} onOpenChange={open=>{if(!open)setPaste(null)}} title={h('pasteTitle')} description={h('pasteBody')}><Textarea aria-label={h('pastePlaceholder')} value={paste??''} maxLength={65536} onChange={e=>setPaste(e.target.value)}/><div className="wb-dialog-footer"><Button data-wb-initial-focus onClick={()=>setPaste(null)}>{ui.t('cancel')}</Button><Button variant="danger" disabled={!paste||lease?.mode!=='control'||stale} onClick={()=>{if(paste&&handle.current?.send(paste))setPaste(null)}}>{h('send')}</Button></div></Modal></>
}

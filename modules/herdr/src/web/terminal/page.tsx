import { useEffect, useRef, useState } from 'react'
import { Copy, Eye, Keyboard, LockKeyhole, PlugZap, Square, ClipboardPaste, ChevronRight, Plus, Terminal } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNotice, Modal, Notice, Skeleton, Textarea, useWorkbench, type PageProps } from '@workbench/ui'
import type { Pane, ResourceRef, TerminalLease } from '../../contracts/index.ts'
import { resourceKey, sameResource } from '../../domain/selectors.ts'
import { useAction, useSnapshot, call } from '../api.ts'
import { Health, readTarget, Status } from '../parts.tsx'
import { useHerdrText } from '../messages.ts'
import { TerminalScreen, type ScreenHandle } from './screen.tsx'
import { loadTerminal } from './driver.ts'

/** A resource link starts observation. URL intent can request a dialog, never grant control. */
export function TerminalPage({route}:PageProps) {
  const ui=useWorkbench(),h=useHerdrText(),query=useSnapshot(),[chosen,setChosen]=useState(''),[summary,setSummary]=useState(false)
  const target=readTarget(route.params),panes=query.data?.panes??[]
  useEffect(()=>setChosen(''),[route.params.target,route.params.visit])
  useEffect(()=>{const toggle=()=>setSummary(value=>!value);window.addEventListener('wb-herdr-toggle-view',toggle);return()=>window.removeEventListener('wb-herdr-toggle-view',toggle)},[])
  const selected=panes.find(p=>resourceKey(p.ref)===(chosen||(target&&resourceKey(target))))
  const workspace=query.data?.workspaces.find(w=>w.ref.id===selected?.workspaceId)
  const tabs=(query.data?.tabs??[]).filter(tab=>tab.workspaceId===selected?.workspaceId)
  const siblings=panes.filter(pane=>pane.tabId===selected?.tabId)
  const openPane=(pane:Pane)=>goTo(ui,pane)
  return <div className="wb-stack wb-terminal-page">
    <header className="wb-studio-bar">
      <nav className="wb-location" aria-label={h('location')}><span>{h('local')}</span>{workspace&&<><ChevronRight size={12}/><button type="button" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(workspace.ref)})}>{workspace.label||workspace.ref.id}</button></>}{selected&&<><ChevronRight size={12}/><span className="wb-truncate">{selected.cwd||selected.label||selected.ref.id}</span></>}</nav>
      <div className="wb-studio-bar-title"><h1>{selected?.label||h('terminal')}</h1><div className="wb-segment" role="group" aria-label={h('terminalView')}><button type="button" aria-pressed={summary} onClick={()=>setSummary(true)}>{h('summaryView')}</button><button type="button" aria-pressed={!summary} onClick={()=>setSummary(false)}>{h('terminalView')}</button></div></div>
      <p className="wb-muted wb-small">{h('terminalHint')}</p>
    </header>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>:query.data&&<>
      <Health snapshot={query.data} onRefresh={()=>void query.refetch()}/>
      {workspace&&<div className="wb-tab-strip"><div role="tablist" aria-label={h('tabs')}>{tabs.map(tab=><button type="button" role="tab" key={resourceKey(tab.ref)} aria-selected={tab.ref.id===selected?.tabId} onClick={()=>{const pane=panes.find(item=>item.tabId===tab.ref.id);if(pane)openPane(pane)}}>{tab.label||tab.ref.id}</button>)}</div>{ui.capabilities.has('herdr.manage')&&workspace.ownership!=='external'&&<TabCreate workspace={workspace.ref} stale={query.data.stale}/>}</div>}
      {!!siblings.length&&<div className="wb-pane-canvas" aria-label={h('panes')}>{siblings.map(pane=><button type="button" key={resourceKey(pane.ref)} className="wb-pane-chip" aria-current={selected&&sameResource(selected.ref,pane.ref)?'page':undefined} disabled={query.data?.stale} onClick={()=>openPane(pane)}><Status state={pane.state} agent={pane.agent}/><span>{pane.label||pane.ref.id}</span></button>)}</div>}
      {target&&!selected&&<Notice tone="warning">{ui.t('RESOURCE_CHANGED')}</Notice>}
      {selected&&!summary?<PaneSession key={resourceKey(selected.ref)+':'+(route.params.visit??'')} pane={selected} stale={query.data.stale} initialMode={!chosen&&route.params.intent==='control'?'control':'observe'}/>:selected&&summary?<Card><div className="wb-section-header"><div><h2>{selected.label||selected.ref.id}</h2><p className="wb-small wb-muted">{selected.agent??h('shellKind')} · {selected.cwd??'—'}</p></div><Status state={selected.state} agent={selected.agent}/></div><p className="wb-small wb-muted">{h('viewFirst')}</p></Card>:<EmptyState icon={<Terminal size={30}/>} title={h('selectPane')} description={h('viewFirst')}/>}
    </>}
  </div>
}
function goTo(ui:ReturnType<typeof useWorkbench>,pane:Pane){ui.navigate('herdr.terminal',{target:JSON.stringify(pane.ref),intent:'observe',visit:crypto.randomUUID()})}
function TabCreate({workspace,stale}:{workspace:ResourceRef;stale:boolean}){
  const ui=useWorkbench(),h=useHerdrText(),create=useAction('herdr.tab.create')
  return <Button size="icon" variant="ghost" aria-label={h('newTab')} disabled={stale||create.isPending} onClick={()=>void(async()=>{if(await ui.confirm({title:h('tabTitle'),description:h('tabBody'),target:workspace.id}))create.mutate({ref:workspace,label:h('newTab')})})()}><Plus size={15}/></Button>
}

export function PaneSession({pane,stale,initialMode}:{pane:Pane;stale:boolean;initialMode:'observe'|'control'}) {
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
      const confirmed=await ui.confirm({title:h(takeover?'takeoverTitle':'controlTitle'),description:[h(pane.ownership==='external'?'controlExternalBody':'controlBody'),...(takeover?[h('takeoverBody')]:[])].join(' '),danger:true,target:pane.label||pane.ref.id})
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

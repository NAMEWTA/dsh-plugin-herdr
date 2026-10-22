import { useEffect, useId, useState } from 'react'
import { Bot, ChevronDown, ChevronRight, Folder, Inbox, LayoutDashboard, MessageSquare, Plus, Settings2, Terminal } from 'lucide-react'
import { Badge, Button, ErrorNotice, Input, Skeleton, useWorkbench } from '@workbench/ui'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { useBinding, useSnapshot } from './api.ts'
import { goToPane, readTarget } from './parts.tsx'
import { useHerdrText } from './messages.ts'

/** Herdr contributes its navigation; the shell knows nothing about its resource model. */
export function HerdrNavigation() {
  const ui=useWorkbench(),h=useHerdrText(),query=useSnapshot(),binding=useBinding(),id=useId()
  const [search,setSearch]=useState(''),[expanded,setExpanded]=useState<ReadonlySet<string>>(new Set())
  const s=query.data,target=readTarget(ui.route.params)
  const bound=s?.workspaces.find(w=>binding.data?.ref&&sameResource(w.ref,binding.data.ref))
  const targetWorkspace=target?.kind==='workspace'?target.id:s?.panes.find(p=>target&&sameResource(p.ref,target))?.workspaceId
  const reveal=s?.workspaces.find(w=>w.ref.id===targetWorkspace)??bound
  const revealKey=reveal?resourceKey(reveal.ref):''
  useEffect(()=>{if(revealKey)setExpanded(current=>new Set([...current,revealKey]))},[revealKey])
  const nav=(route:string,label:string,Icon:typeof Terminal,count?:number)=><button className="wb-nav-link" aria-current={ui.route.id===route?'page':undefined} onClick={()=>ui.navigate(route)}><Icon size={17}/><span>{label}</span>{count? <span className="wb-nav-count">{count}</span>:null}</button>
  const needle=search.trim().toLocaleLowerCase()
  const rows=(s?.workspaces??[]).filter(w=>(w.label+' '+w.ref.id).toLocaleLowerCase().includes(needle)||s?.panes.some(p=>p.workspaceId===w.ref.id&&(p.label+' '+p.ref.id+' '+(p.cwd??'')+' '+(p.agent??'')).toLocaleLowerCase().includes(needle)))
  const workspaces=[...rows].sort((a,b)=>Number(b.ref.id===bound?.ref.id)-Number(a.ref.id===bound?.ref.id)||a.ref.id.localeCompare(b.ref.id,undefined,{numeric:true}))
  const toggle=(key:string)=>setExpanded(current=>{const next=new Set(current);next.has(key)?next.delete(key):next.add(key);return next})
  return <div className="wb-module-navigation">
    <nav className="wb-nav-group" aria-label={h('herdrNavigation')}>
      {nav('herdr.overview',h('navOverview'),LayoutDashboard)}
      {nav('herdr.attention',h('navAttention'),Inbox,s?.panes.filter(p=>p.state==='blocked').length)}
      {nav('herdr.agents',h('agents'),Bot)}
    </nav>
    {ui.conversationId&&<div className="wb-session-link"><div className="wb-actions"><MessageSquare size={14}/><strong>{h('thisConversation')}</strong></div>{binding.isLoading?<span>{ui.t('loading')}</span>:binding.error?<ErrorNotice error={binding.error}/>:bound?<button className="wb-text-link" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(bound.ref)})}>{bound.label||bound.ref.id}<ChevronRight size={13}/></button>:<button className="wb-text-link" onClick={()=>ui.navigate('herdr.workspaces')}>{binding.data?.ref?h('workspaceMissing'):h('linkWorkspace')}<ChevronRight size={13}/></button>}</div>}
    <div className="wb-tree-heading"><button onClick={()=>ui.navigate('herdr.workspaces')}>{h('workspaces')}</button>{ui.capabilities.has('herdr.manage')&&<Button variant="ghost" size="icon" title={h('createWorkspace')} aria-label={h('createFromNavigation')} disabled={!!s?.stale} onClick={()=>ui.navigate('herdr.workspaces',{create:'1'})}><Plus size={16}/></Button>}</div>
    <Input aria-label={h('searchTree')} placeholder={h('searchTree')} value={search} onChange={e=>setSearch(e.target.value)} className="wb-tree-search"/>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>:<nav className="wb-workspace-tree" aria-label={h('workspaceTree')}><ul>
      {workspaces.map(w=>{
        const key=resourceKey(w.ref),open=!!needle||expanded.has(key),groupId=id+'-'+w.ref.id
        const matchingWorkspace=(w.label+' '+w.ref.id).toLocaleLowerCase().includes(needle)
        const panes=s!.panes.filter(p=>p.workspaceId===w.ref.id&&(matchingWorkspace||(p.label+' '+p.ref.id+' '+(p.cwd??'')+' '+(p.agent??'')).toLocaleLowerCase().includes(needle)))
        const tabs=s!.tabs.filter(t=>t.workspaceId===w.ref.id)
        return <li key={key}>
          <div className="wb-tree-workspace" data-selected={targetWorkspace===w.ref.id}>
            <button className="wb-tree-chevron" aria-label={(open?h('collapseWorkspace'):h('expandWorkspace'))+' '+(w.label||w.ref.id)} aria-expanded={open} aria-controls={groupId} onClick={()=>toggle(key)}>{open?<ChevronDown size={14}/>:<ChevronRight size={14}/>}</button>
            <button className="wb-tree-title" onClick={()=>{setExpanded(current=>new Set([...current,key]));ui.navigate('herdr.workspaces',{target:JSON.stringify(w.ref)})}}><Folder size={16}/><span>{w.label||w.ref.id}</span>{bound?.ref.id===w.ref.id&&<MessageSquare size={12} aria-label={h('bound')}/>}</button><span className="wb-nav-count">{w.paneCount}</span>
          </div>
          <ul id={groupId} hidden={!open} className="wb-tree-children">{open&&tabs.map(tab=><li key={resourceKey(tab.ref)}>
            <div className="wb-tree-tab">{tab.label||tab.ref.id}</div>
            <ul>{panes.filter(p=>p.tabId===tab.ref.id).map(p=><li key={resourceKey(p.ref)}><button className="wb-tree-pane" aria-current={target&&sameResource(target,p.ref)?'page':undefined} aria-label={h('viewPane')+' '+(p.label||p.ref.id)} title={(p.label||p.ref.id)+' · '+h(p.state)} disabled={s!.stale||!ui.capabilities.has('herdr.observe')} onClick={()=>goToPane(ui,p)}><span className={'wb-state-dot wb-state-'+p.state}/><span className="wb-truncate">{p.label||p.ref.id}</span><span className="wb-sr-only">{h(p.state)}</span></button></li>)}</ul>
          </li>)}{open&&!panes.length&&<li className="wb-tree-empty">{h('noPanes')}</li>}</ul>
        </li>
      })}
      {!workspaces.length&&<li className="wb-tree-empty">{needle?ui.t('noResults'):h('emptyTree')}</li>}
    </ul></nav>}
    <nav className="wb-nav-group wb-module-footer" aria-label={h('connectionSettings')}>{nav('herdr.environment',h('connectionSettings'),Settings2)}<div className="wb-connection-line"><span className={'wb-state-dot wb-state-'+(s?.connection==='online'&&!s.stale?'done':'unknown')}/><span>{s?h(s.connection):h('connecting')}</span><span className="wb-truncate">{s?.session??''}</span></div></nav>
  </div>
}

import { ArrowUpRight, Folder, Plus, Sparkles } from 'lucide-react'
import { Button, EmptyState, ErrorNotice, Skeleton, useWorkbench } from '@workbench/ui'
import { summary, sameResource } from '../domain/selectors.ts'
import { useBinding, useSnapshot } from './api.ts'
import { AttentionList } from './attention.tsx'
import { Health } from './parts.tsx'
import { WorkspacePreview } from './workspace-preview.tsx'
import { useHerdrText } from './messages.ts'
export function OverviewPage(){
  const ui=useWorkbench(),h=useHerdrText(),query=useSnapshot(),binding=useBinding(),s=query.data,count=s?summary(s):null
  const workspaces=[...(s?.workspaces??[])].sort((a,b)=>Number(!!binding.data?.ref&&sameResource(b.ref,binding.data.ref))-Number(!!binding.data?.ref&&sameResource(a.ref,binding.data.ref)))
  return <>
    <header className="wb-studio-heading"><div className="wb-studio-kicker"><span className="wb-studio-spark"><Sparkles size={17}/></span>{h('studioMark')} <span>/</span> {h('studioEyebrow')}</div><div className="wb-studio-title"><div><h1>{h('workspaceStudio')}</h1><p>{h('studioHint')}</p></div>{ui.capabilities.has('herdr.manage')&&<Button variant="primary" disabled={!!s?.stale} onClick={()=>ui.navigate('herdr.workspaces',{create:'1'})}><Plus size={17}/>{h('createWorkspace')}</Button>}</div></header>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>:s&&count&&<>
      <Health snapshot={s} onRefresh={()=>void query.refetch()}/>
      <div className="wb-studio-summary" aria-label={h('liveWork')}><span><strong>{s.sampledAt?count.workspaces:'—'}</strong>{h('workspaces')}</span><span><strong>{s.sampledAt?count.agents:'—'}</strong>{h('agents')}</span><span><i className="wb-state-dot wb-state-working"/><strong>{s.sampledAt?count.working:'—'}</strong>{h('working')}</span><button onClick={()=>ui.navigate('herdr.attention')}><i className="wb-state-dot wb-state-blocked"/><strong>{s.sampledAt?count.blocked:'—'}</strong>{h('blocked')}<ArrowUpRight size={14}/></button></div>
      <div className="wb-studio-section"><div><h2>{h('workspaces')}</h2><p>{h('viewFirst')}</p></div><Button variant="ghost" size="sm" onClick={()=>ui.navigate('herdr.workspaces')}>{h('allWorkspaces')}<ArrowUpRight size={15}/></Button></div>
      {workspaces.length?<div className="wb-workspace-grid">{workspaces.slice(0,8).map(w=><WorkspacePreview key={w.ref.id} workspace={w} snapshot={s}/>)}</div>:<EmptyState icon={<Folder size={32}/>} title={h('emptyWorkspaces')} description={h('emptyWorkspacesHint')}/>}
      <AttentionList snapshot={s} limit={4}/>
    </>}
  </>
}

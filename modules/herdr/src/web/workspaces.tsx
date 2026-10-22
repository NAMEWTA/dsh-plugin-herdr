import { useEffect, useState } from 'react'
import { Folder, Plus, Terminal, Keyboard, ChevronDown } from 'lucide-react'
import { Badge, Button, Card, DataTable, EmptyState, ErrorNotice, Field, Input, Modal, Notice, PageHeader, Select, Skeleton, useWorkbench, type PageProps } from '@workbench/ui'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { WorkspacePreview } from './workspace-preview.tsx'
import { useAction, useBinding, useEnvironment, useSnapshot } from './api.ts'
import { goToPane, Health, readTarget, ResourceActions, Status } from './parts.tsx'
import { useHerdrText } from './messages.ts'
import type { Pane, ResourceRef, HerdrSnapshot, Workspace } from '../contracts/index.ts'
export function WorkspacesPage({route}:PageProps){
  const ui=useWorkbench(),{t}=ui,h=useHerdrText(),query=useSnapshot(),[search,setSearch]=useState(''),[mode,setMode]=useState<'cards'|'table'>('cards'),[create,setCreate]=useState(route.params.create==='1'),binding=useBinding(),[scope,setScope]=useState<'session'|'all'>(ui.conversationId?'session':'all')
  useEffect(()=>{if(route.params.create==='1')setCreate(true)},[route.params.create])
  const target=readTarget(route.params),s=query.data,selected=s?.workspaces.find(w=>target?sameResource(w.ref,target):scope==='session'&&!!binding.data?.ref&&sameResource(w.ref,binding.data.ref))
  const items=s?.workspaces.filter(w=>(w.label+' '+w.ref.id).toLocaleLowerCase().includes(search.toLocaleLowerCase()))??[]
  return <><PageHeader title={selected?.label||h('workspaces')} description={h('workspaceHint')} actions={ui.capabilities.has('herdr.manage')?<Button variant="primary" disabled={!s||s.stale} onClick={()=>setCreate(true)}><Plus size={15}/>{h('createWorkspace')}</Button>:undefined}/>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error}/>:s&&<><Health snapshot={s} onRefresh={()=>void query.refetch()}/><BindingBanner snapshot={s}/>{(target||selected)?<><Button onClick={()=>{setScope('all');ui.navigate('herdr.workspaces')}}>{h('allWorkspaces')}</Button>{selected?<WorkspaceDetail workspace={selected} snapshot={s}/>:<EmptyState title={h('workspaceMissing')} description={h('targetChanged')}/>}</>:<><div className="wb-toolbar"><Field label={t('search')}><Input value={search} onChange={e=>setSearch(e.target.value)} placeholder={h('name')+' / ID'}/></Field><Field label={t('details')}><Select value={mode} onChange={e=>setMode(e.target.value as 'cards'|'table')}><option value="cards">{t('cards')}</option><option value="table">{t('table')}</option></Select></Field></div>
    {!items.length?<EmptyState icon={<Folder size={28}/>} title={search?t('noResults'):h('emptyWorkspaces')} description={search?undefined:h('emptyWorkspacesHint')} action={search?<Button onClick={()=>setSearch('')}>{t('clearFilter')}</Button>:undefined}/>:mode==='cards'?<div className="wb-workspace-grid">{items.map(w=><WorkspacePreview key={resourceKey(w.ref)} workspace={w} snapshot={s}/>)}</div>:<Card><DataTable label={h('workspaces')} items={items} rowKey={w=>resourceKey(w.ref)} columns={[{key:'name',label:h('name'),render:w=><strong>{w.label||w.ref.id}</strong>},{key:'id',label:'ID',render:w=><code>{w.ref.id}</code>},{key:'count',label:h('panes'),render:w=>w.paneCount},{key:'ownership',label:h('ownership'),render:w=><Badge>{h(w.ownership)}</Badge>},{key:'action',label:t('operation'),render:w=><Button size="sm" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(w.ref)})}>{t('details')}</Button>}]}/></Card>}</>}</>}
    <CreateWorkspace open={create} close={()=>{setCreate(false);if(route.params.create)ui.navigate('herdr.workspaces',target?{target:JSON.stringify(target)}:{})}}/>
  </>
}
export function CreateWorkspace({open,close}:{open:boolean;close:()=>void}){
  const ui=useWorkbench(),{t}=ui,h=useHerdrText(),environment=useEnvironment(),binding=useBinding()
  const create=useAction('herdr.workspace.create'),scoped=useAction('herdr.conversation.create')
  const [name,setName]=useState(''),[cwd,setCwd]=useState(''),[bindNew,setBindNew]=useState(true)
  const canBind=!!ui.conversationId&&!binding.isLoading&&!binding.error&&!binding.data?.ref
  const busy=create.isPending||scoped.isPending
  const bindingUnavailable=!!ui.conversationId&&(binding.isLoading||!!binding.error)
  const done=(ref:ResourceRef)=>{close();setName('');ui.navigate('herdr.workspaces',{target:JSON.stringify(ref)})}
  return <Modal open={open} onOpenChange={o=>{if(!o&&!busy)close()}} title={h('createWorkspace')} description={h('createHint')}><form className="wb-stack" onSubmit={e=>{e.preventDefault();if(bindingUnavailable||busy)return;const input={label:name,cwd:cwd||environment.data?.rootDirectory||''};if(canBind&&bindNew)scoped.mutate({...input,conversationId:ui.conversationId!,confirmed:true},{onSuccess:value=>{if(value.ref)done(value.ref)}});else create.mutate(input,{onSuccess:done})}}>
    <Field label={h('name')}><Input required maxLength={120} data-wb-initial-focus value={name} onChange={e=>setName(e.target.value)}/></Field>
    <Field label={h('directory')} hint={environment.data?.rootDirectory}><Input required value={cwd||environment.data?.rootDirectory||''} onChange={e=>setCwd(e.target.value)}/></Field>
    {canBind&&<label className="wb-checkbox-row"><input type="checkbox" checked={bindNew} onChange={e=>setBindNew(e.target.checked)}/><span><strong>{h('createBound')}</strong><small>{h('createBoundHint')}</small></span></label>}
    {binding.error&&ui.conversationId&&<ErrorNotice error={binding.error} retry={()=>void binding.refetch()}/>}
    {(create.error||scoped.error)&&<ErrorNotice error={scoped.error??create.error}/>}
    <div className="wb-dialog-footer"><Button onClick={close} disabled={busy}>{t('cancel')}</Button><Button variant="primary" type="submit" disabled={busy||!name.trim()||bindingUnavailable}>{busy?t('loading'):h('createWorkspace')}</Button></div>
  </form></Modal>
}
function WorkspaceDetail({workspace:w,snapshot:s}:{workspace:Workspace;snapshot:HerdrSnapshot}){
  const ui=useWorkbench(),{t}=ui,h=useHerdrText(),[tab,setTab]=useState('all'),newTab=useAction('herdr.tab.create'),binding=useAction('herdr.binding.set')
  const tabs=s.tabs.filter(t=>t.workspaceId===w.ref.id),panes=s.panes.filter(p=>p.workspaceId===w.ref.id&&(tab==='all'||p.tabId===tab))
  return <><Card><div className="wb-section-header"><div><h2>{w.label}</h2><p className="wb-small wb-muted">{w.ref.id} · {h(w.ownership)}</p></div><ResourceActions refValue={w.ref} label={w.label} ownership={w.ownership} stale={s.stale} onClosed={()=>ui.navigate('herdr.workspaces')}/></div>{ui.conversationId&&ui.capabilities.has('herdr.manage')&&<Button disabled={s.stale||binding.isPending} onClick={()=>void(async()=>{if(await ui.confirm({title:h('bindingTitle'),description:h('bindingHint'),target:ui.conversationId+' → '+w.ref.id}))binding.mutate({conversationId:ui.conversationId!,ref:w.ref,confirmed:true})})()}>{h('bind')}</Button>}{binding.error&&<ErrorNotice error={binding.error}/>}</Card>
    <Card><div className="wb-section-header"><h2>{h('tabs')}</h2>{ui.capabilities.has('herdr.manage')&&<Button size="sm" disabled={s.stale||w.ownership==='external'||newTab.isPending} onClick={()=>void(async()=>{if(await ui.confirm({title:h('tabTitle'),description:h('tabBody'),target:w.ref.id}))newTab.mutate({ref:w.ref,label:h('newTab')})})()}><Plus size={14}/>{h('newTab')}</Button>}</div><div className="wb-actions"><Button size="sm" variant={tab==='all'?'primary':'secondary'} onClick={()=>setTab('all')}>{t('all')}</Button>{tabs.map(v=><Button size="sm" key={v.ref.id} variant={tab===v.ref.id?'primary':'secondary'} onClick={()=>setTab(v.ref.id)}>{v.label}</Button>)}</div>{tab!=='all'&&tabs.filter(v=>v.ref.id===tab).map(v=><div className="wb-row" key={v.ref.id}><code>{v.ref.id}</code><ResourceActions refValue={v.ref} label={v.label} ownership={v.ownership} stale={s.stale}/></div>)}{newTab.error&&<ErrorNotice error={newTab.error}/>}</Card>
    <div className="wb-grid">{panes.map(p=><PaneCard key={resourceKey(p.ref)} pane={p} stale={s.stale}/>)}</div>
  </>
}
export function PaneCard({pane:p,stale}:{pane:Pane;stale:boolean}){
  const ui=useWorkbench(),h=useHerdrText(),split=useAction('herdr.pane.split'),start=useAction('herdr.agent.start'),environment=useEnvironment(),[agent,setAgent]=useState('claude')
  return <Card className="wb-pane-card"><button className="wb-pane-title" disabled={stale||!ui.capabilities.has('herdr.observe')} onClick={()=>goToPane(ui,p)} aria-label={h('viewPane')+' '+(p.label||p.ref.id)}><span className="wb-workspace-glyph"><Terminal size={20}/></span><span><strong>{p.label||p.ref.id}</strong><small>{p.agent??'Shell'} · {p.ref.id}</small></span></button><div className="wb-pane-meta"><Status state={p.state}/><span className="wb-small wb-muted wb-truncate" title={p.cwd??''}>{p.cwd??'—'}</span></div>
    <div className="wb-pane-card-actions"><Button variant="ghost" disabled={stale||!ui.capabilities.has('herdr.observe')} onClick={()=>goToPane(ui,p)}>{h('view')}</Button>{ui.capabilities.has('herdr.control')&&<Button disabled={stale||(p.ownership==='external'&&!ui.capabilities.has('herdr.manage'))} onClick={()=>goToPane(ui,p,'control')}><Keyboard size={15}/>{h('controlShort')}</Button>}</div>
    <details className="wb-resource-disclosure"><summary>{h('managePane')}<ChevronDown size={14}/></summary><div className="wb-stack"><ResourceActions refValue={p.ref} label={p.label} ownership={p.ownership} stale={stale}/>
      {ui.capabilities.has('herdr.manage')&&<Button disabled={stale||p.ownership==='external'||split.isPending} onClick={()=>void(async()=>{if(await ui.confirm({title:h('splitTitle'),description:h('splitBody'),target:p.ref.id}))split.mutate({ref:p.ref,direction:'horizontal'})})()}>{h('split')}</Button>}
      {ui.capabilities.has('herdr.control')&&!p.agent&&<div className="wb-toolbar"><Field label={h('agents')}><Select value={agent} onChange={e=>setAgent(e.target.value)}>{(environment.data?.agentKinds??['claude','codex']).map(v=><option value={v} key={v}>{v}</option>)}</Select></Field><Button disabled={stale||p.ownership==='external'||start.isPending} onClick={()=>void(async()=>{if(await ui.confirm({title:h('startAgentTitle'),description:h('startAgentBody'),target:p.ref.id+' · '+agent}))start.mutate({ref:p.ref,kind:agent,confirmed:true})})()}>{h('startAgent')}</Button></div>}
      {(split.error||start.error)&&<ErrorNotice error={split.error??start.error}/>}</div></details>
  </Card>
}

function BindingBanner({snapshot}:{snapshot:HerdrSnapshot}){
  const ui=useWorkbench(),h=useHerdrText(),binding=useBinding(),change=useAction('herdr.binding.set'),[chosen,setChosen]=useState('')
  if(!ui.conversationId)return null
  if(binding.isLoading)return <Skeleton/>
  if(binding.error)return <ErrorNotice error={binding.error}/>
  const ref=binding.data?.ref,workspace=ref&&snapshot.workspaces.find(item=>sameResource(item.ref,ref))
  const pick=snapshot.workspaces.find(w=>resourceKey(w.ref)===chosen)
  const bind=async(ref:ResourceRef|null)=>{if(await ui.confirm({title:h('bindingTitle'),description:h('bindingHint'),target:ui.conversationId+' → '+(ref?.id??'—')}))change.mutate({conversationId:ui.conversationId!,ref,confirmed:true})}
  return <Card className="wb-binding-card"><div className="wb-section-header"><div><h2>{h('sessionWork')}</h2><p className="wb-small wb-muted">{ref?(workspace? h('bound')+' · '+(workspace.label||ref.id):h('targetChanged')):h('notBound')}</p></div>{workspace&&<Button variant="ghost" size="sm" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(workspace.ref)})}>{h('openWorkspace')}</Button>}</div>
    {ui.capabilities.has('herdr.manage')&&(ref?<Button size="sm" variant="ghost" disabled={change.isPending} onClick={()=>void bind(null)}>{h('unbind')}</Button>:<div className="wb-toolbar"><Field label={h('chooseBinding')}><Select value={chosen} onChange={e=>setChosen(e.target.value)}><option value="">{h('chooseBinding')}</option>{snapshot.workspaces.map(w=><option key={resourceKey(w.ref)} value={resourceKey(w.ref)}>{w.label||w.ref.id}</option>)}</Select></Field><Button disabled={!pick||snapshot.stale||change.isPending} onClick={()=>{if(pick)void bind(pick.ref)}}>{h('bind')}</Button></div>)}
    {change.error&&<ErrorNotice error={change.error}/>}<p className="wb-small wb-muted">{h('bindingHint')}</p>
  </Card>
}

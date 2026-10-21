import { Component, useEffect, useMemo, useState, type ErrorInfo, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Blocks, ChevronRight, Command, Home, Layers3, Menu, Search, Settings, ShieldCheck, X } from 'lucide-react'
import type { Locale, RouteLocation, WorkbenchClient } from '@workbench/contracts'
import { platformSnapshotSchema, preferencesSchema, type Preferences } from '@workbench/contracts/schemas'
import { Badge, Button, Card, DataTable, EmptyState, ErrorNotice, Field, Input, Modal, PageHeader, Select, Skeleton, UiProvider, request, useWorkbench, type MessageKey, type WebModule } from '@workbench/ui'
const preferenceKey='namewta.workbench.preferences.v1'
function readPreferences(locale:Locale):Preferences{
  try{return preferencesSchema.parse(JSON.parse(localStorage.getItem(preferenceKey)??'null'))}
  catch{return {version:1,locale,theme:'system',density:'comfortable'}}
}
function readRoute(fallback:string):RouteLocation{
  if(typeof window==='undefined')return {id:fallback,params:{}}
  const query=new URL(window.location.href).searchParams,id=query.get('wb.route')??fallback
  const params:Record<string,string>={}
  for(const [key,value]of query)if(key.startsWith('wb.')&&key!=='wb.route'&&key.length<80&&value.length<1024)params[key.slice(3)]=value
  return {id,params}
}
export function Workbench({client,modules,initialRoute,locale='zh',conversationId}:{client:WorkbenchClient;modules:readonly WebModule[];initialRoute:string;locale?:Locale;conversationId?:string}){
  const [queries]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:2000,gcTime:60_000,retry:1,refetchOnWindowFocus:true},mutations:{retry:false}}}))
  useEffect(()=>()=>{queries.clear()},[queries])
  return <QueryClientProvider client={queries}><Shell client={client} modules={modules} initialRoute={initialRoute} locale={locale} conversationId={conversationId}/></QueryClientProvider>
}
function Shell({client,modules,initialRoute,locale,conversationId}:{client:WorkbenchClient;modules:readonly WebModule[];initialRoute:string;locale:Locale;conversationId?:string}){
  const cache=useQueryClient(),[prefs,setPrefs]=useState(()=>readPreferences(locale)),[route,setRoute]=useState(()=>readRoute(initialRoute)),[systemDark,setSystemDark]=useState(()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-color-scheme: dark)').matches)
  const platform=useQuery({queryKey:['platform','snapshot'],queryFn:async({signal})=>platformSnapshotSchema.parse(await request(client,'platform.snapshot',{},signal)),refetchInterval:10000})
  const capabilities=useMemo(()=>new Set(platform.data?.capabilities??[]),[platform.data?.capabilities])
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
  useEffect(()=>{const change=()=>setRoute(readRoute(initialRoute));window.addEventListener('popstate',change);return()=>window.removeEventListener('popstate',change)},[initialRoute])
  useEffect(()=>{
    const abort=new AbortController();
    const run=async()=>{
      let delay=500
      while(!abort.signal.aborted){
        try{for await(const event of client.events(abort.signal)){delay=500;if(event.type==='heartbeat')continue;void cache.invalidateQueries({queryKey:[event.type==='modules'?'platform':event.moduleId]})}}
        catch{if(abort.signal.aborted)break;void cache.invalidateQueries({queryKey:['platform']})}
        if(abort.signal.aborted)break
        await new Promise<void>(resolve=>{const done=()=>{clearTimeout(timer);abort.signal.removeEventListener('abort',done);resolve()};const timer=setTimeout(done,delay);abort.signal.addEventListener('abort',done,{once:true})});delay=Math.min(10000,delay*2)
      }
    };void run();return()=>{abort.abort()}
  },[client,cache])
  const navigate=(id:string,params:Record<string,string>={})=>{
    const url=new URL(window.location.href)
    for(const name of [...url.searchParams.keys()])if(name.startsWith('wb.'))url.searchParams.delete(name)
    url.searchParams.set('wb.route',id);for(const [name,value]of Object.entries(params))url.searchParams.set('wb.'+name,value)
    if(window.location.protocol==='http:'||window.location.protocol==='https:')window.history.pushState({},'',url);setRoute({id,params})
  }
  const setPreferences=(partial:Partial<Preferences>)=>setPrefs(current=>{const next=preferencesSchema.parse({...current,...partial});try{localStorage.setItem(preferenceKey,JSON.stringify(next))}catch{/* private mode: keep preferences in memory */}return next})
  const theme=prefs.theme==='system'?(systemDark?'dark':'light'):prefs.theme
  return <div className="wb-root" data-theme={theme} data-density={prefs.density} lang={prefs.locale}>
    <UiProvider value={{client,locale:prefs.locale,preferences:prefs,setPreferences,route,navigate,capabilities,...conversationId?{conversationId}:{}}}>
      <Chrome modules={modules} platform={platform.data} loading={platform.isLoading} error={platform.error} retry={()=>void platform.refetch()}/>
    </UiProvider>
  </div>
}
type Platform=ReturnType<typeof platformSnapshotSchema.parse>
function Chrome({modules,platform,loading,error,retry}:{modules:readonly WebModule[];platform:Platform|undefined;loading:boolean;error:unknown;retry:()=>void}){
  const ui=useWorkbench(),{t,route,navigate,localize,capabilities}=ui,[menu,setMenu]=useState(false),[palette,setPalette]=useState(false),[search,setSearch]=useState('')
  const contributions=platform?.contributions??[]
  const active=new Set(platform?.modules.filter(m=>m.state==='active').map(m=>m.manifest.id)??[])
  const selected=contributions.find(c=>c.id===route.id)
  const module=modules.find(m=>active.has(m.manifest.id)&&m.manifest.contributions.some(c=>c.id===route.id)),View=module?.pages[route.id]
  const go=(id:string)=>{navigate(id);setMenu(false)}
  useEffect(()=>{const key=(e:KeyboardEvent)=>{
    if(e.target instanceof Element&&e.target.closest('[data-wb-terminal]'))return
    if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(open=>!open)}
    if(e.key==='Escape')setMenu(false)
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])
  const nav=(id:string,label:string,icon:ReactNode)=><button key={id} className="wb-nav-link" aria-current={route.id===id?'page':undefined} onClick={()=>go(id)}>{icon}<span>{label}</span></button>
  return <div className="wb-shell">
    <aside className="wb-sidebar" data-open={menu} aria-label={t('workbench')}>
      <div className="wb-brand"><span className="wb-brand-mark"><Layers3 size={19}/></span>Workbench<Button className="wb-mobile-menu" size="icon" variant="ghost" aria-label={t('close')} onClick={()=>setMenu(false)}><X size={16}/></Button></div>
      <nav className="wb-nav-group">{nav('platform.home',t('home'),<Home size={16}/>)}</nav>
      {modules.filter(m=>active.has(m.manifest.id)).map(m=><nav className="wb-nav-group" key={m.manifest.id} aria-label={localize(m.manifest.title)}><div className="wb-nav-label">{localize(m.manifest.title)}</div>{contributions.filter(c=>c.id.startsWith(m.manifest.id+'.')&&(c.kind==='route'||c.kind==='settings')).map(c=>nav(c.id,localize(c.title),<span aria-hidden="true" className="wb-small">{c.kind==='settings'?<Settings size={15}/>:<ChevronRight size={15}/>}</span>))}</nav>)}
      <nav className="wb-nav-group" aria-label={t('settings')}><div className="wb-nav-label">{t('workbench')}</div>{nav('platform.modules',t('modules'),<Blocks size={16}/>)}{nav('platform.settings',t('settings'),<Settings size={16}/>)}{capabilities.has('platform.manage')&&nav('platform.audit',t('audit'),<ShieldCheck size={16}/>)}</nav>
      <div className="wb-sidebar-footer"><div>Workbench {platform?.build.version??'—'}</div><div>{platform?.build.sha.slice(0,8)??'—'}</div></div>
    </aside>
    <main className="wb-main">
      <div className="wb-topbar"><div className="wb-breadcrumb"><Button className="wb-mobile-menu" size="icon" variant="ghost" aria-label={t('modules')} aria-expanded={menu} onClick={()=>setMenu(!menu)}><Menu size={18}/></Button><span>Workbench</span><ChevronRight size={14}/>{module&&<><span>{localize(module.manifest.title)}</span><ChevronRight size={14}/></>}<span>{selected?localize(selected.title):route.id==='platform.modules'?t('modules'):route.id==='platform.settings'?t('settings'):route.id==='platform.audit'?t('audit'):t('home')}</span></div>
        <Button size="sm" onClick={()=>setPalette(true)}><Search size={14}/><span>{t('commands')}</span><kbd className="wb-muted">⌘ K</kbd></Button></div>
      <div className="wb-page">
        {loading?<Skeleton/>:error?<ErrorNotice error={error} retry={retry}/>:route.id==='platform.home'?<HomePage modules={modules} active={active}/>:route.id==='platform.modules'?<ModulesPage platform={platform}/>:route.id==='platform.settings'?<SettingsPage platform={platform}/>:route.id==='platform.audit'&&capabilities.has('platform.manage')?<AuditPage/>:View&&selected&&capabilities.has(selected.capability)?<PageBoundary key={route.id+'-'+platform?.modules.find(m=>m.manifest.id===module?.manifest.id)?.state} fallback={<ErrorNotice error={new Error('page')}/>}><View route={route}/></PageBoundary>:<EmptyState title={t('notAvailable')} description={t('moduleHelp')} action={<Button onClick={()=>navigate('platform.modules')}>{t('modules')}</Button>}/>}
      </div>
    </main>
    <Modal open={palette} onOpenChange={setPalette} title={t('commands')}>
      <Field label={t('search')}><Input data-wb-initial-focus value={search} onChange={e=>setSearch(e.target.value)}/></Field>
      <div className="wb-command-list">{contributions.filter(c=>c.kind!=='widget'&&localize(c.title).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c=><Button key={c.id} variant="ghost" onClick={()=>{setPalette(false);setSearch('');if(c.kind==='command'){modules.find(m=>m.commands?.[c.id])?.commands?.[c.id]?.(ui)}else navigate(c.id)}}><Command size={15}/>{localize(c.title)}</Button>)}</div>
      <div className="wb-dialog-footer"><Button onClick={()=>setPalette(false)}>{t('close')}</Button></div>
    </Modal>
  </div>
}
class PageBoundary extends Component<{children:ReactNode;fallback:ReactNode},{failed:boolean}>{
  state={failed:false};static getDerivedStateFromError(){return {failed:true}}
  componentDidCatch(_error:Error,_info:ErrorInfo){/* Do not log potentially sensitive rendered data. */}
  render(){return this.state.failed?this.props.fallback:this.props.children}
}
function HomePage({modules,active}:{modules:readonly WebModule[];active:Set<string>}){
  const {t,localize,navigate,capabilities}=useWorkbench()
  return <><PageHeader eyebrow="WORKBENCH" title={t('home')} description={t('moduleHint')}/><div className="wb-grid">{modules.filter(m=>active.has(m.manifest.id)).map(m=><Card key={m.manifest.id}><Section module={m}/><p className="wb-muted">{localize(m.manifest.description)}</p><div className="wb-actions" style={{marginTop:16}}>{m.manifest.contributions.filter(c=>c.kind==='route'&&capabilities.has(c.capability)).slice(0,1).map(c=><Button key={c.id} variant="primary" onClick={()=>navigate(c.id)}>{localize(c.title)}<ArrowRight size={15}/></Button>)}</div></Card>)}</div>{modules.filter(m=>active.has(m.manifest.id)).flatMap(m=>Object.entries(m.widgets??{}).filter(([id])=>{const c=m.manifest.contributions.find(c=>c.id===id);return c&&capabilities.has(c.capability)}).map(([id,Widget])=><PageBoundary key={id} fallback={<ErrorNotice error={new Error('widget')}/>}><Widget/></PageBoundary>))}</>
}
function Section({module}:{module:WebModule}){const {localize}=useWorkbench();return <h2 style={{marginBottom:8}}>{localize(module.manifest.title)}</h2>}
function ModulesPage({platform}:{platform:Platform|undefined}){
  const ui=useWorkbench(),{t,client,localize,capabilities}=ui,cache=useQueryClient(),[busy,setBusy]=useState<string|null>(null),[error,setError]=useState<unknown>(null)
  const change=async(id:string,enabled:boolean)=>{
    if(!await ui.confirm({title:t(enabled?'moduleEnableTitle':'moduleDisableTitle'),description:t(enabled?'moduleEnableBody':'moduleDisableBody'),target:id,danger:!enabled}))return
    setBusy(id);setError(null)
    try{await request(client,'platform.module.set',{id,enabled,confirmed:true});await cache.invalidateQueries({queryKey:['platform']});ui.notify(t('saved'))}
    catch(e){setError(e)}finally{setBusy(null)}
  }
  return <><PageHeader title={t('modules')} description={t('moduleHint')}/>{error&&<ErrorNotice error={error}/>}<div className="wb-grid">{platform?.modules.map(m=><Card key={m.manifest.id}><div className="wb-section-header"><h2>{localize(m.manifest.title)}</h2><Badge tone={m.state==='active'?'success':m.state==='failed'?'danger':'neutral'}>{t(m.state as MessageKey)}</Badge></div><p className="wb-muted">{localize(m.manifest.description)}</p><p className="wb-small wb-muted" style={{marginTop:12}}>{m.manifest.version} · API {m.manifest.platformApi} · {m.activeRequests}</p>{m.error&&<p className="wb-small">{m.error}</p>}{m.manifest.id!=='platform'&&capabilities.has('platform.manage')&&<Button style={{marginTop:16}} disabled={!!busy||m.state==='draining'||m.state==='starting'} onClick={()=>void change(m.manifest.id,m.state!=='active')}>{busy===m.manifest.id?t('loading'):t(m.state==='active'?'disable':'enable')}</Button>}</Card>)}</div></>
}
function SettingsPage({platform}:{platform:Platform|undefined}){
  const {t,preferences,setPreferences}=useWorkbench(),[preview,setPreview]=useState(false)
  const diagnostic=JSON.stringify({schema:1,generatedAt:new Date().toISOString(),build:platform?.build,modules:platform?.modules.map(m=>({id:m.manifest.id,state:m.state,error:m.error,activeRequests:m.activeRequests}))},null,2)
  const save=()=>{const blob=new Blob([diagnostic],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='workbench-diagnostics.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);setPreview(false)}
  return <><PageHeader title={t('settings')} description={t('settingsHint')}/><Card><div className="wb-grid"><Field label={t('language')}><Select value={preferences.locale} onChange={e=>setPreferences({locale:e.target.value as Locale})}><option value="zh">简体中文</option><option value="en">English</option></Select></Field><Field label={t('theme')}><Select value={preferences.theme} onChange={e=>setPreferences({theme:e.target.value as Preferences['theme']})}>{(['system','light','dark']as const).map(v=><option key={v} value={v}>{t(v)}</option>)}</Select></Field><Field label={t('density')}><Select value={preferences.density} onChange={e=>setPreferences({density:e.target.value as Preferences['density']})}>{(['comfortable','compact']as const).map(v=><option key={v} value={v}>{t(v)}</option>)}</Select></Field></div></Card><Card><h2>{t('export')}</h2><p className="wb-muted" style={{margin:'10px 0 16px'}}>{t('exportHint')}</p><Button onClick={()=>setPreview(true)}>{t('preview')}</Button></Card><Modal open={preview} onOpenChange={setPreview} title={t('preview')} description={t('exportHint')}><pre className="wb-target">{diagnostic}</pre><div className="wb-dialog-footer"><Button data-wb-initial-focus onClick={()=>setPreview(false)}>{t('cancel')}</Button><Button onClick={save} variant="primary">{t('download')}</Button></div></Modal></>
}
function AuditPage(){
  const {t,client,locale}=useWorkbench()
  const data=useQuery({queryKey:['platform','audit'],queryFn:({signal})=>request<Array<{at:number;actor:string;operation:string;outcome:'accepted'|'succeeded'|'rejected'|'unknown';target?:string;requestId:string;durationMs:number}>>(client,'platform.audit',{limit:100},signal)})
  return <><PageHeader title={t('audit')} description={t('auditHint')} actions={<Button onClick={()=>void data.refetch()}>{t('refresh')}</Button>}/>{data.isLoading?<Skeleton/>:data.error?<ErrorNotice error={data.error}/>:!data.data?.length?<EmptyState title={t('noData')}/>:<Card><DataTable label={t('audit')} items={data.data} rowKey={r=>r.requestId+r.operation+r.at} columns={[{key:'time',label:t('time'),render:r=>new Date(r.at).toLocaleString(locale==='zh'?'zh-CN':'en-US')},{key:'op',label:t('operation'),render:r=><code>{r.operation}</code>},{key:'target',label:t('scope'),render:r=><code>{r.target??'—'}</code>},{key:'actor',label:t('actor'),render:r=><code>{r.actor}</code>},{key:'outcome',label:t('outcome'),render:r=><Badge tone={r.outcome==='rejected'?'warning':'neutral'}>{t(r.outcome)}</Badge>},{key:'id',label:t('requestId'),render:r=><code>{r.requestId}</code>}]}/></Card>}</>
}

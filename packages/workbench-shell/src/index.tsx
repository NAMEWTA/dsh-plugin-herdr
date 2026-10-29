import { Component, useEffect, useLayoutEffect, useMemo, useState, useRef, useId, type CSSProperties, type ErrorInfo, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Blocks, ChevronRight, Command, Home, Layers3, Menu, Search, Settings, ShieldCheck, PanelLeftClose, PanelLeftOpen, X } from 'lucide-react'
import type { Locale, RouteLocation, WorkbenchClient } from '@workbench/contracts'
import { platformSnapshotSchema, preferencesSchema, type Preferences } from '@workbench/contracts/schemas'
import { Badge, Button, Card, DataTable, EmptyState, ErrorNotice, Field, Input, Modal, PageHeader, Select, Skeleton, UiProvider, mountWorkbenchStyles, request, useWorkbench, type MessageKey, type WebModule } from '@workbench/ui'
const preferenceKey='namewta.workbench.preferences.v1'
function readPreferences(locale:Locale):Preferences{
  try{return preferencesSchema.parse({...preferencesSchema.parse(JSON.parse(localStorage.getItem(preferenceKey)??'null')),locale})}
  catch{return {version:1,locale,theme:'system',density:'comfortable'}}
}
function readRoute(fallback:string,conversationId?:string):RouteLocation{
  if(typeof window==='undefined')return {id:fallback,params:{}}
  const query=new URL(window.location.href).searchParams
  if(query.has('wb.context')&&query.get('wb.context')!==(conversationId??'global'))return {id:fallback,params:{}}
  const id=query.get('wb.route')??fallback
  const params:Record<string,string>={}
  for(const [key,value]of query)if(key.startsWith('wb.')&&key!=='wb.route'&&key.length<80&&value.length<1024)params[key.slice(3)]=value
  return {id,params}
}
export function Workbench({client,modules,initialRoute,locale='zh',conversationId,projectPath,sessionEntry=true,presentation='app'}:{client:WorkbenchClient;modules:readonly WebModule[];initialRoute:string;locale?:Locale;conversationId?:string;projectPath?:string;sessionEntry?:boolean;presentation?:'app'|'entry'|'rail'}){
  const [queries]=useState(()=>new QueryClient({defaultOptions:{queries:{staleTime:2000,gcTime:60_000,retry:1,refetchOnWindowFocus:false},mutations:{retry:false}}}))
  useEffect(()=>()=>{queries.clear()},[queries])
  return <QueryClientProvider client={queries}><Shell key={(conversationId??'global')+presentation} client={client} modules={modules} initialRoute={initialRoute} locale={locale} conversationId={conversationId} projectPath={projectPath} sessionEntry={sessionEntry} presentation={presentation}/></QueryClientProvider>
}
function Shell({client,modules,initialRoute,locale,conversationId,projectPath,sessionEntry,presentation}:{client:WorkbenchClient;modules:readonly WebModule[];initialRoute:string;locale:Locale;conversationId?:string;projectPath?:string;sessionEntry:boolean;presentation:'app'|'entry'|'rail'}){
  const cache=useQueryClient(),[prefs,setPrefs]=useState(()=>readPreferences(locale)),[route,setRoute]=useState(()=>readRoute(initialRoute,conversationId)),[systemDark,setSystemDark]=useState(()=>typeof matchMedia!=='undefined'&&matchMedia('(prefers-color-scheme: dark)').matches)
  const frame=useRef<HTMLDivElement>(null)
  useLayoutEffect(()=>{mountWorkbenchStyles(frame.current)},[])
  useEffect(()=>{setPrefs(current=>current.locale===locale?current:preferencesSchema.parse({...current,locale}))},[locale])
  const platform=useQuery({queryKey:['platform','snapshot'],queryFn:async({signal})=>platformSnapshotSchema.parse(await request(client,'platform.snapshot',{},signal)),refetchInterval:10000})
  const capabilities=useMemo(()=>new Set(platform.data?.capabilities??[]),[platform.data?.capabilities])
  useEffect(()=>{const media=matchMedia('(prefers-color-scheme: dark)'),change=()=>setSystemDark(media.matches);media.addEventListener('change',change);return()=>media.removeEventListener('change',change)},[])
  useEffect(()=>{const change=()=>setRoute(readRoute(initialRoute,conversationId));window.addEventListener('popstate',change);return()=>window.removeEventListener('popstate',change)},[initialRoute,conversationId])
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
    url.searchParams.set('wb.context',conversationId??'global');url.searchParams.set('wb.route',id);for(const [name,value]of Object.entries(params))url.searchParams.set('wb.'+name,value)
    if(window.location.protocol==='http:'||window.location.protocol==='https:')window.history.pushState({},'',url);setRoute({id,params})
  }
  const setPreferences=(partial:Partial<Preferences>)=>setPrefs(current=>{const next=preferencesSchema.parse({...current,...partial});try{localStorage.setItem(preferenceKey,JSON.stringify(next))}catch{/* private mode: keep preferences in memory */}return next})
  const theme=prefs.theme==='system'?(systemDark?'dark':'light'):prefs.theme
  return <div ref={frame} className="wb-root" data-theme={theme} data-density={prefs.density} lang={prefs.locale}>
    <UiProvider value={{client,locale:prefs.locale,preferences:prefs,setPreferences,route,navigate,capabilities,...conversationId?{conversationId}:{},...projectPath?{projectPath}:{}}}>
      <Chrome modules={modules} platform={platform.data} loading={platform.isLoading} error={platform.error} retry={()=>void platform.refetch()} presentation={presentation} sessionEntry={sessionEntry}/>
    </UiProvider>
  </div>
}
type Platform=ReturnType<typeof platformSnapshotSchema.parse>
function SessionSlots({modules}:{modules:readonly WebModule[]}){
  const ui=useWorkbench()
  if(!ui.conversationId)return null
  return <>{modules.map(module=>{const Chrome=module.sessionChrome;return Chrome?<Chrome key={module.manifest.id}/>:null})}</>
}
function RailSlots({modules}:{modules:readonly WebModule[]}){
  return <>{modules.map(module=>{const Rail=module.sessionRail;return Rail?<Rail key={module.manifest.id}/>:null})}</>
}
function Chrome({modules,platform,loading,error,retry,presentation,sessionEntry}:{modules:readonly WebModule[];platform:Platform|undefined;loading:boolean;error:unknown;retry:()=>void;presentation:'app'|'entry'|'rail';sessionEntry:boolean}){
  const ui=useWorkbench(),{t,route,navigate,localize,capabilities}=ui
  const [section,setSection]=useState(route.id.startsWith('platform.')?'platform':route.id.split('.')[0]!)
  const [expanded,setExpanded]=useState(true),[narrow,setNarrow]=useState(false),[side,setSide]=useState(280)
  const [palette,setPalette]=useState(false),[search,setSearch]=useState('')
  const root=useRef<HTMLDivElement>(null),navigationId=useId(),pinnedClosed=useRef(false),acted=useRef(new Map<string,{at:number;type:string}>())
  // pointerdown runs the action. The click that completes that press is the same gesture, so it does not run again. A later click is a new gesture.
  const press=(key:string,run:()=>void)=>(event:{type:string;stopPropagation:()=>void})=>{
    event.stopPropagation()
    const now=Date.now(),previous=acted.current.get(key)
    if(event.type==='click'&&previous?.type==='pointerdown'&&now-previous.at<700)return
    acted.current.set(key,{at:now,type:event.type})
    run()
  }
  const contributions=platform?.contributions??[]
  const active=new Set(platform?.modules.filter(m=>m.state==='active').map(m=>m.manifest.id)??[])
  const available=modules.filter(m=>active.has(m.manifest.id)&&m.manifest.contributions.some(c=>capabilities.has(c.capability)))
  const module=available.find(m=>m.manifest.contributions.some(c=>c.id===route.id)),View=module?.pages[route.id]
  const browsing=available.find(m=>m.manifest.id===section),Navigation=browsing?.navigation
  const selected=contributions.find(c=>c.id===route.id)
  const routeTitle=selected?localize(selected.title):route.id==='platform.modules'?t('modules'):route.id==='platform.settings'?t('settings'):route.id==='platform.audit'?t('audit'):t('home')
  useEffect(()=>{
    const element=root.current;if(!element)return
    let previous:boolean|undefined
    const measure=()=>{const next=(element.clientWidth||window.innerWidth)<980;const changed=next!==previous;previous=next;setNarrow(next);if(!changed||(!next&&pinnedClosed.current))return;setExpanded(!next)}
    measure();const observer=new ResizeObserver(measure);observer.observe(element);return()=>observer.disconnect()
  },[])
  useEffect(()=>{
    setSection(route.id.startsWith('platform.')?'platform':route.id.split('.')[0]!)
    if(narrow)setExpanded(false)
  },[route.id,JSON.stringify(route.params)])
  useEffect(()=>{const key=(e:KeyboardEvent)=>{
    if(e.target instanceof Element&&e.target.closest('[data-wb-terminal]'))return
    if((e.ctrlKey||e.metaKey)&&!e.shiftKey&&e.key.toLowerCase()==='k'){e.preventDefault();setPalette(open=>!open)}
  };window.addEventListener('keydown',key);return()=>window.removeEventListener('keydown',key)},[])
  const chooseSection=(id:string)=>{setSection(id);setExpanded(current=>{const next=id===section?!current:true;pinnedClosed.current=!next;return next})}
  const go=(id:string)=>{navigate(id);if(narrow)setExpanded(false)}
  const nav=(id:string,label:string,icon:ReactNode)=><button key={id} className="wb-nav-link" aria-current={route.id===id?'page':undefined} onClick={()=>go(id)}>{icon}<span>{label}</span></button>
  const sidebar=<>
    <div className="wb-sidebar-heading"><div><span className="wb-eyebrow">{section==='platform'?t('workbench'):t('studioEyebrow')}</span><h2>{browsing?localize(browsing.manifest.title):t('systemArea')}</h2></div><Button variant="ghost" size="icon" aria-label={t('collapseNavigation')} onPointerDown={press('collapse',()=>{pinnedClosed.current=true;setExpanded(false)})} onClick={press('collapse',()=>{pinnedClosed.current=true;setExpanded(false)})}><PanelLeftClose size={17}/></Button></div>
    {section==='platform'?<nav className="wb-nav-group" aria-label={t('preferencesArea')}>
      {nav('platform.settings',t('settings'),<Settings size={17}/>)}
      {nav('platform.modules',t('modules'),<Blocks size={17}/>)}
      {capabilities.has('platform.manage')&&nav('platform.audit',t('audit'),<ShieldCheck size={17}/>)}
    </nav>:Navigation?<PageBoundary key={section} fallback={<ErrorNotice error={new Error('navigation')}/>}><Navigation/></PageBoundary>:<nav className="wb-nav-group" aria-label={t('moduleNavigation')}>
      {browsing?.manifest.contributions.filter(c=>(c.kind==='route'||c.kind==='settings')&&capabilities.has(c.capability)).map(c=>nav(c.id,localize(c.title),<ChevronRight size={16}/>))}
    </nav>}
    <div className="wb-sidebar-footer"><span>{t('workbench')}</span><span>{platform?.build.version??'—'}</span></div>
  </>
  const resize=(event:ReactPointerEvent<HTMLDivElement>)=>{
    if(narrow)return
    const startX=event.clientX,start=side
    const move=(e:PointerEvent)=>setSide(Math.min(520,Math.max(240,start+e.clientX-startX)))
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up)}
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up)
  }
  if(presentation==='entry')return <div className="wb-session-inline">{sessionEntry&&<SessionSlots modules={available}/>}</div>
  if(presentation==='rail')return <div className="wb-rightbar-host"><RailSlots modules={available}/></div>
  const showRail=sessionEntry&&!!ui.conversationId&&!narrow
  return <div ref={root} className="wb-shell" data-secondary-open={expanded&&!narrow} data-rightbar={showRail} style={{'--wb-side':side+'px'} as CSSProperties}>
    <nav className="wb-rail" aria-label={t('moduleRail')}>
      <div className="wb-rail-brand" title={t('workbench')}><Layers3 size={23}/></div>
      <div className="wb-rail-modules">{available.map(m=>{const Icon=m.icon??Blocks;const open=()=>chooseSection(m.manifest.id);return <button key={m.manifest.id} className="wb-rail-button" title={localize(m.manifest.title)} aria-label={localize(m.manifest.title)} aria-pressed={section===m.manifest.id} aria-expanded={section===m.manifest.id&&expanded} aria-controls={navigationId} onPointerDown={press('section-'+m.manifest.id,open)} onClick={press('section-'+m.manifest.id,open)}><Icon size={21}/><span className="wb-rail-indicator"/></button>})}</div>
      <div className="wb-rail-bottom"><button className="wb-rail-button" title={t('commands')} aria-label={t('commands')} onClick={()=>setPalette(true)}><Search size={20}/></button><button className="wb-rail-button" title={t('systemArea')} aria-label={t('systemArea')} aria-pressed={section==='platform'} aria-expanded={section==='platform'&&expanded} aria-controls={navigationId} onPointerDown={press('section-platform',()=>chooseSection('platform'))} onClick={press('section-platform',()=>chooseSection('platform'))}><Settings size={21}/></button></div>
    </nav>
    {!narrow&&<aside id={navigationId} hidden={!expanded} className="wb-sidebar" aria-label={t('navigation')}>{sidebar}{expanded&&<div className="wb-side-resizer" role="separator" aria-orientation="vertical" aria-label={t('resizeSidebar')} onPointerDown={resize}/>}</aside>}
    {narrow&&<Modal open={expanded} onOpenChange={setExpanded} title={t('navigation')} className="wb-navigation-dialog"><div id={navigationId} className="wb-sidebar wb-drawer-content">{sidebar}</div></Modal>}
    <main className="wb-main">
      <div className="wb-topbar"><div className="wb-breadcrumb"><Button size="icon" variant="ghost" aria-label={t(expanded?'collapseNavigation':'expandNavigation')} aria-expanded={expanded} aria-controls={navigationId} onPointerDown={press('topbar-nav',()=>setExpanded(current=>{const next=!current;pinnedClosed.current=!next;return next}))} onClick={press('topbar-nav',()=>setExpanded(current=>{const next=!current;pinnedClosed.current=!next;return next}))}><PanelLeftOpen size={18}/></Button><span>{module?localize(module.manifest.title):t('systemArea')}</span><ChevronRight size={13}/><strong>{routeTitle}</strong></div>
        {sessionEntry&&<div className="wb-topbar-session"><SessionSlots modules={available}/></div>}
        <Button size="sm" variant="ghost" aria-label={t('commands')} onClick={()=>setPalette(true)}><Search size={15}/><span className="wb-command-label">{t('commands')}</span><kbd className="wb-muted">⌘ K</kbd></Button></div>
      <div className="wb-page">
        {loading?<Skeleton/>:error?<ErrorNotice error={error} retry={retry}/>:route.id==='platform.home'?<HomePage modules={modules} active={active}/>:route.id==='platform.modules'?<ModulesPage platform={platform}/>:route.id==='platform.settings'?<SettingsPage platform={platform}/>:route.id==='platform.audit'&&capabilities.has('platform.manage')?<AuditPage/>:View&&selected&&capabilities.has(selected.capability)?<PageBoundary key={route.id+'-'+platform?.modules.find(m=>m.manifest.id===module?.manifest.id)?.state} fallback={<ErrorNotice error={new Error('page')}/>}><View route={route}/></PageBoundary>:<EmptyState title={t('notAvailable')} description={t('moduleHelp')} action={<Button onClick={()=>go('platform.modules')}>{t('modules')}</Button>}/>}
      </div>
    </main>
    {showRail&&<div className="wb-rightbar" role="region" aria-label="Herdr"><div className="wb-rightbar-tab" aria-current="page">Herdr</div><div className="wb-rightbar-host"><RailSlots modules={available}/></div></div>}
    <Modal open={palette} onOpenChange={setPalette} title={t('commands')}>
      <Field label={t('search')}><Input data-wb-initial-focus value={search} onChange={e=>setSearch(e.target.value)}/></Field>
      <div className="wb-command-list">{contributions.filter(c=>c.kind!=='widget'&&capabilities.has(c.capability)&&localize(c.title).toLocaleLowerCase().includes(search.toLocaleLowerCase())).map(c=><Button key={c.id} variant="ghost" onClick={()=>{setPalette(false);setSearch('');if(c.kind==='command'){modules.find(m=>m.commands?.[c.id])?.commands?.[c.id]?.(ui)}else go(c.id)}}><Command size={15}/>{localize(c.title)}</Button>)}</div>
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
  return <><PageHeader eyebrow={t('workbench')} title={t('home')} description={t('moduleHint')}/><div className="wb-grid">{modules.filter(m=>active.has(m.manifest.id)).map(m=><Card key={m.manifest.id}><Section module={m}/><p className="wb-muted">{localize(m.manifest.description)}</p><div className="wb-actions" style={{marginTop:16}}>{m.manifest.contributions.filter(c=>c.kind==='route'&&capabilities.has(c.capability)).slice(0,1).map(c=><Button key={c.id} variant="primary" onClick={()=>navigate(c.id)}>{localize(c.title)}<ArrowRight size={15}/></Button>)}</div></Card>)}</div>{modules.filter(m=>active.has(m.manifest.id)).flatMap(m=>Object.entries(m.widgets??{}).filter(([id])=>{const c=m.manifest.contributions.find(c=>c.id===id);return c&&capabilities.has(c.capability)}).map(([id,Widget])=><PageBoundary key={id} fallback={<ErrorNotice error={new Error('widget')}/>}><Widget/></PageBoundary>))}</>
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

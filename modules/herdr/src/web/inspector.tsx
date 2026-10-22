import { Fragment, useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Copy, Eye, Folder, RefreshCw } from 'lucide-react'
import { Button, Card, EmptyState, ErrorNotice, Field, Notice, PageHeader, Select, Skeleton, useWorkbench, type PageProps } from '@workbench/ui'
import { WorkbenchError } from '@workbench/contracts'
import type { Pane, PaneInspection } from '../contracts/index.ts'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { call, useSnapshot } from './api.ts'
import { goToPane, readTarget } from './parts.tsx'

const words={
  title:['面板详情与 CLI','Pane inspector'],select:['选择面板','Select a pane'],
  notice:['仅展示与复制；不会执行命令或取得控制权限。请在运行 DSH 的主机上使用 POSIX shell。','Inspect and copy only; no commands are executed and no control is acquired. Use a POSIX shell on the DSH host.'],
  unavailable:['目标未验证，暂不提供命令。请检查 Herdr 连接。','Commands are unavailable until the executable and endpoint are verified. Check the Herdr connection.'],
  pane:['面板 ID','Pane ID'],workspace:['工作区 ID','Workspace ID'],tab:['标签 ID','Tab ID'],
  cwd:['面板当前目录','Pane working directory'],agent:['Agent','Agent'],state:['上报状态','Reported status'],
  socket:['完整套接字路径','Full socket path'],binary:['可执行文件','Executable'],session:['Herdr 会话','Herdr session'],
  view:['只读查看','View read-only'],open:['打开工作区','Open workspace'],copy:['复制命令','Copy command'],
  copied:['已复制','Copied'],failed:['剪贴板不可用，请手动选中命令复制。','Clipboard unavailable. Select and copy the command manually.'],
  snapshot:['服务快照','Server snapshot'],layout:['服务端布局','Daemon layout'],process:['前台进程','Foreground process'],
  output:['可见输出（最多 80 行）','Visible output (up to 80 lines)'],agentCommand:['代理元数据（如已注册）','Agent metadata (if registered)'],
} as const
export function InspectorPage({route}:PageProps) {
  const ui=useWorkbench(),query=useSnapshot(),target=readTarget(route.params),[chosen,setChosen]=useState('')
  const text=(key:keyof typeof words)=>words[key][ui.locale==='zh'?0:1]
  useEffect(()=>setChosen(''),[route.params.target])
  const pane=query.data?.panes.find(p=>resourceKey(p.ref)===(chosen||(target&&resourceKey(target))))
  return <>
    <PageHeader title={text('title')} description={text('notice')}/>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error}/>:<>
      <Field label={text('select')}><Select value={pane?resourceKey(pane.ref):''} onChange={e=>setChosen(e.target.value)}>
        <option value="">{text('select')}</option>{query.data?.panes.map(p=><option key={resourceKey(p.ref)} value={resourceKey(p.ref)}>{p.label||p.ref.id} · {p.ref.id}</option>)}
      </Select></Field>
      {query.data?.stale?<Notice tone="warning">{ui.t('STALE_SNAPSHOT')}</Notice>:pane?<Inspection key={resourceKey(pane.ref)} pane={pane}/>:<EmptyState title={target?ui.t('RESOURCE_CHANGED'):text('select')}/>}
    </>}
  </>
}
function Inspection({pane}:{pane:Pane}) {
  const ui=useWorkbench(),text=(key:keyof typeof words)=>words[key][ui.locale==='zh'?0:1]
  const [busy,setBusy]=useState(false),[failure,setFailure]=useState<unknown>(null)
  const lifecycle=useRef(new AbortController())
  useEffect(()=>()=>lifecycle.current.abort(),[])
  const query=useQuery({queryKey:['herdr','inspect',resourceKey(pane.ref)],queryFn:({signal})=>call(ui.client,'herdr.pane.inspect',{ref:pane.ref},signal),retry:false,staleTime:0,gcTime:0,refetchInterval:5000})
  const copy=async(id:PaneInspection['commands'][number]['id'])=>{
    if(busy||!query.data||query.error)return
    setBusy(true);setFailure(null)
    try {
      const before=query.data,next=await call(ui.client,'herdr.pane.inspect',{ref:pane.ref},lifecycle.current.signal)
      if(lifecycle.current.signal.aborted)return
      if(!sameResource(before.pane.ref,next.pane.ref)||before.socketPath!==next.socketPath||before.binary!==next.binary)throw new WorkbenchError('RESOURCE_CHANGED')
      const command=next.commands.find(c=>c.id===id)?.command
      if(!command)throw new WorkbenchError('RESOURCE_CHANGED')
      try{await navigator.clipboard.writeText(command);if(!lifecycle.current.signal.aborted)ui.notify(text('copied'))}
      catch{if(!lifecycle.current.signal.aborted)ui.notify(text('failed'),'danger')}
    }catch(error){if(!lifecycle.current.signal.aborted){setFailure(error);void query.refetch()}}
    finally{if(!lifecycle.current.signal.aborted)setBusy(false)}
  }
  if(query.isLoading)return <Skeleton/>
  if(query.error)return <ErrorNotice error={query.error} retry={()=>void query.refetch()}/>
  const data=query.data
  if(!data)return null
  const facts:[keyof typeof words,string|null][]=[['pane',data.pane.ref.id],['workspace',data.workspace.ref.id],['tab',data.tab.ref.id],['cwd',data.pane.cwd],['agent',data.pane.agent],['state',data.pane.state],['socket',data.socketPath],['binary',data.binary],['session',data.session]]
  return <div className="wb-stack" data-pane-inspector={pane.ref.id}>
    <Card><dl className="wb-definition">{facts.map(([key,value])=><Fragment key={key}><dt>{text(key)}</dt><dd><code>{value??'—'}</code></dd></Fragment>)}</dl>
      <div className="wb-actions"><Button disabled={busy||query.isFetching} onClick={()=>void query.refetch()}><RefreshCw size={14}/>{ui.t('refresh')}</Button>
        <Button onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(data.workspace.ref)})}><Folder size={14}/>{text('open')}</Button>
        {ui.capabilities.has('herdr.observe')&&<Button onClick={()=>goToPane(ui,data.pane)}><Eye size={14}/>{text('view')}</Button>}
      </div>
    </Card>
    {failure!=null&&<ErrorNotice error={failure}/>}
    {!data.commands.length&&<Notice>{text('unavailable')}</Notice>}
    <div className="wb-grid">{(failure?[]:data.commands).map(c=><Card key={c.id}>
      <div className="wb-section-header"><h2>{text(c.id==='agent'?'agentCommand':c.id)}</h2><Button size="sm" disabled={busy||query.isFetching} aria-label={text('copy')+': '+text(c.id==='agent'?'agentCommand':c.id)} onClick={()=>void copy(c.id)}><Copy size={14}/>{text('copy')}</Button></div>
      <pre tabIndex={0} className="wb-target" data-inspector-command={c.id}><code>{c.command}</code></pre>
    </Card>)}</div>
  </div>
}

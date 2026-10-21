import { Folder, Plus } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNotice, Metric, PageHeader, SectionHeader, Skeleton, useWorkbench } from '@workbench/ui'
import { summary } from '../domain/selectors.ts'
import { useSnapshot } from './api.ts'
import { AttentionList } from './attention.tsx'
import { Health } from './parts.tsx'
import { useHerdrText } from './messages.ts'
export function OverviewPage(){
  const ui=useWorkbench(),{t,locale}=ui,h=useHerdrText(),query=useSnapshot(),s=query.data,count=s?summary(s):null
  return <><PageHeader eyebrow="HERDR / LOCAL" title={h('overview')} description={h('overviewHint')} actions={ui.capabilities.has('herdr.manage')?<Button variant="primary" onClick={()=>ui.navigate('herdr.workspaces',{create:'1'})}><Plus size={15}/>{h('createWorkspace')}</Button>:undefined}/>
    {query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>:s&&count&&<><Health snapshot={s} onRefresh={()=>void query.refetch()}/><div className="wb-metrics"><Metric label={h('workspaces')} value={s.sampledAt?count.workspaces:'—'}/><Metric label={h('agents')} value={s.sampledAt?count.agents:'—'}/><Metric label={h('working')} value={s.sampledAt?count.working:'—'}/><Metric label={h('blocked')} value={s.sampledAt?count.blocked:'—'}/></div>
      <AttentionList snapshot={s} limit={5}/><div className="wb-columns"><Card><SectionHeader title={h('workspaces')} action={<Button size="sm" variant="ghost" onClick={()=>ui.navigate('herdr.workspaces')}>{t('all')}</Button>}/>{s.workspaces.length?s.workspaces.slice(0,8).map(w=><div key={w.ref.id} className="wb-row"><div className="wb-row-main"><div className="wb-actions"><Folder size={16}/><strong>{w.label||w.ref.id}</strong><Badge>{h(w.ownership)}</Badge></div><span className="wb-small wb-muted">{w.ref.id} · {w.tabCount} {h('tabs')} · {w.paneCount} {h('panes')}</span></div><Button size="sm" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(w.ref)})}>{t('details')}</Button></div>):<EmptyState title={h('emptyWorkspaces')} description={h('emptyWorkspacesHint')}/>}</Card>
      <Card><SectionHeader title={h('recentActivity')} description={h('activityHint')}/>{s.activity.length?s.activity.slice(0,8).map(e=><div className="wb-row" key={e.id}><div className="wb-row-main"><code>{e.type}</code><span className="wb-small wb-muted">{e.resourceId??h('local')}</span></div><time className="wb-small wb-muted">{new Date(e.at).toLocaleTimeString(locale==='zh'?'zh-CN':'en-US')}</time></div>):<EmptyState title={h('noEvents')}/>}</Card></div></>}
  </>
}

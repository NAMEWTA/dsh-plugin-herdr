import { useState } from 'react'
import { Button, Card, DataTable, EmptyState, ErrorNotice, Field, Input, PageHeader, Select, Skeleton, useWorkbench } from '@workbench/ui'
import { filterPanes,resourceKey } from '../domain/selectors.ts'
import { useSnapshot } from './api.ts'
import { useHerdrText } from './messages.ts'
import { goToPane,Health,Status } from './parts.tsx'
export function AgentsPage(){
  const ui=useWorkbench(),{t}=ui,h=useHerdrText(),query=useSnapshot(),[search,setSearch]=useState(''),[state,setState]=useState('all')
  const items=query.data?filterPanes(query.data.panes.filter(p=>p.agent),search,state):[]
  return <><PageHeader title={h('agents')} description={h('agentHint')}/>{query.isLoading?<Skeleton/>:query.error?<ErrorNotice error={query.error}/>:query.data&&<><Health snapshot={query.data} onRefresh={()=>void query.refetch()}/><div className="wb-toolbar"><Field label={t('search')}><Input value={search} onChange={e=>setSearch(e.target.value)}/></Field><Field label={h('state')}><Select value={state} onChange={e=>setState(e.target.value)}><option value="all">{t('all')}</option>{(['working','blocked','done','idle','unknown']as const).map(v=><option value={v} key={v}>{h(v)}</option>)}</Select></Field></div>{items.length?<Card><DataTable label={h('agents')} items={items} rowKey={p=>resourceKey(p.ref)} columns={[{key:'name',label:h('name'),render:p=><strong>{p.label}</strong>},{key:'state',label:h('state'),render:p=><Status state={p.state} agent={p.agent} raw/>},{key:'agent',label:h('agents'),render:p=>p.agent},{key:'workspace',label:h('workspaces'),render:p=><code>{p.workspaceId}</code>},{key:'cwd',label:h('directory'),render:p=><span className="wb-small">{p.cwd??'—'}</span>},{key:'actions',label:t('operation'),render:p=><Button size="sm" disabled={query.data?.stale} onClick={()=>goToPane(ui,p)}>{h('inspect')}</Button>}]}/></Card>:<EmptyState title={search||state!=='all'?t('noResults'):h('noAgents')} description={h('noAgentsHint')}/>}</>}
  </>
}

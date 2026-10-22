import { ArrowUpRight, Folder, Keyboard, Terminal } from 'lucide-react'
import { Button, Card, useWorkbench } from '@workbench/ui'
import type { HerdrSnapshot, Workspace } from '../contracts/index.ts'
import { resourceKey } from '../domain/selectors.ts'
import { goToPane } from './parts.tsx'
import { useHerdrText } from './messages.ts'
export function WorkspacePreview({workspace:w,snapshot:s}:{workspace:Workspace;snapshot:HerdrSnapshot}) {
  const ui=useWorkbench(),h=useHerdrText(),panes=s.panes.filter(p=>p.workspaceId===w.ref.id)
  return <Card className="wb-workspace-preview">
    <div className="wb-workspace-preview-heading"><span className="wb-workspace-glyph"><Folder size={20}/></span><button className="wb-workspace-open" onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(w.ref)})}><strong>{w.label||w.ref.id}</strong><span>{w.tabCount} {h('tabs')} · {w.paneCount} {h('panes')}</span></button><ArrowUpRight size={17} className="wb-muted" aria-hidden="true"/></div>
    <div className="wb-pane-preview-list">{panes.slice(0,4).map(p=><div className="wb-pane-preview" key={resourceKey(p.ref)}>
      <button className="wb-pane-preview-open" disabled={s.stale||!ui.capabilities.has('herdr.observe')} onClick={()=>goToPane(ui,p)} aria-label={h('viewPane')+' '+(p.label||p.ref.id)}><Terminal size={15}/><span><strong>{p.label||p.ref.id}</strong><small>{p.agent??'Shell'} · {h(p.state)}</small></span><span className={'wb-state-dot wb-state-'+p.state}/></button>
      {ui.capabilities.has('herdr.control')&&<Button size="icon" variant="ghost" aria-label={h('controlPane')+' '+(p.label||p.ref.id)} title={h('controlShort')} disabled={s.stale||(p.ownership==='external'&&!ui.capabilities.has('herdr.manage'))} onClick={()=>goToPane(ui,p,'control')}><Keyboard size={15}/></Button>}
    </div>)}{!panes.length&&<p className="wb-tree-empty">{h('noPanes')}</p>}</div>
    <div className="wb-workspace-preview-footer"><span className="wb-truncate" title={panes.find(p=>p.cwd)?.cwd??''}>{panes.find(p=>p.cwd)?.cwd??w.ref.id}</span><button onClick={()=>ui.navigate('herdr.workspaces',{target:JSON.stringify(w.ref)})}>{h('openWorkspace')}<Chevron/></button></div>
  </Card>
}
function Chevron(){return <ArrowUpRight size={13} aria-hidden="true"/>}

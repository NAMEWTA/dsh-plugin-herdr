/**
 * Session ownership tree. Grouping is analogous to a subagent directory:
 * conversation, then workspace, tab and terminal. Interaction timing follows
 * the DSH subagent header (open after 150ms, close after 120ms).
 */
import { useEffect, useRef, useState } from 'react'
import { ChevronRight, Terminal, X } from 'lucide-react'
import { Button, useWorkbench } from '@workbench/ui'
import type { ResourceRef, SessionResources } from '../contracts/index.ts'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { useSessionResources, useSnapshot } from './api.ts'
import { useHerdrText, type HerdrMessage } from './messages.ts'
import { PaneSession } from './terminal/page.tsx'
import { StatusMark } from './status-mark.tsx'

type Entry = SessionResources['nodes'][number]['entries'][number]
const origins: Record<Entry['origin'], HerdrMessage> = {tool:'originTool', ui:'originUi', bound:'originBound'}
const presences: Record<Entry['presence'], HerdrMessage> = {running:'presenceRunning', exited:'presenceExited', closed:'presenceClosed', missing:'presenceMissing'}

export function SessionChrome() {
  const ui = useWorkbench(), h = useHerdrText(), query = useSessionResources(), snapshot = useSnapshot()
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false), [dock, setDock] = useState<ResourceRef | null>(null)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const nodes = query.data?.nodes ?? []
  const entries = nodes.flatMap(node => node.entries)
  const terminals = entries.filter(entry => entry.role === 'terminal' || entry.role === 'agent')
  useEffect(() => () => {clearTimeout(closeTimer.current); clearTimeout(openTimer.current)}, [])
  if (!ui.conversationId || query.isError || !terminals.length) return null
  const count = terminals.filter(entry => entry.presence === 'running').length || terminals.length
  const hover = (next: boolean) => {
    clearTimeout(openTimer.current); clearTimeout(closeTimer.current)
    if (pinned) return
    if (next) openTimer.current = setTimeout(() => setOpen(true), 150)
    else closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  const pane = dock && snapshot.data?.panes.find(item => sameResource(item.ref, dock))
  return <div className="wb-session-anchor" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
    <button type="button" className="wb-session-trigger" data-session-terminals aria-expanded={open} aria-haspopup="dialog" onClick={() => {setPinned(value => !value); setOpen(value => !value)}}>
      <Terminal size={14} aria-hidden="true"/><span>{ui.locale === 'zh' ? `终端 ${count}` : `${count} terminals`}</span>
    </button>
    {open && <div className="wb-session-popover" role="dialog" aria-label={h('sessionTree')} onMouseEnter={() => hover(true)}>
      <header><strong>{h('sessionTerminals')}</strong><span className="wb-muted wb-small">{ui.conversationId}</span></header>
      {nodes.map(node => <section key={node.conversationId} className="wb-session-node">
        {node.parentConversationId && <p className="wb-session-child"><ChevronRight size={12}/>{h('childSession')} · {node.conversationId}</p>}
        <OwnershipTree entries={node.entries} onOpen={ref => {setDock(ref); setOpen(false); setPinned(false)}}/>
      </section>)}
    </div>}
    {dock && <div className="wb-session-dock" role="complementary" aria-label={h('sessionDock')}>
      <header><div><strong>{pane?.label || h('sessionDock')}</strong><p>{h('dockHint')}</p></div><Button size="icon" variant="ghost" aria-label={h('closeDock')} onClick={() => setDock(null)}><X size={16}/></Button></header>
      {pane && snapshot.data ? <PaneSession key={resourceKey(pane.ref)} pane={pane} stale={snapshot.data.stale} initialMode="observe"/> : <p className="wb-muted">{h('presenceMissing')}</p>}
    </div>}
  </div>
}

function OwnershipTree({entries,onOpen}:{entries:readonly Entry[];onOpen:(ref:ResourceRef)=>void}) {
  const h = useHerdrText()
  const panes = entries.filter(entry => entry.role === 'terminal' || entry.role === 'agent')
  const workspaces = entries.filter(entry => entry.role === 'workspace')
  const ids = [...new Set([...workspaces.map(workspace => workspace.ref.id), ...panes.map(pane => pane.workspaceId).filter((id): id is string => !!id)])]
  const groups = ids.map(id => {
    const workspace = workspaces.find(item => item.ref.id === id)
    const grouped = panes.filter(pane => pane.workspaceId === id)
    return {id, title: workspace?.title || grouped.find(pane => pane.workspaceLabel)?.workspaceLabel || id, origin: workspace?.origin ?? grouped[0]?.origin ?? 'tool' as const, panes: grouped}
  })
  const loose = panes.filter(pane => !pane.workspaceId)
  if (loose.length) groups.push({id: 'loose', title: h('ungrouped'), origin: loose[0]!.origin, panes: loose})
  return <ul className="wb-session-tree">{groups.map(group => {
    const tabs = entries.filter(entry => entry.role === 'tab' && entry.workspaceId === group.id)
    const buckets = tabs.length ? [...tabs.map(tab => ({id: tab.ref.id, title: tab.title, panes: group.panes.filter(pane => pane.tabId === tab.ref.id)})), {id: 'rest', title: '', panes: group.panes.filter(pane => !pane.tabId || !tabs.some(tab => tab.ref.id === pane.tabId))}] : [{id: 'all', title: '', panes: group.panes}]
    return <li key={group.id}>
      <div className="wb-session-workspace"><strong>{group.title}</strong><small>{h(origins[group.origin])}</small></div>
      {buckets.filter(bucket => bucket.panes.length || bucket.title).map(bucket => <div key={bucket.id}>
        {bucket.title && <div className="wb-session-tab">{bucket.title}</div>}
        <ul>{bucket.panes.map(pane => <li key={pane.role + resourceKey(pane.ref)} data-presence={pane.presence}>
          <button type="button" className="wb-session-leaf" disabled={pane.presence !== 'running' || pane.ref.kind !== 'pane'} onClick={() => onOpen(pane.ref)}>
            <StatusMark state={pane.state}/><span><strong>{pane.title}</strong><small>{(pane.agent ?? 'shell') + ' · ' + h(origins[pane.origin]) + ' · ' + h(presences[pane.presence])}</small></span>
          </button>
        </li>)}</ul>
      </div>)}
    </li>
  })}</ul>
}

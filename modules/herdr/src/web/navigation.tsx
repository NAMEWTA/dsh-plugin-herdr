/**
 * Sidebar lists follow the Ovis workspace + agent rows (devswha/ovis, MIT).
 * Copyright © 2026 devswha. Adapted to @workbench/ui, Tailwind 4 and DSH tokens.
 * See THIRD_PARTY_NOTICES.md.
 */
import { useMemo, useState } from 'react'
import { Bot, Inbox, LayoutDashboard, MessageSquare, Plus, Search, Settings2 } from 'lucide-react'
import { Button, ErrorNotice, Input, Skeleton, useWorkbench } from '@workbench/ui'
import type { AgentState, HerdrSnapshot, Pane } from '../contracts/index.ts'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { useBinding, useSnapshot } from './api.ts'
import { ResourcePalette, useResourcePalette } from './command-palette.tsx'
import { goToPane, readTarget } from './parts.tsx'
import { AgentMark, ResourceRow } from './status-mark.tsx'
import { useHerdrText } from './messages.ts'

const rank: Record<AgentState, number> = {blocked: 0, working: 1, done: 2, unknown: 3, idle: 4}
function urgent(panes: readonly Pane[]): Pane | undefined {return [...panes].sort((a,b) => rank[a.state] - rank[b.state] || a.label.localeCompare(b.label))[0]}

/** Herdr contributes its navigation; the shell knows nothing about its resource model. */
export function HerdrNavigation() {
  const ui = useWorkbench(), h = useHerdrText(), query = useSnapshot(), binding = useBinding(), palette = useResourcePalette()
  const [search, setSearch] = useState('')
  const s = query.data, target = readTarget(ui.route.params)
  const bound = s?.workspaces.find(workspace => binding.data?.ref && sameResource(workspace.ref, binding.data.ref))
  const targetPane = s?.panes.find(pane => target?.kind === 'pane' && sameResource(pane.ref, target))
  const targetWorkspace = target?.kind === 'workspace' ? target.id : targetPane?.workspaceId
  const needle = search.trim().toLocaleLowerCase()
  const visible = useMemo(() => filterSnapshot(s, needle), [s, needle])
  const nav = (route: string, label: string, Icon: typeof Bot) => <button className="wb-nav-icon" aria-label={label} title={label} aria-current={ui.route.id === route ? 'page' : undefined} onClick={() => ui.navigate(route)}><Icon size={16}/></button>
  return <div className="wb-module-navigation">
    <div className="wb-nav-icons" aria-label={h('herdrNavigation')}>
      {nav('herdr.overview', h('navOverview'), LayoutDashboard)}
      {nav('herdr.attention', h('navAttention'), Inbox)}
      {nav('herdr.agents', h('agents'), Bot)}
      <button className="wb-nav-icon" aria-label={h('resourcePalette')} title={h('resourcePalette')} onClick={() => palette.setOpen(true)}><Search size={16}/></button>
    </div>
    {ui.conversationId && <div className="wb-session-link"><div className="wb-actions"><MessageSquare size={14}/><strong>{h('thisConversation')}</strong></div>{binding.isLoading ? <span>{ui.t('loading')}</span> : binding.error ? <ErrorNotice error={binding.error}/> : bound ? <button className="wb-text-link" onClick={() => ui.navigate('herdr.workspaces', {target: JSON.stringify(bound.ref)})}>{bound.label || bound.ref.id}</button> : <button className="wb-text-link" onClick={() => ui.navigate('herdr.workspaces')}>{binding.data?.ref ? h('workspaceMissing') : h('linkWorkspace')}</button>}</div>}
    <div className="wb-tree-heading"><button onClick={() => ui.navigate('herdr.workspaces')}>{h('workspaces')}</button>{ui.capabilities.has('herdr.manage') && <Button variant="ghost" size="icon" title={h('createWorkspace')} aria-label={h('createFromNavigation')} disabled={!!s?.stale} onClick={() => ui.navigate('herdr.workspaces', {create: '1'})}><Plus size={16}/></Button>}</div>
    <Input aria-label={h('filterRows')} placeholder={h('filterRows')} value={search} onChange={event => setSearch(event.target.value)} className="wb-tree-search"/>
    {query.isLoading ? <Skeleton/> : query.error ? <ErrorNotice error={query.error} retry={() => void query.refetch()}/> : <nav className="wb-workspace-tree" aria-label={h('workspaceTree')}>
      <ul className="wb-resource-list">
        {visible.workspaces.map(workspace => {
          const panes = visible.panes.filter(pane => pane.workspaceId === workspace.ref.id)
          const primary = urgent(panes.length ? panes : (s?.panes.filter(pane => pane.workspaceId === workspace.ref.id) ?? []))
          const agents = (s?.panes ?? []).filter(pane => pane.workspaceId === workspace.ref.id && pane.agent)
          return <li key={resourceKey(workspace.ref)}><ResourceRow icon={primary?.agent ? <AgentMark kind={primary.agent}/> : <AgentMark kind={null}/>} title={workspace.label || workspace.ref.id} subtitle={(primary?.agent ?? h('shellKind')) + ' · ' + (primary?.cwd ?? workspace.ref.id)} state={primary?.state} count={Math.max(0, agents.length - (primary?.agent ? 1 : 0))} selected={targetWorkspace === workspace.ref.id && !targetPane} disabled={false} label={workspace.label || workspace.ref.id} onClick={() => ui.navigate('herdr.workspaces', {target: JSON.stringify(workspace.ref)})}/></li>
        })}
        {!visible.workspaces.length && <li className="wb-tree-empty">{needle ? ui.t('noResults') : h('emptyTree')}</li>}
      </ul>
      <div className="wb-tree-heading"><span>{h('agents')}</span></div>
      <ul className="wb-resource-list">
        {visible.agents.slice(0, 80).map(pane => {
          const workspace = s?.workspaces.find(item => item.ref.id === pane.workspaceId)
          const siblings = (s?.panes ?? []).filter(item => item.workspaceId === pane.workspaceId && item.agent && item.ref.id !== pane.ref.id)
          return <li key={resourceKey(pane.ref)}><ResourceRow icon={<AgentMark kind={pane.agent}/>} title={pane.label || pane.ref.id} subtitle={(pane.agent ?? h('shellKind')) + ' · ' + (workspace?.label || pane.workspaceId)} state={pane.state} count={siblings.length} selected={!!targetPane && sameResource(targetPane.ref, pane.ref)} disabled={!!s?.stale || !ui.capabilities.has('herdr.observe')} label={h('viewPane') + ' ' + (pane.label || pane.ref.id)} onClick={() => goToPane(ui, pane)}/></li>
        })}
        {!visible.agents.length && <li className="wb-tree-empty">{needle ? ui.t('noResults') : h('noAgents')}</li>}
      </ul>
    </nav>}
    <nav className="wb-nav-group wb-module-footer" aria-label={h('connectionSettings')}>
      <button className="wb-nav-link" aria-current={ui.route.id === 'herdr.environment' ? 'page' : undefined} onClick={() => ui.navigate('herdr.environment')}><Settings2 size={17}/><span>{h('connectionSettings')}</span></button>
      <div className="wb-connection-line"><span className={'wb-state-dot wb-state-' + (s?.connection === 'online' && !s.stale ? 'done' : 'unknown')}/><span>{s ? h(s.connection) : h('connecting')}</span><span className="wb-truncate">{s?.session ?? ''}</span></div>
    </nav>
    <ResourcePalette open={palette.open} onOpenChange={palette.setOpen}/>
  </div>
}

function filterSnapshot(snapshot: HerdrSnapshot | undefined, needle: string) {
  if (!snapshot) return {workspaces: [], panes: [], agents: [] as Pane[]}
  const match = (...parts: Array<string | null | undefined>) => !needle || parts.join(' ').toLocaleLowerCase().includes(needle)
  const panes = snapshot.panes.filter(pane => match(pane.label, pane.ref.id, pane.agent, pane.cwd, snapshot.workspaces.find(item => item.ref.id === pane.workspaceId)?.label))
  const workspaces = [...snapshot.workspaces].filter(workspace => match(workspace.label, workspace.ref.id) || panes.some(pane => pane.workspaceId === workspace.ref.id)).sort((a,b) => a.ref.id.localeCompare(b.ref.id, undefined, {numeric: true}))
  return {workspaces, panes, agents: panes.filter(pane => pane.agent)}
}

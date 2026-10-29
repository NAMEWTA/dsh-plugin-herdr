/**
 * The session's project workspace, shown in the right rail and the header shortcut.
 * Both read the same binding, snapshot and ledger.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { ChevronRight, Folder, FolderPlus, Terminal } from 'lucide-react'
import { Button, ErrorNotice, useWorkbench } from '@workbench/ui'
import type { Pane, ResourceRef, SessionResources } from '../contracts/index.ts'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { presentTerminal, tabHeading, terminalTitle } from '../domain/status.ts'
import { useAction, useBinding, useSessionResources, useSnapshot } from './api.ts'
import { useHerdrText, type HerdrMessage } from './messages.ts'
import { openSessionRail, requestWorkbenchPage, workspaceLabelFromPath } from './session-bridge.ts'
import { PaneSession } from './terminal/page.tsx'
import { AgentMark, ResourceRow } from './status-mark.tsx'
import { rememberWorkspace } from './workspaces.tsx'

type Entry = SessionResources['nodes'][number]['entries'][number]
const origins: Record<Entry['origin'], HerdrMessage> = {tool:'originTool', ui:'originUi', bound:'originBound'}
const presences: Record<Entry['presence'], HerdrMessage> = {running:'presenceRunning', exited:'presenceExited', closed:'presenceClosed', missing:'presenceMissing'}

let selected: ResourceRef | null = null
let railMounted = false
const listeners = new Set<() => void>()
function emit() { listeners.forEach(listener => listener()) }
function subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener) }
export function selectSessionPane(ref: ResourceRef | null) { selected = ref; emit(); if (ref) openSessionRail() }
function useSelectedPane() { return useSyncExternalStore(subscribe, () => selected) }
function useRailMounted() { return useSyncExternalStore(subscribe, () => railMounted) }

export function SessionChrome() {
  const ui = useWorkbench(), h = useHerdrText(), board = useBoard(), selectedPane = useSelectedPane(), rail = useRailMounted()
  const [open, setOpen] = useState(false), [pinned, setPinned] = useState(false)
  const closeTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined), openTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => { clearTimeout(closeTimer.current); clearTimeout(openTimer.current) }, [])
  const count = board.workspace ? board.panes.length + board.childPanes.length : 0
  if (!ui.conversationId || board.broken || count === 0) return null
  const hover = (next: boolean) => {
    clearTimeout(openTimer.current); clearTimeout(closeTimer.current)
    if (pinned) return
    if (next) openTimer.current = setTimeout(() => setOpen(true), 150)
    else closeTimer.current = setTimeout(() => setOpen(false), 120)
  }
  const choose = (pane: Pane) => { selectSessionPane(pane.ref); setOpen(false); setPinned(false) }
  return <div className="wb-session-anchor" onMouseEnter={() => hover(true)} onMouseLeave={() => hover(false)}>
    <button type="button" className="wb-session-trigger" data-session-terminals aria-expanded={open} aria-haspopup="dialog" onClick={() => { setPinned(value => !value); setOpen(value => !value); openSessionRail() }}>
      <Terminal size={14} aria-hidden="true"/><span>{h('terminalCount').replaceAll('{count}', String(count))}</span>
    </button>
    {open && <div className="wb-session-popover" role="dialog" aria-label={h('sessionTree')} onMouseEnter={() => hover(true)}>
      <BoardView board={board} onOpen={choose}/>
    </div>}
    {!rail && selectedPane && board.snapshot?.panes.find(pane => sameResource(pane.ref, selectedPane)) && <div className="wb-session-dock" role="region" aria-label={h('sessionDock')}>
      <PaneSession pane={board.snapshot.panes.find(pane => sameResource(pane.ref, selectedPane))!} stale={!!board.snapshot.stale} initialMode="observe"/>
    </div>}
  </div>
}

/** Right-hand Herdr tab: the workspace for this session's project path. */
export function SessionRail() {
  const h = useHerdrText(), board = useBoard(), selectedPane = useSelectedPane()
  useEffect(() => { railMounted = true; emit(); return () => { railMounted = false; emit() } }, [])
  const pane = selectedPane && board.snapshot?.panes.find(item => sameResource(item.ref, selectedPane))
  return <div className="wb-rightbar-body" data-session-rail>
    <BoardView board={board} onOpen={item => selectSessionPane(item.ref)}/>
    {pane && board.snapshot && <PaneSession key={resourceKey(pane.ref)} pane={pane} stale={board.snapshot.stale} initialMode="observe"/>}
    {!pane && board.workspace && <p className="wb-muted wb-small">{h('dockHint')}</p>}
  </div>
}

function useBoard() {
  const ui = useWorkbench(), binding = useBinding(), snapshot = useSnapshot(), resources = useSessionResources()
  const nodes = resources.data?.nodes ?? []
  const workspace = snapshot.data?.workspaces.find(item => binding.data?.ref && sameResource(item.ref, binding.data.ref))
  const panes = workspace ? (snapshot.data?.panes ?? []).filter(pane => pane.workspaceId === workspace.ref.id) : []
  const tabs = workspace ? (snapshot.data?.tabs ?? []).filter(tab => tab.workspaceId === workspace.ref.id) : []
  const childPanes = nodes.filter(node => node.parentConversationId).flatMap(node => node.entries.filter(entry => (entry.role === 'terminal' || entry.role === 'agent') && entry.presence === 'running'))
  const history = nodes.flatMap(node => node.entries).filter(entry => (entry.role === 'terminal' || entry.role === 'agent') && entry.presence !== 'running' && !panes.some(pane => sameResource(pane.ref, entry.ref)))
  return { projectPath: ui.projectPath ?? binding.data?.cwd ?? null, workspace, panes, tabs, nodes, children: nodes.filter(node => node.parentConversationId), childPanes, history, snapshot: snapshot.data, broken: !!binding.error || !!snapshot.error, empty: !binding.isLoading && !binding.data?.ref }
}

function RailEmpty({ path, ready }: { path: string | null; ready: boolean }) {
  const ui = useWorkbench(), h = useHerdrText(), cache = useQueryClient(), create = useAction('herdr.conversation.create')
  const canCreate = ready && !!path && !!ui.conversationId && ui.capabilities.has('herdr.manage') && !create.isPending
  const onCreate = () => {
    if (!canCreate || !path || !ui.conversationId) return
    const conversationId = ui.conversationId
    create.mutate({ conversationId, label: workspaceLabelFromPath(path, h('workspaceFallback')), cwd: path, confirmed: true, origin: 'ui' }, {
      onSuccess: async value => {
        if (value.ref) await rememberWorkspace(ui.client, conversationId, value.ref.id, 'ui', 'herdr.conversation.create').catch(() => {})
        await cache.invalidateQueries({queryKey: ['herdr', 'session', conversationId]})
      },
    })
  }
  return <div className="wb-rightbar-empty">
    <div className="wb-rightbar-empty-icon" aria-hidden="true"><FolderPlus size={22}/></div>
    <h2>{h('rightbarEmpty')}</h2>
    <p>{path ? h('rightbarEmptyHint') : h('rightbarNoPath')}</p>
    {path && <code className="wb-rightbar-path">{path}</code>}
    <div className="wb-actions">
      <Button variant="primary" disabled={!canCreate} onClick={onCreate}><FolderPlus size={15} aria-hidden="true"/>{h('createForPath')}</Button>
      <Button variant="ghost" onClick={() => { if (!requestWorkbenchPage(ui.conversationId)) ui.navigate('herdr.workspaces') }}>{h('openWorkbenchPage')}</Button>
    </div>
    {create.error && <ErrorNotice error={create.error}/>}
  </div>
}

function BoardView({ board, onOpen }: { board: ReturnType<typeof useBoard>; onOpen: (pane: Pane) => void }) {
  const h = useHerdrText(), selected = useSelectedPane()
  if (board.broken) return null
  if (board.empty || !board.workspace) return <RailEmpty path={board.projectPath} ready={board.empty}/>
  const originFor = (pane: Pane) => board.nodes.flatMap(node => node.entries).find(entry => entry.ref.kind === 'pane' && sameResource(entry.ref, pane.ref))?.origin
  const tabs = board.tabs.length ? board.tabs : [{ ref: { id: 'all' }, label: '' }]
  return <div className="wb-rail-board">
    <p className="wb-rightbar-path">{h('projectPath')} {board.projectPath ?? board.panes.find(pane => pane.cwd)?.cwd ?? board.workspace.ref.id}</p>
    <div className="wb-rail-workspace"><span className="wb-rail-folder" aria-hidden="true"><Folder size={15}/></span><strong>{board.workspace.label || board.workspace.ref.id}</strong></div>
    {tabs.map(tab => <section className="wb-rail-section" key={tab.ref.id}>
      {tab.label && <h3 className="wb-rail-tab">{tabHeading(tab.label, h('tabWord'))}</h3>}
      <ul className="wb-rail-group">{board.panes.filter(pane => !tab.label || pane.tabId === tab.ref.id).map(pane => {
        const face = presentTerminal({state: pane.state, agent: pane.agent})
        const title = terminalTitle({label: pane.label, title: pane.title, id: pane.ref.id}) ?? h('shellKind')
        const origin = originFor(pane)
        const subtitle = [h(face.statusKey), face.agent ?? h('shellKind'), origin ? h(origins[origin]) : ''].filter(Boolean).join(' · ')
        return <li key={resourceKey(pane.ref)}><ResourceRow icon={<AgentMark kind={face.agent}/>} title={title} subtitle={subtitle} state={face.mark} showIdle selected={!!selected && sameResource(selected, pane.ref)} label={title + ' · ' + subtitle} onClick={() => onOpen(pane)}/></li>
      })}</ul>
    </section>)}
    {board.children.map(node => <section className="wb-rail-section" key={node.conversationId}><p className="wb-session-child"><ChevronRight size={12}/>{h('childSession')} · {node.conversationId}</p>
      <ul className="wb-rail-group">{node.entries.filter(entry => entry.role === 'terminal' || entry.role === 'agent').map(entry => {
        const face = presentTerminal({state: entry.state ?? 'unknown', agent: entry.agent})
        const subtitle = [h(face.statusKey), face.agent ?? h('shellKind'), h(origins[entry.origin]), h(presences[entry.presence])].join(' · ')
        const open = () => { const pane = board.snapshot?.panes.find(item => sameResource(item.ref, entry.ref)); if (pane) onOpen(pane) }
        return <li key={entry.role + resourceKey(entry.ref)} data-presence={entry.presence}><ResourceRow icon={<AgentMark kind={face.agent}/>} title={entry.title} subtitle={subtitle} state={face.mark} showIdle disabled={entry.presence !== 'running' || entry.ref.kind !== 'pane'} selected={!!selected && sameResource(selected, entry.ref)} label={entry.title + ' · ' + subtitle} onClick={open}/></li>
      })}</ul>
    </section>)}
    {!!board.history.length && <section className="wb-rail-section"><h3 className="wb-rail-tab">{h('ungrouped')}</h3><ul className="wb-rail-group">{board.history.map(entry => {
      const subtitle = h(origins[entry.origin]) + ' · ' + h(presences[entry.presence])
      return <li key={resourceKey(entry.ref)} data-presence={entry.presence}><ResourceRow icon={<AgentMark kind={entry.agent}/>} title={entry.title} subtitle={subtitle} disabled label={entry.title + ' · ' + subtitle} onClick={() => {}}/></li>
    })}</ul></section>}
  </div>
}

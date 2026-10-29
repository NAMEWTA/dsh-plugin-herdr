/**
 * The session's project workspace, shown in the right rail and the header shortcut.
 * Both read the same binding, snapshot and ledger.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { ChevronRight, FolderPlus, Terminal } from 'lucide-react'
import { Button, ErrorNotice, useWorkbench } from '@workbench/ui'
import type { Pane, ResourceRef, SessionResources } from '../contracts/index.ts'
import { resourceKey, sameResource } from '../domain/selectors.ts'
import { useAction, useBinding, useSessionResources, useSnapshot } from './api.ts'
import { useHerdrText, type HerdrMessage } from './messages.ts'
import { openSessionRail, requestWorkbenchPage, workspaceLabelFromPath } from './session-bridge.ts'
import { PaneSession } from './terminal/page.tsx'
import { StatusMark } from './status-mark.tsx'
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
      <Terminal size={14} aria-hidden="true"/><span>{ui.locale === 'zh' ? `终端 ${count}` : `${count} terminals`}</span>
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
  const workspace = snapshot.data?.workspaces.find(item => binding.data?.ref && sameResource(item.ref, binding.data.ref))
  const panes = workspace ? (snapshot.data?.panes ?? []).filter(pane => pane.workspaceId === workspace.ref.id) : []
  const tabs = workspace ? (snapshot.data?.tabs ?? []).filter(tab => tab.workspaceId === workspace.ref.id) : []
  const childPanes = (resources.data?.nodes ?? []).filter(node => node.parentConversationId).flatMap(node => node.entries.filter(entry => (entry.role === 'terminal' || entry.role === 'agent') && entry.presence === 'running'))
  const history = (resources.data?.nodes ?? []).flatMap(node => node.entries).filter(entry => (entry.role === 'terminal' || entry.role === 'agent') && entry.presence !== 'running' && !panes.some(pane => sameResource(pane.ref, entry.ref)))
  return { projectPath: ui.projectPath ?? binding.data?.cwd ?? null, workspace, panes, tabs, children: (resources.data?.nodes ?? []).filter(node => node.parentConversationId), childPanes, history, snapshot: snapshot.data, broken: !!binding.error || !!snapshot.error, empty: !binding.isLoading && !binding.data?.ref }
}

function RailEmpty({ path, ready }: { path: string | null; ready: boolean }) {
  const ui = useWorkbench(), h = useHerdrText(), create = useAction('herdr.conversation.create')
  const canCreate = ready && !!path && !!ui.conversationId && ui.capabilities.has('herdr.manage') && !create.isPending
  const onCreate = () => {
    if (!canCreate || !path || !ui.conversationId) return
    const conversationId = ui.conversationId
    create.mutate({ conversationId, label: workspaceLabelFromPath(path, ui.locale === 'zh' ? '工作区' : 'workspace'), cwd: path, confirmed: true }, {
      onSuccess: value => { if (value.ref) void rememberWorkspace(ui.client, conversationId, value.ref.id, 'ui').catch(() => {}) },
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
  const h = useHerdrText()
  if (board.broken) return null
  if (board.empty || !board.workspace) return <RailEmpty path={board.projectPath} ready={board.empty}/>
  const originFor = (pane: Pane) => board.children.flatMap(node => node.entries).find(entry => sameResource(entry.ref, pane.ref))?.origin
  return <div>
    <p className="wb-rightbar-path">{h('projectPath')} {board.projectPath ?? board.panes.find(pane => pane.cwd)?.cwd ?? board.workspace.ref.id}</p>
    <div className="wb-session-workspace"><strong>{board.workspace.label || board.workspace.ref.id}</strong></div>
    {(board.tabs.length ? board.tabs : [{ ref: { id: 'all' }, label: '' }]).map(tab => <div key={tab.ref.id}>
      {tab.label && <div className="wb-session-tab">{tab.label}</div>}
      <ul className="wb-session-tree">{board.panes.filter(pane => !tab.label || pane.tabId === tab.ref.id).map(pane => <li key={resourceKey(pane.ref)}>
        <button type="button" className="wb-session-leaf" onClick={() => onOpen(pane)}>
          <StatusMark state={pane.state}/><span><strong>{pane.label || pane.ref.id}</strong><small>{(pane.agent ?? h('shellKind')) + (originFor(pane) ? ' · ' + h(origins[originFor(pane)!]) : '')}</small></span>
        </button>
      </li>)}</ul>
    </div>)}
    {board.children.map(node => <section key={node.conversationId}><p className="wb-session-child"><ChevronRight size={12}/>{h('childSession')} · {node.conversationId}</p>
      <ul className="wb-session-tree">{node.entries.filter(entry => entry.role === 'terminal' || entry.role === 'agent').map(entry => <li key={entry.role + resourceKey(entry.ref)} data-presence={entry.presence}>
        <button type="button" className="wb-session-leaf" disabled={entry.presence !== 'running' || entry.ref.kind !== 'pane'} onClick={() => { const pane = board.snapshot?.panes.find(item => sameResource(item.ref, entry.ref)); if (pane) onOpen(pane) }}>
          <StatusMark state={entry.state}/><span><strong>{entry.title}</strong><small>{(entry.agent ?? 'shell') + ' · ' + h(origins[entry.origin]) + ' · ' + h(presences[entry.presence])}</small></span>
        </button>
      </li>)}</ul>
    </section>)}
    {!!board.history.length && <section><div className="wb-session-tab">{h('ungrouped')}</div><ul className="wb-session-tree">{board.history.map(entry => <li key={resourceKey(entry.ref)} data-presence={entry.presence}><button type="button" className="wb-session-leaf" disabled><StatusMark state={entry.state}/><span><strong>{entry.title}</strong><small>{h(origins[entry.origin]) + ' · ' + h(presences[entry.presence])}</small></span></button></li>)}</ul></section>}
  </div>
}

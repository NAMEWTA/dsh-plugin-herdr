/**
 * Resource command palette. The subsequence match is adapted from Ovis
 * lib/paletteSearch.ts (devswha/ovis, MIT, Copyright © 2026 devswha).
 * See THIRD_PARTY_NOTICES.md.
 */
import { useEffect, useMemo, useState } from 'react'
import { Command } from 'lucide-react'
import { Button, Field, Input, Modal, useWorkbench } from '@workbench/ui'
import type { HerdrSnapshot } from '../contracts/index.ts'
import { useSnapshot } from './api.ts'
import { goToPane } from './parts.tsx'
import { useHerdrText } from './messages.ts'

export function paletteScore(query: string, text: string): number | null {
  const needle = query.trim().toLocaleLowerCase()
  const hay = text.toLocaleLowerCase()
  if (!needle) return 1
  const at = hay.indexOf(needle)
  if (at >= 0) return 200 - at
  let cursor = 0
  for (const char of hay) {
    if (char === needle[cursor]) cursor += 1
    if (cursor === needle.length) return 40
  }
  return null
}

export function ResourcePalette({open,onOpenChange}:{open:boolean;onOpenChange:(open:boolean)=>void}) {
  const ui = useWorkbench(), h = useHerdrText(), query = useSnapshot(), [search, setSearch] = useState('')
  const snapshot = query.data
  const items = useMemo(() => snapshot ? paletteItems(snapshot, h) : [], [snapshot, h])
  const visible = items.map(item => ({item, score: paletteScore(search, item.text)})).filter((item): item is {item: PaletteItem; score: number} => item.score !== null).sort((a,b) => b.score - a.score).slice(0, 40)
  return <Modal open={open} onOpenChange={onOpenChange} title={h('resourcePalette')} description={h('resourcePaletteHint')}>
    <Field label={ui.t('search')}><Input data-wb-initial-focus value={search} onChange={event => setSearch(event.target.value)} placeholder={h('resourcePaletteHint')}/></Field>
    <div className="wb-command-list" role="listbox" aria-label={h('resourcePalette')}>{visible.map(({item}) => <Button key={item.id} variant="ghost" onClick={() => {onOpenChange(false); setSearch(''); item.run(ui, snapshot!)}}><Command size={15}/>{item.label}</Button>)}{!visible.length && <p className="wb-muted wb-small">{ui.t('noResults')}</p>}</div>
    <div className="wb-dialog-footer"><Button onClick={() => onOpenChange(false)}>{ui.t('close')}</Button></div>
  </Modal>
}

interface PaletteItem {id:string;label:string;text:string;run:(ui:ReturnType<typeof useWorkbench>,snapshot:HerdrSnapshot)=>void}
function paletteItems(snapshot: HerdrSnapshot, h: (key: 'workspaces'|'tabs'|'panes'|'agents'|'connectionSettings') => string): PaletteItem[] {
  const workspace = (id: string) => snapshot.workspaces.find(item => item.ref.id === id)
  return [
    ...snapshot.workspaces.map(item => ({id:'ws-'+item.ref.id,label:item.label||item.ref.id,text:[h('workspaces'),item.label,item.ref.id].join(' '),run:(ui:ReturnType<typeof useWorkbench>) => ui.navigate('herdr.workspaces',{target:JSON.stringify(item.ref)})})),
    ...snapshot.tabs.map(item => ({id:'tab-'+item.ref.id,label:(item.label||item.ref.id)+' · '+(workspace(item.workspaceId)?.label??item.workspaceId),text:[h('tabs'),item.label,item.ref.id,workspace(item.workspaceId)?.label??''].join(' '),run:(ui:ReturnType<typeof useWorkbench>) => ui.navigate('herdr.workspaces',{target:JSON.stringify(workspace(item.workspaceId)?.ref??item.ref)})})),
    ...snapshot.panes.map(item => ({id:'pane-'+item.ref.id,label:(item.label||item.ref.id)+' · '+(item.agent??h('connectionSettings')),text:[h('panes'),item.label,item.ref.id,item.agent??'',item.cwd??'',workspace(item.workspaceId)?.label??''].join(' '),run:(ui:ReturnType<typeof useWorkbench>) => {if(!snapshot.stale)goToPane(ui,item)}})),
    ...[...new Set(snapshot.panes.map(item => item.agent).filter((agent): agent is string => !!agent))].map(agent => ({id:'kind-'+agent,label:agent,text:h('agents')+' '+agent,run:(ui:ReturnType<typeof useWorkbench>) => ui.navigate('herdr.agents',{agent})})),
    {id:'settings',label:h('connectionSettings'),text:h('connectionSettings'),run:ui => ui.navigate('herdr.environment')},
  ]
}

export function useResourcePalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-wb-terminal],input,textarea,select')) return
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'k') {event.preventDefault(); setOpen(value => !value)}
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        window.dispatchEvent(new CustomEvent('wb-herdr-toggle-view'))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  return {open, setOpen}
}

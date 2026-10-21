import { useEffect, useRef, useState } from 'react'
import { Copy, Eye, Keyboard, LockKeyhole, PlugZap, Square, ClipboardPaste } from 'lucide-react'
import { Badge, Button, Card, EmptyState, ErrorNotice, Field, Modal, Notice, PageHeader, Select, Skeleton, Textarea, useWorkbench, type PageProps } from '@workbench/ui'
import type { TerminalLease } from '../../contracts/index.ts'
import { resourceKey } from '../../domain/selectors.ts'
import { useSnapshot, call } from '../api.ts'
import { Health, readTarget, Status } from '../parts.tsx'
import { useHerdrText } from '../messages.ts'
import { TerminalScreen, type ScreenHandle } from './screen.tsx'
import { loadTerminal } from './driver.ts'
export function TerminalPage({ route }: PageProps) {
  const ui = useWorkbench(), h = useHerdrText(), query = useSnapshot()
  const [chosen, setChosen] = useState(''), [lease, setLease] = useState<TerminalLease | null>(null), [busy, setBusy] = useState(false)
  const [error, setError] = useState<unknown>(null), [paste, setPaste] = useState<string | null>(null)
  const handle = useRef<ScreenHandle | null>(null), epoch = useRef(0), currentLease = useRef<TerminalLease | null>(null)
  const target = readTarget(route.params), panes = query.data?.panes ?? []
  const selected = panes.find(p => resourceKey(p.ref) === (chosen || (target && resourceKey(target))))
  currentLease.current = lease
  const stop = (): Promise<void> => {
    epoch.current++; const current = currentLease.current; currentLease.current = null; setLease(null); setBusy(false); handle.current = null
    return current ? call(ui.client, 'herdr.terminal.release', { leaseId: current.leaseId }).then(() => {}) : Promise.resolve()
  }
  useEffect(() => { void stop().catch(setError); setChosen(''); setError(null) }, [route.params.target])
  useEffect(() => () => { epoch.current++; const current = currentLease.current; currentLease.current = null; if (current) void call(ui.client, 'herdr.terminal.release', { leaseId: current.leaseId }).catch(() => {}) }, [ui.client])
  const open = async (mode: 'observe' | 'control', takeover = false) => {
    if (!selected || busy) return
    if (mode === 'control' && !await ui.confirm({ title: h(takeover ? 'takeoverTitle' : 'controlTitle'), description: h(takeover ? 'takeoverBody' : 'controlBody'), danger: true, target: selected.label || selected.ref.id })) return
    const released = stop(); const ticket = epoch.current; setBusy(true); setError(null)
    try {
      await released
      await loadTerminal() // Download renderer before acquiring a live terminal lease.
      if (ticket !== epoch.current) return
      const result = await call(ui.client, 'herdr.terminal.open', { ref: selected.ref, mode, cols: 100, rows: 28, confirmed: mode === 'control', takeover })
      if (ticket !== epoch.current) { await call(ui.client, 'herdr.terminal.release', { leaseId: result.leaseId }); return }
      currentLease.current = result; setLease(result)
    } catch (e) { if (ticket === epoch.current) setError(e) } finally { if (ticket === epoch.current) setBusy(false) }
  }
  const copy = async () => { const text = handle.current?.copy(); if (!text) return; try { await navigator.clipboard.writeText(text); ui.notify(h('copied')) } catch { ui.notify(h('copyFailed'), 'danger') } }
  const editable = !!selected && selected.ownership !== 'external' && ui.capabilities.has('herdr.control') && !query.data?.stale
  return <div className="wb-stack"><PageHeader eyebrow="HERDR" title={h('terminal')} description={h('terminalHint')} />{query.isLoading&&<Skeleton/>}{query.error&&<ErrorNotice error={query.error} retry={()=>void query.refetch()}/>}
    {query.data && <Health snapshot={query.data} onRefresh={() => void query.refetch()}/>}
    <Card><div className="wb-toolbar"><Field label={h('selectPane')}><Select value={selected ? resourceKey(selected.ref) : ''} onChange={event => { void stop().catch(setError); setBusy(false); setChosen(event.target.value); setError(null) }}><option value="">{h('selectPane')}</option>{panes.map(p => <option key={resourceKey(p.ref)} value={resourceKey(p.ref)}>{p.label || p.ref.id} · {p.workspaceId}</option>)}</Select></Field>
      {selected && <Status state={selected.state}/>}<div className="wb-actions">
      <Button disabled={!selected || busy || !!query.data?.stale} onClick={() => void open('observe')}><Eye size={16}/>{h('observe')}</Button>
      <Button variant="primary" disabled={!editable || busy} onClick={() => void open('control')}><Keyboard size={16}/>{h('control')}</Button>
      <Button disabled={!editable || busy} onClick={() => void open('control', true)}><LockKeyhole size={16}/>{h('takeover')}</Button>
      <Button disabled={!lease} onClick={() => void stop().catch(setError)}><Square size={16}/>{h('release')}</Button></div></div>
      {target && !selected && !query.isLoading && <Notice tone="warning">{ui.t('RESOURCE_CHANGED')}</Notice>}
      {selected?.ownership === 'external' && <Notice>{ui.t('OWNERSHIP_REQUIRED')}</Notice>}
      {error != null && <ErrorNotice error={error}/>}<div className="wb-terminal-toolbar"><Badge tone={lease?.mode === 'control' ? 'warning' : 'neutral'}>{lease ? h(lease.mode === 'control' ? 'controlling' : 'observing') : h('terminalStopped')}</Badge>
        <div className="wb-actions"><Button size="sm" disabled={!lease} onClick={() => void copy()}><Copy size={15}/>{h('copy')}</Button><Button size="sm" disabled={lease?.mode !== 'control'} onClick={() => setPaste('')}><ClipboardPaste size={15}/>{h('paste')}</Button></div></div>
      {lease ? <TerminalScreen key={lease.leaseId} lease={lease} onReady={value => { handle.current = value }} onPaste={setPaste} onClose={failure => { void stop().catch(() => {}); setError(failure) }}/>
        : <EmptyState icon={<PlugZap size={32}/>} title={h('terminalStopped')} description={h('terminalStoppedHint')}/>}
    </Card>
    <Modal open={paste !== null} onOpenChange={open => { if (!open) setPaste(null) }} title={h('pasteTitle')} description={h('pasteBody')}><Textarea aria-label={h('pastePlaceholder')} value={paste ?? ''} maxLength={65536} onChange={e => setPaste(e.target.value)}/><div className="wb-dialog-footer"><Button data-wb-initial-focus onClick={() => setPaste(null)}>{ui.t('cancel')}</Button><Button variant="danger" disabled={!paste || lease?.mode !== 'control'} onClick={() => { if (paste && handle.current?.send(paste)) setPaste(null) }}>{h('send')}</Button></div></Modal>
  </div>
}

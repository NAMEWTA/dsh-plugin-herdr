import { useCallback, useEffect, useRef, useState } from 'react'
import type { HerdrEnvironmentReport } from '../core/environment.ts'
import { getHerdrRemote } from './remote.ts'
import { getSessionId, navigateToPane } from './navigation.ts'
import { normalizeStatusSnapshot } from './logic.ts'
import { enrichInspectedPane, sameInspectorEndpoint, mergeInspectorDetails, copyInspectorCommand, lookupPaneBinding, type InspectedPane, type PaneBinding } from './pane-inspector-model.ts'
import { PaneInspectorView } from './pane-inspector-view.ts'

export function PaneInspector({ selected, onClose }: { selected: InspectedPane; onClose: () => void }) {
  const [binding, setBinding] = useState<PaneBinding>({ state: 'checking' })
  const [report, setReport] = useState<HerdrEnvironmentReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [opening, setOpening] = useState(false)
  const [feedback, setFeedback] = useState<'copied' | 'copyFailed' | null>(null)
  const [details, setDetails] = useState<InspectedPane | null>(null)
  const endpoint = useRef<InspectedPane | null>(null)
  const revision = useRef(0)
  const openLock = useRef(false)
  const selectedRef = useRef(selected)
  selectedRef.current = selected
  const paneId = selected.pane.pane_id
  const refresh = useCallback(async () => {
    const current = ++revision.current
    setChecking(true)
    setOpening(false)
    openLock.current = false
    setBinding({ state: 'checking' })
    setReport(null)
    setFeedback(null)
    const [nextBinding, nextReport, nextStatus] = await Promise.all([
      lookupPaneBinding(() => getHerdrRemote().paneSession({ pane: paneId })),
      Promise.resolve().then(() => getHerdrRemote().environment()).catch(() => null),
      Promise.resolve().then(() => getHerdrRemote().status({ scope: 'all' })).then(normalizeStatusSnapshot).catch(() => null),
    ])
    if (current !== revision.current) return
    const environment = nextReport as HerdrEnvironmentReport | null
    const next = enrichInspectedPane(selectedRef.current, nextStatus, environment)
    const valid = next && (!endpoint.current || sameInspectorEndpoint(endpoint.current, next))
    if (valid) endpoint.current = next
    setDetails(valid ? next : null)
    setBinding(valid ? nextBinding : { state: 'error' })
    setReport(valid ? environment : null)
    setChecking(false)
  }, [paneId])
  useEffect(() => {
    void refresh()
    return () => { revision.current++ }
  }, [refresh])
  const open = async () => {
    if (openLock.current || checking || binding.state !== 'bound' || !details || !report) return
    openLock.current = true
    const current = revision.current
    setOpening(true)
    // Bindings may change while the inspector is open. Never navigate using an old binding.
    const [latest, currentStatus] = await Promise.all([
      lookupPaneBinding(() => getHerdrRemote().paneSession({ pane: paneId })),
      Promise.resolve().then(() => getHerdrRemote().status({ scope: 'all' })).then(normalizeStatusSnapshot).catch(() => null),
    ])
    if (current !== revision.current) return
    const currentDetails = enrichInspectedPane(selected, currentStatus, report)
    const valid = currentDetails && sameInspectorEndpoint(details, currentDetails)
    setBinding(valid ? latest : { state: 'error' })
    if (!valid) { setDetails(null); setReport(null) }
    openLock.current = false
    setOpening(false)
    if (valid && latest.state === 'bound') {
      try { navigateToPane(paneId, { selfSessionId: getSessionId(), paneSessionId: latest.sessionId }) }
      catch { setBinding({ state: 'error' }) }
    }
  }
  const copy = async (command: string) => {
    const current = revision.current
    const ok = await copyInspectorCommand(command, typeof navigator === 'undefined' ? undefined : navigator.clipboard)
    if (current === revision.current) setFeedback(ok ? 'copied' : 'copyFailed')
  }
  return <PaneInspectorView selected={mergeInspectorDetails(selected, details)} binding={binding} report={report} checking={checking} opening={opening}
    feedback={feedback} onOpen={() => { void open() }} onCopy={command => { void copy(command) }}
    onRefresh={() => { void refresh() }} onClose={onClose} />
}

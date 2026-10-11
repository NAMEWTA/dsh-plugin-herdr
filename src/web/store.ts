import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createGlobalDashboardStore, createStatusStore, normalizeDashboardSnapshot, normalizeStatusSnapshot } from './logic.ts'
import type { SseEvent } from './logic.ts'
import type { HerdrStatusSnapshot } from './types.ts'
import type { HerdrDashboardSnapshot } from './dashboard-types.ts'
import { getHerdrMode, useHerdrMode } from './mode.ts'
import { getHerdrRemote } from './remote.ts'
import { RemoteEventBus } from './shared/event-bus.ts'
import { InputQueue } from './features/terminal/input-queue.ts'
import { MAX_INPUT_BYTES } from '../contracts/terminal.ts'
import { t } from './i18n.ts'

export type HerdrStreamEvent = SseEvent | { type: 'transport-disconnected' }
const eventBus = new RemoteEventBus<HerdrStreamEvent>({
  open: () => getHerdrRemote().events({}) as AsyncIterable<SseEvent>,
  disconnected: { type: 'transport-disconnected' },
})
export function subscribeHerdrEvents(listener: (event: HerdrStreamEvent) => void): () => void {
  return typeof window === 'undefined' ? () => {} : eventBus.subscribe(listener)
}
export function waitForHerdrEvents(): Promise<void> { return eventBus.waitReady() }
export function subscribePaneOutput(paneId: string, callback: (revision: number) => void): () => void {
  return subscribeHerdrEvents(event => { if (event.type === 'output' && event.pane_id === paneId) callback(event.revision) })
}
/** Explicitly owned stream for callers that do not use the page-level group. */
export function openHerdrEvents(signal: AbortSignal, callback: (event: SseEvent) => void): { close(): void } {
  const bus = new RemoteEventBus<HerdrStreamEvent>({ open: () => getHerdrRemote().events({}) as AsyncIterable<SseEvent>, disconnected: { type: 'transport-disconnected' } })
  const close = () => { signal.removeEventListener('abort', close); bus.dispose() }
  if (signal.aborted) return { close }
  bus.subscribe(event => { if (event.type !== 'transport-disconnected') callback(event) })
  signal.addEventListener('abort', close, { once: true })
  return { close }
}
function sseOpen(signal: AbortSignal, callback: (event: SseEvent) => void): { close(): void } {
  const off = subscribeHerdrEvents(event => { if (event.type !== 'transport-disconnected') callback(event) })
  const close = () => { signal.removeEventListener('abort', close); off() }
  signal.addEventListener('abort', close, { once: true })
  if (signal.aborted) close()
  return { close }
}

export const globalDashboardStore = createGlobalDashboardStore()
function shouldPauseStatus(): boolean {
  return (typeof document !== 'undefined' && document.hidden) || (!getHerdrMode() && !globalDashboardStore.getOpen())
}
export function statusIntervalFor(snapshot: HerdrStatusSnapshot | null): number {
  const agents = snapshot?.agents ?? []
  if (agents.some(agent => agent.status === 'working' || agent.status === 'blocked')) return 1500
  if (!agents.length || agents.every(agent => !agent.status || agent.status === 'unknown')) return 10000
  return agents.every(agent => agent.status === 'idle' || agent.status === 'done') ? 5000 : 2000
}
async function fetchStatus(signal: AbortSignal): Promise<HerdrStatusSnapshot> {
  signal.throwIfAborted()
  const snapshot = normalizeStatusSnapshot(await getHerdrRemote().status({ scope: 'project' }))
  signal.throwIfAborted()
  if (!snapshot) throw new Error('invalid herdr status payload')
  return snapshot
}
export function patchHerdrStatus(snapshot: HerdrStatusSnapshot, event: SseEvent): HerdrStatusSnapshot {
  if (event.type === 'topology') {
    const topology = normalizeStatusSnapshot({ topology: event.topology })?.topology
    return topology ? { ...snapshot, topology, ...(event.filter ? { filter: event.filter as HerdrStatusSnapshot['filter'] } : {}) } : snapshot
  }
  if (event.type === 'heartbeat') return { ...snapshot, stale: event.stale, last_error: event.last_error }
  if (event.type !== 'agent_status') return snapshot
  const agents = snapshot.agents ?? []
  const index = agents.findIndex(agent => agent.pane_id === event.pane_id)
  const prior = agents[index]
  if (prior && prior.agent === event.agent && prior.status === event.status && prior.message === event.message) return snapshot
  const next = { ...prior, pane_id: event.pane_id, agent: event.agent || prior?.agent || 'unknown', status: event.status, message: event.message ?? prior?.message, output: prior?.output ?? '', updated_at: Date.now() }
  return { ...snapshot, updated_at: Date.now(), agents: index < 0 ? [...agents, next] : agents.map((agent, i) => i === index ? next : agent) }
}
export const statusStore = createStatusStore<HerdrStatusSnapshot>({ fetch: fetchStatus, intervalFor: statusIntervalFor, pauseWhen: shouldPauseStatus, sse: { open: sseOpen }, onSseEvent: patchHerdrStatus })

export function useHerdrStatus() {
  const herdrMode = useHerdrMode()
  const globalOpen = useGlobalDashboardOpen()
  const snapshot = useSyncExternalStore(statusStore.subscribe, statusStore.getSnap, statusStore.getSnap)
  const error = useSyncExternalStore(statusStore.subscribe, statusStore.getError, statusStore.getError)
  const wasPaused = useRef<boolean | null>(null)
  useEffect(() => {
    const paused = shouldPauseStatus()
    if (wasPaused.current === true && !paused) statusStore.refresh()
    wasPaused.current = paused
  }, [herdrMode, globalOpen])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const visible = () => { if (!shouldPauseStatus()) statusStore.refresh() }
    document.addEventListener('visibilitychange', visible)
    return () => document.removeEventListener('visibilitychange', visible)
  }, [])
  const refresh = useCallback(() => statusStore.refresh(), [])
  return { snap: snapshot, error, stale: snapshot?.stale ?? false, refresh, diagnostics: statusStore.getDiagnostics() }
}
export async function fetchDashboard(signal: AbortSignal): Promise<HerdrDashboardSnapshot> {
  signal.throwIfAborted()
  const snapshot = normalizeDashboardSnapshot(await getHerdrRemote().dashboard())
  signal.throwIfAborted()
  if (!snapshot) throw new Error('invalid herdr dashboard payload')
  return snapshot
}
const dashboardStore = createStatusStore<HerdrDashboardSnapshot>({ fetch: fetchDashboard, intervalMs: 4000 })
export function useHerdrDashboard() {
  const snap = useSyncExternalStore(dashboardStore.subscribe, dashboardStore.getSnap, dashboardStore.getSnap)
  const error = useSyncExternalStore(dashboardStore.subscribe, dashboardStore.getError, dashboardStore.getError)
  const refresh = useCallback(() => dashboardStore.refresh(), [])
  return { snap, error, refresh }
}
export function useGlobalDashboardOpen(): boolean { return useSyncExternalStore(globalDashboardStore.subscribe, globalDashboardStore.getOpen, globalDashboardStore.getOpen) }
export function getGlobalDashboardOpen(): boolean { return globalDashboardStore.getOpen() }
export function openGlobalDashboard(): void { globalDashboardStore.open() }
export function closeGlobalDashboard(): void { globalDashboardStore.close() }
export function useHerdrStart() {
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const start = async (): Promise<boolean> => {
    setStarting(true)
    setStartError(null)
    try {
      const result = await getHerdrRemote().start()
      if (!result.ok) throw new Error(result.error ?? t('error.inputFailed'))
      return true
    } catch (error) {
      setStartError(error instanceof Error ? error.message : String(error))
      return false
    } finally { setStarting(false) }
  }
  return { starting, startError, start }
}
export async function fetchPaneOutputsDetailed(paneIds: string[], lines = 40): Promise<Map<string, { text: string; truncated: boolean }>> {
  const result = new Map<string, { text: string; truncated: boolean }>()
  try {
    // Bound each request independently; do not serialize an unbounded list on the wire.
    for (let offset = 0; offset < paneIds.length; offset += 64) {
      const body = await getHerdrRemote().agentOutputs({ paneIds: paneIds.slice(offset, offset + 64).join(','), lines, format: 'ansi' })
      for (const output of body.outputs) if (typeof output.text === 'string') result.set(output.pane_id, { text: output.text, truncated: output.truncated === true })
    }
  } catch { /* individual view keeps its last successful content */ }
  return result
}
export async function fetchPaneOutputs(paneIds: string[], lines = 40): Promise<Map<string, string>> {
  return new Map([...(await fetchPaneOutputsDetailed(paneIds, lines))].map(([id, value]) => [id, value.text]))
}
type PaneInput = { text?: string; keys?: string[] }
const inputQueue = new InputQueue<PaneInput>(async (paneId, input) => {
  const result = await getHerdrRemote().paneInput({ pane_id: paneId, ...input })
  if (!result.ok) throw new Error(result.error ?? t('error.inputFailed'))
}, input => new TextEncoder().encode(JSON.stringify(input)).byteLength)
export function sendPaneInput(paneId: string, input: PaneInput, signal?: AbortSignal): Promise<void> {
  if (new TextEncoder().encode(input.text ?? '').byteLength > MAX_INPUT_BYTES || (input.keys?.length ?? 0) > 32) return Promise.reject(new Error('terminal input exceeds request limit'))
  return inputQueue.enqueue(paneId, input, signal)
}
export interface TerminalBootstrapResult { text: string; revision?: number; truncated: boolean }
export async function fetchTerminalBootstrap(paneId: string, maxLines?: number, signal?: AbortSignal, source: 'visible' | 'recent_unwrapped' = 'visible'): Promise<TerminalBootstrapResult> {
  signal?.throwIfAborted()
  const result = await getHerdrRemote().terminalBootstrap({ pane_id: paneId, lines: maxLines, source })
  signal?.throwIfAborted()
  if (!result.ok) throw new Error(result.error ?? t('error.terminalBootstrapFailed'))
  return { text: result.text ?? '', revision: result.revision, truncated: result.truncated === true }
}
/** Slot unmounts own polling subscriptions; the plugin additionally owns its shared stream. */
export function disposeHerdrEventStream(): void { eventBus.dispose() }

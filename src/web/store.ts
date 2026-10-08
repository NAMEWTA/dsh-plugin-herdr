import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { createGlobalDashboardStore, createStatusStore, normalizeDashboardSnapshot, normalizeStatusSnapshot, parseStartResponse } from './logic.ts'
import type { SseEvent } from './logic.ts'
import type { HerdrStatusSnapshot } from './types.ts'
import type { HerdrDashboardSnapshot } from './dashboard-types.ts'
import { getHerdrMode, useHerdrMode } from './mode.ts'
import { getHerdrRemote, type HerdrRemote } from './remote.ts'
import { t } from './i18n.ts'

function herdrRemote(): HerdrRemote | null {
  try {
    return getHerdrRemote()
  } catch {
    return null
  }
}

async function fetchStatus(signal: AbortSignal): Promise<HerdrStatusSnapshot> {
  if (signal.aborted) throw new Error('aborted')
  const remote = herdrRemote()
  if (!remote) throw new Error('herdr remote is not mounted')
  const snap = normalizeStatusSnapshot(await remote.status({ scope: 'project' }))
  if (!snap) throw new Error('invalid herdr status payload')
  return snap
}

export function statusIntervalFor(snap: HerdrStatusSnapshot | null): number {
  const agents = (snap as HerdrStatusSnapshot | null)?.agents ?? []
  const hasWorking = agents.some(a => a.status === 'working' || a.status === 'blocked')
  if (hasWorking) return 1500
  if (agents.length === 0) return 10000
  const allIdleDone = agents.every(a => a.status === 'idle' || a.status === 'done')
  if (allIdleDone) return 5000
  const allUnknown = agents.every(a => !a.status || a.status === 'unknown')
  if (allUnknown) return 10000
  return 2000
}

export const globalDashboardStore = createGlobalDashboardStore()

function shouldPauseStatus(): boolean {
  const hidden = typeof document !== 'undefined' ? document.hidden : false
  if (hidden) return true
  const herdrMode = getHerdrMode()
  const dashboardOpen = globalDashboardStore.getOpen()
  return !herdrMode && !dashboardOpen
}

export function patchHerdrStatus(snap: HerdrStatusSnapshot, event: SseEvent): HerdrStatusSnapshot {
  switch (event.type) {
    case 'topology': {
      const topo = normalizeStatusSnapshot({ topology: event.topology })?.topology
      const filter = event.filter as HerdrStatusSnapshot['filter']
      if (!topo) return snap
      return { ...snap, topology: topo, ...(filter ? { filter } : {}), updated_at: Date.now() }
    }
    case 'agent_status': {
      const agents = snap.agents ?? []
      const now = Date.now()
      const idx = agents.findIndex(a => a.pane_id === event.pane_id)
      let nextAgents: HerdrStatusSnapshot['agents']
      if (idx >= 0) {
        const prev = agents[idx]!
        if (prev.status === event.status && prev.agent === event.agent && prev.message === event.message) return snap
        nextAgents = agents.slice()
        nextAgents[idx] = { ...prev, agent: event.agent || prev.agent, status: event.status, ...(event.message !== undefined ? { message: event.message } : { message: prev.message }), updated_at: now }
      } else {
        nextAgents = agents.concat([{ pane_id: event.pane_id, agent: event.agent, status: event.status, ...(event.message ? { message: event.message } : {}), output: '', updated_at: now }])
      }
      return { ...snap, agents: nextAgents, updated_at: now }
    }
    case 'heartbeat': {
      return { ...snap, stale: event.stale, last_error: event.last_error, updated_at: Date.now() }
    }
    case 'output':
      return snap
    default:
      return snap
  }
}

export function openHerdrEvents(signal: AbortSignal, onEvent: (e: SseEvent) => void): { close(): void } {
  let closed = false
  let generation = 0
  let lastRevision: number | null = null
  let curController: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  const abortAll = (): void => {
    closed = true
    if (curController) try { curController.abort() } catch { /* ignore */ }
    if (retryTimer) clearTimeout(retryTimer)
    retryTimer = null
  }
  signal.addEventListener('abort', abortAll, { once: true })
  const emitParsed = (rawEvent: string, rawData: string, rawId: string): void => {
    if (!rawData) return
    try {
      const data = JSON.parse(rawData) as Record<string, unknown>
      if (rawEvent === 'output') {
        const pane_id = String((data as { pane_id?: string }).pane_id ?? '')
        const revision = typeof (data as { revision?: number }).revision === 'number' ? (data as { revision: number }).revision : (rawId && /^\d+$/.test(rawId) ? Number(rawId) : 0)
        if (pane_id) {
          if (Number.isSafeInteger(revision)) lastRevision = revision
          onEvent({ type: 'output', pane_id, revision, id: rawId } as SseEvent)
        }
      } else if (rawEvent === 'term') {
        // 终端会话帧转发：服务端不带 id，不推进 lastRevision
        const session_id = String((data as { session_id?: string }).session_id ?? '')
        const pane_id = String((data as { pane_id?: string }).pane_id ?? '')
        if (session_id && pane_id) {
          onEvent({ type: 'term', session_id, pane_id, event: (data as { event?: unknown }).event } as SseEvent)
        }
      } else if (rawEvent === 'agent_status') {
        const pane_id = String((data as { pane_id?: string }).pane_id ?? '')
        if (pane_id) {
          onEvent({ type: 'agent_status', pane_id, agent: String((data as { agent?: string }).agent ?? ''), status: String((data as { status?: string }).status ?? 'unknown'), message: (data as { message?: string }).message, workspace_id: (data as { workspace_id?: string }).workspace_id } as SseEvent)
        }
      } else if (rawEvent === 'topology') {
        onEvent({ type: 'topology', topology: (data as { topology?: unknown }).topology, filter: (data as { filter?: unknown }).filter } as SseEvent)
      } else if (rawEvent === 'heartbeat') {
        onEvent({ type: 'heartbeat', stale: Boolean((data as { stale?: boolean }).stale), last_error: (data as { last_error?: string | null }).last_error ?? null } as SseEvent)
      }
    } catch { /* ignore */ }
  }
  const connect = async (): Promise<void> => {
    if (closed || signal.aborted) return
    const current = ++generation
    curController = new AbortController()
    const linkSignal = curController.signal
    const onOuterAbort = (): void => { try { curController!.abort() } catch { /* ignore */ } }
    signal.addEventListener('abort', onOuterAbort, { once: true })
    const request = lastRevision != null ? { after_revision: lastRevision } : {}
    const remote = herdrRemote()
    if (!remote) {
      if (!closed && !signal.aborted && current === generation) retryTimer = setTimeout(() => { void connect() }, 3000)
      return
    }
    try {
      for await (const value of remote.events(request)) {
        if (current !== generation || linkSignal.aborted || signal.aborted) break
        const event = value as { type?: string; revision?: number }
        if (event.type === 'output' && typeof event.revision === 'number') lastRevision = event.revision
        emitParsed(String(event.type ?? ''), JSON.stringify(value), '')
      }
      if (!closed && !signal.aborted && current === generation) retryTimer = setTimeout(() => { void connect() }, 3000)
    } catch {
      if (!closed && !signal.aborted && current === generation) retryTimer = setTimeout(() => { void connect() }, 3000)
    } finally {
      signal.removeEventListener('abort', onOuterAbort)
    }
  }
  void connect()
  return { close: abortAll }
}

// ---------------------------------------------------------------------------
// /herdr-events 单例事件总线：整个页面共享一条常驻 SSE 连接。浏览器对单域名
// 的并发连接数有限，status store 与逐卡 observer 若各开一条会把配额耗尽，
// 进而出现连接饥饿（Failed to fetch / bootstrap 超时）。订阅者退订不关流。
// ---------------------------------------------------------------------------
type HerdrEventListener = (ev: SseEvent) => void
const herdrEventListeners = new Set<HerdrEventListener>()
let herdrEventStreamStarted = false

function ensureHerdrEventStream(): void {
  if (herdrEventStreamStarted) return
  if (typeof window === 'undefined') return
  herdrEventStreamStarted = true
  const ctrl = new AbortController()
  // 页面生命周期常驻：ctrl 不暴露，断线由 openHerdrEvents 内部退避重连
  openHerdrEvents(ctrl.signal, ev => {
    for (const l of [...herdrEventListeners]) {
      try { l(ev) } catch { /* ignore */ }
    }
  })
}

/** 订阅共享 herdr 事件流；返回退订函数。流为页面级单例，不因退订关闭。 */
export function subscribeHerdrEvents(listener: HerdrEventListener): () => void {
  herdrEventListeners.add(listener)
  ensureHerdrEventStream()
  return () => { herdrEventListeners.delete(listener) }
}

/** 订阅指定 pane 的 output 变化（快照模式按此防抖重拉）。 */
export function subscribePaneOutput(paneId: string, cb: (revision: number) => void): () => void {
  return subscribeHerdrEvents(ev => {
    if (ev.type === 'output' && ev.pane_id === paneId) cb(ev.revision)
  })
}

function sseOpen(signal: AbortSignal, onEvent: (e: SseEvent) => void): { close(): void } {
  const off = subscribeHerdrEvents(onEvent)
  signal.addEventListener('abort', off, { once: true })
  return { close: off }
}

async function readPaneOutputs(paneIds: string[], lines: number): Promise<Array<{ pane_id: string; text?: string; truncated?: boolean }>> {
  const remote = herdrRemote()
  if (!remote) return []
  const body = await remote.agentOutputs({ paneIds: paneIds.join(','), lines, format: 'ansi' }) as { outputs?: Array<{ pane_id: string; text?: string; truncated?: boolean }> }
  return body.outputs ?? []
}

export async function fetchPaneOutputs(paneIds: string[], lines = 40): Promise<Map<string, string>> {
  if (paneIds.length === 0) return new Map()
  try {
    const map = new Map<string, string>()
    for (const output of await readPaneOutputs(paneIds, lines)) {
      if (output.pane_id && typeof output.text === 'string') map.set(output.pane_id, output.text)
    }
    return map
  } catch {
    return new Map()
  }
}

export async function fetchPaneOutputsDetailed(
  paneIds: string[],
  lines = 40,
): Promise<Map<string, { text: string; truncated: boolean }>> {
  if (paneIds.length === 0) return new Map()
  try {
    const map = new Map<string, { text: string; truncated: boolean }>()
    for (const output of await readPaneOutputs(paneIds, lines)) {
      if (output.pane_id && typeof output.text === 'string') map.set(output.pane_id, { text: output.text, truncated: Boolean(output.truncated) })
    }
    return map
  } catch {
    return new Map()
  }
}

export const statusStore = createStatusStore<HerdrStatusSnapshot>({
  fetch: fetchStatus,
  intervalFor: statusIntervalFor,
  pauseWhen: shouldPauseStatus,
  sse: { open: sseOpen },
  onSseEvent: patchHerdrStatus,
})

export function useHerdrStatus(): { snap: HerdrStatusSnapshot | null; error: string | null; stale: boolean; refresh: () => void; diagnostics: { inflight: number; currentInterval: number | null; paused: boolean } } {
  const herdrMode = useHerdrMode()
  const globalOpen = useGlobalDashboardOpen()
  const [snap, setSnap] = useState<HerdrStatusSnapshot | null>(statusStore.getSnap())
  const [error, setError] = useState<string | null>(statusStore.getError())
  useEffect(() => {
    const update = () => {
      setSnap(statusStore.getSnap())
      setError(statusStore.getError())
    }
    const unsubscribe = statusStore.subscribe(update)
    update()
    return unsubscribe
  }, [])
  const prevPausedRef = useRef<boolean | null>(null)
  useEffect(() => {
    const paused = (typeof document !== 'undefined' ? document.hidden : false) || (!herdrMode && !globalOpen)
    if (prevPausedRef.current === true && !paused) {
      statusStore.refresh()
    }
    prevPausedRef.current = paused
  }, [herdrMode, globalOpen])
  useEffect(() => {
    if (typeof document === 'undefined') return
    const onVis = () => {
      if (!document.hidden) {
        const paused = !getHerdrMode() && !globalDashboardStore.getOpen()
        if (!paused) statusStore.refresh()
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => document.removeEventListener('visibilitychange', onVis)
  }, [])
  const refresh = useCallback(() => {
    statusStore.refresh()
  }, [])
  const stale = (snap as HerdrStatusSnapshot | null)?.stale ?? false
  const diagnostics = statusStore.getDiagnostics()
  return { snap, error, stale, refresh, diagnostics }
}

// ---------------------------------------------------------------------------
// Dashboard（design: dashboard §5.2）：独立只读轮询 store（多组件共享单飞请求；
// 卸载即停并 abort；不重复创建 timer——逻辑见 logic.createStatusStore）。
// ---------------------------------------------------------------------------

export async function fetchDashboard(signal: AbortSignal): Promise<HerdrDashboardSnapshot> {
  if (signal.aborted) throw new Error('aborted')
  const remote = herdrRemote()
  if (!remote) throw new Error('herdr remote is not mounted')
  const snap = normalizeDashboardSnapshot(await remote.dashboard())
  if (!snap) throw new Error('invalid herdr dashboard payload')
  return snap
}

// 数据派生自 status 轮询 + 进程探测，4s 周期足够；首次立即 tick。
const dashboardStore = createStatusStore<HerdrDashboardSnapshot>({ fetch: fetchDashboard, intervalMs: 4000 })

export function useHerdrDashboard(): { snap: HerdrDashboardSnapshot | null; error: string | null; refresh: () => void } {
  const [snap, setSnap] = useState<HerdrDashboardSnapshot | null>(dashboardStore.getSnap())
  const [error, setError] = useState<string | null>(dashboardStore.getError())
  useEffect(() => {
    const update = () => {
      setSnap(dashboardStore.getSnap())
      setError(dashboardStore.getError())
    }
    const unsubscribe = dashboardStore.subscribe(update)
    update()
    return unsubscribe
  }, [])
  const refresh = useCallback(() => {
    dashboardStore.refresh()
  }, [])
  return { snap, error, refresh }
}

// ---------------------------------------------------------------------------
// 全局 Dashboard 打开状态（design: dashboard-global §6.2）。
// 模块级单例 store（createGlobalDashboardStore，纯逻辑可测）；sidebar 按钮与旧
// Herdr tab 降级按钮共享。按钮不订阅 dashboardStore —— Web 轮询生命周期以全局
// 面板订阅为准（打开挂载即拉取，关闭退订即 stop+abort）。
// 导出单例供原生 DOM marker controller 订阅（P1-1：open/close 同步 aria-pressed）。
// ---------------------------------------------------------------------------

export function useGlobalDashboardOpen(): boolean {
  return useSyncExternalStore(globalDashboardStore.subscribe, globalDashboardStore.getOpen, globalDashboardStore.getOpen)
}

export function getGlobalDashboardOpen(): boolean {
  return globalDashboardStore.getOpen()
}

export function openGlobalDashboard(): void {
  globalDashboardStore.open()
}

export function closeGlobalDashboard(): void {
  globalDashboardStore.close()
}

export function useHerdrStart(): { starting: boolean; startError: string | null; start: () => Promise<boolean> } {
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState<string | null>(null)
  const start = async (): Promise<boolean> => {
    setStarting(true)
    setStartError(null)
    try {
      const remote = herdrRemote()
      if (!remote) throw new Error('herdr remote is not mounted')
      const resp = { ok: true, status: 200, json: async () => await remote.start() }
      const body = await parseStartResponse(resp as Response)
      if (!body.ok) {
        setStartError(body.error ?? `herdr-start HTTP ${resp.status}`)
        return false
      }
      return true
    } catch (e) {
      setStartError(e instanceof Error ? e.message : String(e))
      return false
    } finally {
      setStarting(false)
    }
  }
  return { starting, startError, start }
}

// ---------------------------------------------------------------------------
// 终端输入写回（design: pane-interactive-terminal §3.4）
// ---------------------------------------------------------------------------

/** 单 pane 的输入队列：FIFO + promise chain 保证顺序。 */
const inputQueues = new Map<string, Promise<void>>()

/** 发送终端输入到指定 pane（HTTP → /herdr-pane-input → pane.send_input）。 */
export function sendPaneInput(paneId: string, input: { text?: string; keys?: string[] }): Promise<void> {
  const prev = inputQueues.get(paneId) ?? Promise.resolve()
  const next = prev.then(async () => {
    const remote = herdrRemote()
    if (!remote) throw new Error('herdr remote is not mounted')
    const body = await remote.paneInput({ pane_id: paneId, ...input }) as { ok?: boolean; error?: string }
    if (!body.ok) throw new Error(body.error ?? t('error.inputFailed'))
  })
  inputQueues.set(paneId, next.catch(() => {}))
  return next
}

// ---------------------------------------------------------------------------
// 终端 bootstrap/snapshot（B 模式：revision 快照重拉）
// ---------------------------------------------------------------------------

export interface TerminalBootstrapResult {
  text: string
  revision?: number
  truncated: boolean
}

/** 获取 pane 的终端快照（B 模式：revision 变化时重新读取全量 snapshot；source 可选 visible/recent_unwrapped）。 */
export async function fetchTerminalBootstrap(
  paneId: string,
  maxLines?: number,
  signal?: AbortSignal,
  source: 'visible' | 'recent_unwrapped' = 'visible',
): Promise<TerminalBootstrapResult> {
  if (signal?.aborted) throw new Error('aborted')
  const remote = herdrRemote()
  if (!remote) throw new Error('herdr remote is not mounted')
  const body = await remote.terminalBootstrap({ pane_id: paneId, lines: maxLines, source }) as { ok?: boolean; text?: string; revision?: number; truncated?: boolean; error?: string }
  if (!body.ok) throw new Error(body.error ?? t('error.terminalBootstrapFailed'))
  return { text: body.text ?? '', revision: body.revision, truncated: body.truncated === true }
}

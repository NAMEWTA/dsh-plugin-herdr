// Rendering is separate from process ownership: the store owns the lease and the
// bounded writer owns xterm callbacks. Neither can confirm a stale session frame.
import { useEffect, useRef, useState } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { StateDot } from './ui.tsx'
import { agentTheme, dotState, type AgentAccent } from './logic.ts'
import { fetchTerminalBootstrap, sendPaneInput, subscribePaneOutput } from './store.ts'
import { terminalSessionStore, type TerminalStoreSignal } from './terminal-session.ts'
import { TerminalFrameWriter } from './features/terminal/frame-writer.ts'
import { rebaseTerminalFrame, trimAnsiSnapshotPadding } from '../core/ansi.ts'
import { resolveTerminalFontFamily } from './terminal-font.ts'
import { t, useHerdrLang } from './i18n.ts'

const THEME = {
  background: '#1f2937', foreground: '#ffffff', cursor: '#ffffff', cursorAccent: '#1f2937',
  selectionBackground: '#3c4048', selectionForeground: '#ffffff', black: '#1f2937',
  red: '#ff6e5e', green: '#5eff6c', yellow: '#f1ff5e', blue: '#5ea1ff', magenta: '#bd5eff', cyan: '#5ef1ff', white: '#ffffff',
  brightBlack: '#3c4048', brightRed: '#ff6e5e', brightGreen: '#5eff6c', brightYellow: '#f1ff5e', brightBlue: '#5ea1ff', brightMagenta: '#bd5eff', brightCyan: '#5ef1ff', brightWhite: '#ffffff',
}
export interface PaneTerminalProps { paneId: string; status?: string; accent?: AgentAccent; maximized?: boolean; agent?: string; compact?: boolean }
type IoMode = 'controlling' | 'snapshot' | 'blocked'

export function PaneTerminal({ paneId, status, accent, maximized, agent, compact = false }: PaneTerminalProps) {
  const hostRef = useRef<HTMLDivElement>(null)
  const terminalRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const retryRef = useRef<(() => void) | null>(null)
  const takeoverRef = useRef<(() => void) | null>(null)
  const [syncStatus, setSyncStatus] = useState<'syncing' | 'ready' | 'error'>('syncing')
  const [syncError, setSyncError] = useState<string | null>(null)
  const [inputError, setInputError] = useState<string | null>(null)
  const [historyIncomplete, setHistoryIncomplete] = useState(false)
  const [compatMode, setCompatMode] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirmTakeover, setConfirmTakeover] = useState(false)
  void useHerdrLang()

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    const lifetime = new AbortController()
    const { signal } = lifetime
    const terminal = new Terminal({ cursorBlink: true, fontSize: 13, fontFamily: resolveTerminalFontFamily(host), lineHeight: 1.2, scrollback: 5000, allowTransparency: true, theme: THEME })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(host)
    terminalRef.current = terminal
    fitRef.current = fit
    let mode: IoMode = 'blocked'
    let leased = false
    let offStore: (() => void) | undefined
    let offOutput: (() => void) | undefined
    let snapshotTimer: ReturnType<typeof setInterval> | undefined
    let snapshotDebounce: ReturnType<typeof setTimeout> | undefined
    let resizeTimer: ReturnType<typeof setTimeout> | undefined
    let snapshotRunning = false
    let snapshotQueued = false
    let lastSnapshot: string | undefined
    let lastSize = ''
    const frames = new Set<number>()
    const laterFrame = (callback: () => void) => {
      const id = requestAnimationFrame(() => { frames.delete(id); if (!signal.aborted) callback() })
      frames.add(id)
    }
    const size = () => ({ cols: Math.max(1, Math.min(1000, terminal.cols)), rows: Math.max(1, Math.min(1000, terminal.rows)) })
    const fitAndNotify = () => {
      if (signal.aborted) return
      try { fit.fit() } catch { return }
      const dimensions = size()
      const key = dimensions.cols + ':' + dimensions.rows
      if (key !== lastSize && mode === 'controlling') {
        lastSize = key
        terminalSessionStore.resize(paneId, dimensions)
      }
    }
    const scheduleFit = () => {
      if (resizeTimer) clearTimeout(resizeTimer)
      resizeTimer = setTimeout(fitAndNotify, 120)
    }
    const writer = new TerminalFrameWriter({
      write: (frame, done) => terminal.write(rebaseTerminalFrame(frame.bytes, frame.full), done),
      confirm: frame => terminalSessionStore.confirmFrame(paneId, frame.seq, frame.generation, frame.sessionId),
      error: () => { mode = 'blocked'; setSyncStatus('error'); setSyncError(t('terminal.backpressure')) },
    })
    const input = terminal.onData(data => {
      setInputError(null)
      if (mode === 'controlling') terminalSessionStore.sendInput(paneId, new TextEncoder().encode(data))
      else if (mode === 'snapshot') void sendPaneInput(paneId, { text: data }, signal).catch(error => {
        if (!signal.aborted) setInputError(error instanceof Error ? error.message : String(error))
      })
    })
    const refreshSnapshot = async () => {
      if (signal.aborted || mode !== 'snapshot') return
      if (snapshotRunning) { snapshotQueued = true; return }
      snapshotRunning = true
      try {
        const result = await fetchTerminalBootstrap(paneId, 500, signal, 'recent_unwrapped')
        if (signal.aborted || mode !== 'snapshot') return
        if (result.text !== lastSnapshot) {
          lastSnapshot = result.text
          const { viewportY, baseY } = terminal.buffer.active
          terminal.reset()
          terminal.write(trimAnsiSnapshotPadding(result.text), () => {
            if (signal.aborted || mode !== 'snapshot') return
            if (viewportY >= baseY) terminal.scrollToBottom()
            else terminal.scrollToLine(viewportY)
          })
        }
        setHistoryIncomplete(result.truncated)
        setSyncStatus('ready')
        setSyncError(null)
      } catch (error) {
        if (!signal.aborted) { setSyncStatus('error'); setSyncError(error instanceof Error ? error.message : String(error)) }
      } finally {
        snapshotRunning = false
        if (snapshotQueued) { snapshotQueued = false; void refreshSnapshot() }
      }
    }
    const stopSnapshot = () => {
      offOutput?.(); offOutput = undefined
      if (snapshotTimer) clearInterval(snapshotTimer)
      if (snapshotDebounce) clearTimeout(snapshotDebounce)
      snapshotTimer = snapshotDebounce = undefined
    }
    const startSnapshot = () => {
      if (signal.aborted || mode === 'snapshot') return
      writer.reset()
      mode = 'snapshot'
      setCompatMode(true)
      setSyncStatus('syncing')
      stopSnapshot()
      offOutput = subscribePaneOutput(paneId, () => {
        if (snapshotDebounce) clearTimeout(snapshotDebounce)
        snapshotDebounce = setTimeout(() => { void refreshSnapshot() }, 250)
      })
      snapshotTimer = setInterval(() => { void refreshSnapshot() }, 20_000)
      void refreshSnapshot()
    }
    const onSignal = (event: TerminalStoreSignal) => {
      if (signal.aborted) return
      if (event.type === 'frame') {
        if (mode !== 'controlling') return
        try {
          const bytes = Uint8Array.from(atob(event.bytes), char => char.charCodeAt(0))
          writer.push({ sessionId: event.sessionId ?? '', generation: event.generation, seq: event.seq, full: event.full, bytes })
        } catch { mode = 'blocked'; setSyncStatus('error'); setSyncError(t('terminal.protocolError')) }
        return
      }
      if (event.status === 'controlling') {
        stopSnapshot()
        mode = 'controlling'
        setCompatMode(false)
        setConflict(false)
        setConfirmTakeover(false)
        setSyncStatus('ready')
        setSyncError(null)
        setInputError(event.message ?? null)
        setHistoryIncomplete(false)
        fitAndNotify()
      } else if (event.status === 'starting') {
        mode = 'blocked'
        setSyncStatus('syncing')
      } else if (event.status === 'conflict') {
        mode = 'blocked'
        stopSnapshot()
        setConflict(true)
        setSyncStatus('error')
        setSyncError(event.message ?? t('terminal.conflict'))
      } else if (event.status === 'error' || event.status === 'closed') {
        setConflict(false)
        startSnapshot()
      }
    }
    const begin = async () => {
      try {
        // Seed history BEFORE subscribing to live frames. The bounded budget
        // avoids an unbounded pending-frame list while an RPC is slow.
        const history = await withBudget(fetchTerminalBootstrap(paneId, 500, signal, 'recent_unwrapped'), signal, 250)
        if (signal.aborted) return
        if (history) await new Promise<void>(resolve => {
          const done = () => { signal.removeEventListener('abort', done); resolve() }
          signal.addEventListener('abort', done, { once: true })
          try { terminal.write(trimAnsiSnapshotPadding(history.text), done) } catch { done() }
        })
      } catch { /* live baseline still works without historical scrollback */ }
      if (signal.aborted) return
      offStore = terminalSessionStore.subscribe(paneId, onSignal)
      leased = true
      await terminalSessionStore.requestControl(paneId, size())
    }
    retryRef.current = () => {
      writer.reset()
      mode = 'blocked'
      lastSize = ''
      stopSnapshot()
      setSyncStatus('syncing')
      void terminalSessionStore.resynchronize(paneId, size())
    }
    takeoverRef.current = () => {
      writer.reset()
      mode = 'blocked'
      lastSize = ''
      setConflict(false)
      void terminalSessionStore.requestControl(paneId, size(), true)
    }
    const observer = new ResizeObserver(scheduleFit)
    observer.observe(host)
    if (host.parentElement) observer.observe(host.parentElement)
    const visibility = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) scheduleFit() })
    visibility.observe(host)
    window.addEventListener('resize', scheduleFit)
    window.addEventListener('herdr:layout-changed', scheduleFit)
    document.addEventListener('herdr:layout-changed', scheduleFit)
    fitAndNotify()
    laterFrame(fitAndNotify)
    void begin().catch(error => { if (!signal.aborted) { setSyncError(String(error)); startSnapshot() } })
    return () => {
      lifetime.abort()
      offStore?.()
      stopSnapshot()
      if (resizeTimer) clearTimeout(resizeTimer)
      for (const frame of frames) cancelAnimationFrame(frame)
      observer.disconnect()
      visibility.disconnect()
      window.removeEventListener('resize', scheduleFit)
      window.removeEventListener('herdr:layout-changed', scheduleFit)
      document.removeEventListener('herdr:layout-changed', scheduleFit)
      input.dispose()
      writer.dispose()
      terminal.dispose()
      terminalRef.current = null
      fitRef.current = null
      retryRef.current = takeoverRef.current = null
      if (leased) void terminalSessionStore.release(paneId)
    }
  }, [paneId])
  useEffect(() => {
    const frame = requestAnimationFrame(() => { try { fitRef.current?.fit() } catch { /* layout transition */ } if (maximized) terminalRef.current?.focus() })
    return () => cancelAnimationFrame(frame)
  }, [maximized])

  const headerMode = conflict ? 'conflict' : compatMode ? 'snapshot' : 'controlling'
  const modeLabel = conflict ? t('pane.terminalControlledByOther') : compatMode ? t('pane.modeSnapshot') : t('pane.modeControlling')
  const detail = [historyIncomplete ? t('pane.terminalHistoryIncomplete') : '', syncStatus === 'syncing' ? t('pane.terminalSyncing') : '', syncError ?? '', inputError ? `${t('pane.terminalInputFailed')}: ${inputError}` : ''].filter(Boolean).join(' · ')
  const chip = syncStatus === 'syncing' ? t('pane.terminalSyncing') : syncStatus === 'error' ? t('pane.syncErrorShort') : compatMode ? t('pane.modeSnapshot') : null
  return (
    <div className={`herdr-term${maximized ? ' herdr-term-maximized' : ''}${compact ? ' herdr-term--compact' : ''}`} data-accent={accent ?? undefined}>
      {!compact && <div className="herdr-term-header" data-mode={headerMode}>
        <span className="herdr-term-header-left"><StateDot state={dotState(status)} /><span>{modeLabel}</span></span>
        <span className="herdr-term-header-center">{agent && <span className="herdr-term-occupant"><span className="herdr-agent-accent" data-accent={agentTheme(agent)} />{agent}</span>}</span>
        <span className="herdr-term-header-right"><sup className="herdr-term-sup" title={detail}>{detail}</sup></span>
      </div>}
      {compact && chip && <span className="herdr-term-chip" data-mode={headerMode} data-error={syncStatus === 'error' || undefined} title={detail || modeLabel}>{chip}</span>}
      {conflict && <div className="herdr-term-conflict-bar" role="alert">
        <span>{modeLabel}</span><span className="herdr-term-conflict-actions">
          {confirmTakeover ? <><span>{t('pane.confirmTakeoverHint')}</span><button type="button" onClick={() => takeoverRef.current?.()}>{t('pane.confirmTakeover')}</button><button type="button" onClick={() => setConfirmTakeover(false)}>{t('view.close')}</button></> : <button type="button" onClick={() => setConfirmTakeover(true)}>{t('pane.requestTakeover')}</button>}
        </span>
      </div>}
      {!conflict && syncStatus === 'error' && <button type="button" onClick={() => retryRef.current?.()}>{t('pane.terminalReconnect')}</button>}
      <div className="herdr-term-host-wrap"><div ref={hostRef} className="herdr-xterm-host" role="log" aria-label={t('pane.terminalOutput')} /></div>
      {status === 'working' && <span className="herdr-log-live" role="status" title={t('pane.workingIndicator')} aria-label={t('pane.workingIndicator')} />}
    </div>
  )
}
async function withBudget<T>(request: Promise<T>, signal: AbortSignal, milliseconds: number): Promise<T | null> {
  return new Promise(resolve => {
    const done = (value: T | null) => { clearTimeout(timer); signal.removeEventListener('abort', abort); resolve(value) }
    const abort = () => done(null)
    const timer = setTimeout(abort, milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    request.then(value => done(value), abort)
    if (signal.aborted) abort()
  })
}

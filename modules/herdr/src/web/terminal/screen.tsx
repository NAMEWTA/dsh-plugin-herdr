import { useEffect, useRef } from 'react'
import { useWorkbench, RequestError } from '@workbench/ui'
import { terminalEventSchema, type TerminalLease } from '../../contracts/index.ts'
import { FrameWriter } from './frame-writer.ts'
import { InputChannel } from './input-channel.ts'
import { loadTerminal } from './driver.ts'
import type { Terminal } from '@xterm/xterm'
export interface ScreenHandle { copy: () => string; send: (text: string) => boolean }
export function TerminalScreen({ lease, onClose, onPaste, onReady }: {
  lease: TerminalLease; onClose: (error?: Error) => void; onPaste: (text: string) => void; onReady: (handle: ScreenHandle | null) => void
}) {
  const { client, preferences } = useWorkbench()
  const container = useRef<HTMLDivElement>(null), term = useRef<Terminal | null>(null)
  const callbacks = useRef({ onClose, onPaste, onReady }); callbacks.current = { onClose, onPaste, onReady }
  const theme = preferences.theme
  useEffect(() => {
    const abort = new AbortController()
    let cleanup = () => {}, closed = false
    const fail = (code: string) => {
      if (closed || abort.signal.aborted) return
      closed = true; abort.abort(); callbacks.current.onClose(new RequestError(code, 'terminal-stream'))
    }
    const channel = new InputChannel(() => fail('OPERATION_OUTCOME_UNKNOWN'))
    const run = async () => {
      // Delay both initialization and all bridge activity until a user opens a real pane.
      const { Terminal, FitAddon } = await loadTerminal()
      if (abort.signal.aborted || !container.current) return
      const terminal = new Terminal({ allowProposedApi: false, allowTransparency: false, disableStdin: true,
        cursorBlink: false, scrollback: 3000, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        screenReaderMode: true, convertEol: false, theme: terminalTheme(container.current) })
      const fit = new FitAddon(); terminal.loadAddon(fit); term.current = terminal
      terminal.open(container.current); fit.fit()
      // No clipboard or title escape sequence can perform privileged browser operations.
      const osc52 = terminal.parser.registerOscHandler(52, () => true)
      let ready = false
      const writer = new FrameWriter(terminal, () => fail('STREAM_RESYNC_REQUIRED'), 8*1024*1024, frame => { if(frame.full&&!abort.signal.aborted){ready=true;if(container.current)container.current.dataset.ready='true';terminal.options.disableStdin=lease.mode!=='control';terminal.options.cursorBlink=lease.mode==='control'} })
      const data = terminal.onData(text => { if (ready && lease.mode === 'control') channel.input(text) })
      const resize = () => {
        const size = fit.proposeDimensions()
        if (size && size.cols > 0 && size.rows > 0) channel.push({ type: 'resize', cols: Math.min(size.cols, 400), rows: Math.min(size.rows, 200) })
      }
      const observer = new ResizeObserver(resize); observer.observe(container.current)
      const paste = (event: ClipboardEvent) => {
        if (lease.mode !== 'control') return
        event.preventDefault(); event.stopImmediatePropagation()
        callbacks.current.onPaste(event.clipboardData?.getData('text/plain') ?? '')
      }
      const element = container.current; element.addEventListener('paste', paste, true)
      let cleaned = false
      cleanup = () => { if(cleaned)return;cleaned=true; ready = false; delete element.dataset.ready; callbacks.current.onReady(null); observer.disconnect(); element.removeEventListener('paste', paste, true); data.dispose(); osc52.dispose(); writer.dispose(); terminal.dispose(); if(term.current===terminal)term.current = null }
      callbacks.current.onReady({ copy: () => terminal.getSelection(), send: text => ready && lease.mode === 'control' && channel.input(text) })
      resize()
      const envelope = { operation: 'herdr.terminal.frames', requestId: crypto.randomUUID(), input: { leaseId: lease.leaseId } }
      for await (const raw of client.stream(envelope, channel, abort.signal)) {
        if (abort.signal.aborted) break
        const parsed = terminalEventSchema.safeParse(raw)
        if (!parsed.success) { fail('STREAM_RESYNC_REQUIRED'); break }
        const event = parsed.data
        if (event.type === 'frame') {
          if (!writer.accept(event)) break

        } else if (event.type === 'ack') channel.acknowledge(event.sequence)
        else if (event.type === 'error' || event.type === 'conflict') { fail(event.type === 'conflict' ? 'LEASE_CONFLICT' : 'LEASE_EXPIRED'); break }
        else if (event.type === 'closed') { fail('LEASE_EXPIRED'); break }
      }
      if (!abort.signal.aborted) fail('CONNECTION_UNAVAILABLE')
    }
    void run().catch(() => fail('CONNECTION_UNAVAILABLE')).finally(() => { channel.close(); cleanup() })
    return () => { abort.abort(); channel.close(); cleanup() }
  }, [lease.leaseId, client])
  useEffect(() => { if (term.current && container.current) term.current.options.theme = terminalTheme(container.current) }, [theme])
  return <div className="wb-terminal-screen" data-wb-terminal ref={container} />
}
function terminalTheme(element: HTMLElement) {
  const css = getComputedStyle(element)
  return { background: css.getPropertyValue('--wb-term-bg').trim() || '#111820', foreground: css.getPropertyValue('--wb-term-fg').trim() || '#e3e8ef', cursor: '#70a5ff', selectionBackground: '#38609b80' }
}

// 全局面板（design: dashboard-global v4 —— 插件-only：marker 注入 sidebar 文档流 +
// shell.overlay 右侧工作区完整 surface）。宿主 DSH 零改动。
// 按钮：原生 DOM marker 插到 New Session 与 regionArea 之间（同一文档流），带三态
// 状态点（运行中/已停止/未安装/检查中，复用 statusStore 快照——P1-1）；surface：
// shell.overlay 内从 sidebar 右边界覆盖整个右侧工作区，header 含状态+版本+启动，
// 复用 DashboardContent；workspace 卡片点击关闭 surface 返回 conversation。

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Button } from './ui.tsx'
import { getHerdrRemote } from './remote.ts'
import {
  deriveMarkerServerState,
  formatTime,
  type MarkerServerState,
} from './logic.ts'
import { t, useHerdrLang } from './i18n.ts'
import {
  statusStore,
  useHerdrDashboard,
  useHerdrStart,
} from './store.ts'
import { getSessionId, navigateToPane } from './navigation.ts'
import { fetchPaneSession, fetchSelfPaneId } from './session-pane.ts'
import { DashboardContent } from './dashboard-view.tsx'
import { HerdrLogo } from './pane-list.tsx'
import type { HerdrDashboardPaneRef } from './dashboard-types.ts'

/** sidebar.panellist glyph. The slot supplies size and active; click selects the main panel. */
export function HerdrPanelIcon({ size = 18 }: { size?: number; active?: boolean }) {
  const state = deriveMarkerServerState(statusStore.getSnap())
  return (
    <span className="herdr-panel-icon" data-state={state} style={{ width: size, height: size }}>
      <HerdrLogo />
      <span className="herdr-state-dot" data-state={state} aria-hidden />
    </span>
  )
}

/** 三态状态文本（v4 需求 2：按钮 title/aria 附状态，颜色不是唯一信息）。 */
function markerStateText(state: MarkerServerState): string {
  switch (state) {
    case 'running': return t('global.stateRunning')
    case 'stopped': return t('global.stateStopped')
    case 'not-installed': return t('global.stateNotInstalled')
    default: return t('global.stateChecking')
  }
}
/** Dashboard rendered in the main column when sidebar.panellist selects it. */
export function HerdrDashboardPanel(): ReactNode {
  void useHerdrLang()
  const [notice, setNotice] = useState<string | null>(null)
  const noticeTimer = useRef<number | undefined>(undefined)
  const showNotice = (message: string) => {
    setNotice(message)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 3000)
  }
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])

  const [selfPaneId, setSelfPaneId] = useState<string | null>(null)
  const selfPaneIdRef = useRef<string | null>(null)
  const lastSessionId = useRef<string | undefined>(undefined)
  useEffect(() => {
    const timer = setInterval(() => {
      const id = getSessionId()
      if (id !== lastSessionId.current) {
        lastSessionId.current = id
        setSelfPaneId(null)
        selfPaneIdRef.current = null
        return
      }
      if (!id || selfPaneIdRef.current) return
      void fetchSelfPaneId(id).then(paneId => {
        setSelfPaneId(paneId)
        if (paneId) selfPaneIdRef.current = paneId
      })
    }, 1000)
    return () => clearInterval(timer)
  }, [])

  const [hiddenWorkspaceIds, setHiddenWorkspaceIds] = useState<Set<string>>(new Set())
  const [hiddenPaneIds, setHiddenPaneIds] = useState<Set<string>>(new Set())
  const [actionError, setActionError] = useState<{ message: string; key: number } | null>(null)
  const showErr = (message: string) => setActionError(prev => ({ message, key: (prev?.key ?? 0) + 1 }))
  const postClose = async (kind: 'workspace' | 'pane', id: string): Promise<void> => {
    if (kind === 'workspace') setHiddenWorkspaceIds(prev => new Set(prev).add(id))
    else setHiddenPaneIds(prev => new Set(prev).add(id))
    try {
      const body = await getHerdrRemote().close({ kind, id }) as { ok?: boolean; error?: string }
      if (!body.ok) throw new Error(body.error ?? 'herdr close failed')
      refreshDash()
    } catch (e) {
      if (kind === 'workspace') setHiddenWorkspaceIds(prev => { const n = new Set(prev); n.delete(id); return n })
      else setHiddenPaneIds(prev => { const n = new Set(prev); n.delete(id); return n })
      showErr(e instanceof Error ? e.message : String(e))
    }
  }

  const onPaneClick = (target: HerdrDashboardPaneRef) => {
    const sid = getSessionId()
    void fetchPaneSession(target.pane_id).then(paneSessionId => {
      try {
        navigateToPane(target.pane_id, { selfSessionId: sid, paneSessionId })
      } catch (e) {
        showNotice(e instanceof Error ? e.message : String(e))
      }
    })
  }

  const { snap: dashSnap, error, refresh: refreshDash } = useHerdrDashboard()
  const { starting, startError, start } = useHerdrStart()
  const server = dashSnap?.server
  const serverState = deriveMarkerServerState(dashSnap)
  const disconnected = !dashSnap && error != null
  const handleStart = async () => {
    const ok = await start()
    if (ok) {
      refreshDash()
      statusStore.refresh()
    }
  }

  return (
    <section className="herdr-dash-panel" aria-label={t('global.title')}>
      <header className="herdr-gds-head">
        <span className="herdr-gds-title">
          <HerdrLogo className="herdr-gds-logo" />
          {t('global.title')}
        </span>
        <span className="herdr-gds-state" data-state={disconnected ? 'not-installed' : serverState}>
          <span className="herdr-state-dot" data-state={disconnected ? 'not-installed' : serverState} aria-hidden />
          <span>{disconnected ? t('banner.unavailable') : markerStateText(serverState)}</span>
          {server?.version ? <span className="herdr-gds-version">v{server.version}</span> : null}
        </span>
        {serverState === 'stopped' || serverState === 'not-installed' || disconnected ? (
          <Button variant="primary" size="sm" disabled={starting} onClick={() => void handleStart()}>
            {starting ? t('view.starting') : t('banner.start')}
          </Button>
        ) : null}
        {startError ? <span className="herdr-gds-start-error">{t('banner.startFailed', { error: startError })}</span> : null}
        {dashSnap ? (
          <span className="herdr-gds-fresh">
            {dashSnap.stale ? <span className="herdr-dash-stale-badge">{t('dashboard.stale')}</span> : null}
            <span className="herdr-gds-fresh-time">
              {dashSnap.updated_at > 0 ? t('dashboard.lastUpdated', { time: formatTime(dashSnap.updated_at) }) : t('dashboard.noData')}
            </span>
            <Button variant="outline" size="sm" onClick={refreshDash}>{t('dashboard.refresh')}</Button>
          </span>
        ) : null}
      </header>
      {notice ? <div className="herdr-gds-notice" role="status">{notice}</div> : null}
      {actionError ? (
        <div className="herdr-action-error" key={actionError.key}>
          <span>{actionError.message}</span>
          <button type="button" onClick={() => setActionError(null)} aria-label={t('view.close')}>✕</button>
        </div>
      ) : null}
      {disconnected ? <div className="herdr-server-error">{t('banner.unavailable')}</div> : null}
      <div className="herdr-gds-body">
        <DashboardContent
          onPaneClick={onPaneClick}
          selfPaneId={selfPaneId}
          hiddenWorkspaceIds={hiddenWorkspaceIds}
          hiddenPaneIds={hiddenPaneIds}
          onCloseWorkspace={id => { void postClose('workspace', id) }}
          onClosePane={id => { void postClose('pane', id) }}
        />
      </div>
    </section>
  )
}

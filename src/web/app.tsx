/** DSH alpha shell compatibility stays in this adapter, not in domain code. */
import { HerdrView, HerdrHeaderPill } from './herdr-view.tsx'
import { setSessionIdReader, setSessionOpener } from './navigation.ts'
import { HerdrPaneList } from './pane-list.tsx'
import { startModeTracking, type SessionListLike } from './mode.ts'
import { startSessionListBranding } from './session-list-branding.ts'
import { startTabController } from './tab-controller.ts'
import { startHeroBranding, setHerdrLang } from './hero-branding.ts'
import { HERDR_LOCALE_NS, registerHerdrLocale, setHerdrLocaleTranslate } from './i18n.ts'
import { HerdrDashboardPanel, HerdrPanelIcon } from './global-dashboard.tsx'
import { disposeHerdrEventStream } from './store.ts'
import { terminalSessionStore } from './terminal-session.ts'
interface SlotsApi { inject(name: string, register: () => unknown): unknown; register(options: Record<string, unknown>, component: unknown): unknown }
interface LocaleFaceLike {
  getSnapshot(): { active?: string }
  subscribe(listener: () => void): () => void
  register(namespace: string, dictionaries: { zh: Record<string, string>; en: Record<string, string> }): () => void
  bind(namespace: string): (key: string, params?: Record<string, string | number>) => string
}
export interface ClientCtx {
  slots: SlotsApi
  inject(name: string | string[], callback: (scope: unknown) => unknown): unknown
  effect(callback: () => unknown): unknown
}
interface SessionsApiLike { list?: SessionListLike; open?: (id: string) => void }
export const inject = ['slots', 'locale', 'remote']
export function apply(ctx: ClientCtx) {
  let closed = false
  let stopSessions: (() => void) | undefined
  let stopLocale: (() => void) | undefined
  const stopTabs = startTabController()
  const stopHero = startHeroBranding()
  ctx.inject(['sessions'], (scope: unknown) => {
    if (closed) return
    stopSessions?.()
    const sessions = (scope as { sessions?: SessionsApiLike }).sessions
    setSessionIdReader(() => sessions?.list?.getSnapshot?.()?.current)
    setSessionOpener(id => sessions?.open?.(id))
    if (!sessions?.list) return
    const stopMode = startModeTracking(sessions.list)
    const stopBranding = startSessionListBranding(sessions.list)
    stopSessions = () => { stopMode(); stopBranding() }
  })
  ctx.inject(['locale'], (scope: unknown) => {
    if (closed) return
    stopLocale?.()
    const locale = (scope as { locale?: LocaleFaceLike }).locale
    if (!locale) return
    const unregister = registerHerdrLocale(locale)
    setHerdrLocaleTranslate(locale.bind(HERDR_LOCALE_NS))
    const update = () => setHerdrLang(locale.getSnapshot().active ?? 'zh')
    update()
    const unsubscribe = locale.subscribe(update)
    stopLocale = () => { unsubscribe(); unregister(); setHerdrLocaleTranslate(null) }
  })
  ctx.effect(() => async () => {
    closed = true
    stopSessions?.(); stopLocale?.(); stopTabs(); stopHero()
    setSessionIdReader(() => undefined)
    setSessionOpener(() => {})
    // Explicit releases precede shutting down their event transport.
    try { await terminalSessionStore.dispose() } finally { disposeHerdrEventStream() }
  })
  ctx.slots.inject('conversation.view', () => ctx.slots.register({ name: 'conversation.view', id: 'herdr', order: 20, label: () => 'Herdr' }, HerdrView))
  ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: 'herdr-dashboard', order: 20, label: () => 'Herdr' }, HerdrPanelIcon))
  ctx.slots.inject('main', function* () { yield ctx.slots.register({ name: 'main', key: 'herdr-dashboard' }, HerdrDashboardPanel) })
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({ name: 'conversation.session.header.actions', id: 'herdr-status', order: 30 }, HerdrHeaderPill))
  ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'herdr-pane-list', order: 40 }, HerdrPaneList))
}

import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { Layers3 } from 'lucide-react'
import { Workbench } from '@workbench/shell'
import type { Locale } from '@workbench/contracts'
import type { WebModule } from '@workbench/ui'
import { TYPERT_REMOTE } from '../contract.ts'
import { DshClient, type RemoteNamespace } from './client.ts'
export { DshClient } from './client.ts'
interface SnapshotSource<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface LocaleService extends SnapshotSource<{ active?: string }> {}
interface Slots { inject(name: string, register: () => unknown): unknown; register(options: Record<string, unknown>, component: unknown): unknown }
interface SessionCatalog { getSnapshot(): { byId: Record<string, { cwd?: string }> }; subscribe(listener: () => void): () => void }
export interface WebContext {
  slots: Slots
  remote: { $mount(contribution: unknown): Promise<() => Promise<void>> }
  inject(names: string[], callback: (scope: WebScope) => unknown): unknown
  effect(callback: () => (() => void | Promise<void>) | void): unknown
  /** Present when @deepseek-ai/dsh-client-ui-sidebar-right is injected. */
  sidebarRight?: { openTab(kind: string, options?: { params?: Record<string, unknown> }): void }
  sidebarRightTabs?: { register(definition: { id: string; kind: string; priority?: 'extension' | 'builtin' | 'fallback'; title: (address: string) => string; guide?: ReadonlyArray<{ id: string; order?: number; title: () => string; description?: () => string }> }): () => void }
  sessions?: { list: SessionCatalog }
  /** Present when @deepseek-ai/dsh-client-ui-layout is injected. Selects a registered main panel. */
  layout?: { selectPanel(panelId: string | null): void }
}
type PageBinder = (conversationId: string, open: () => void) => () => void
let pageBinder: PageBinder | undefined
/** The plugin client registers this. The adapter stays free of the Herdr package. */
export function bindWorkbenchPageBridge(bind: PageBinder): () => void {
  pageBinder = bind
  return () => { if (pageBinder === bind) pageBinder = undefined }
}
interface WebScope extends Omit<WebContext, 'remote'> { remote: { workbench: RemoteNamespace }; locale?: LocaleService }
const noSubscribe = () => () => {}
const defaultLocale = () => 'zh'
/** Register only documented slot contributions; never inspect or patch the host DOM. */
const herdrTabId = '@namewta/dsh-workbench/herdr'
let hostLocale: 'zh' | 'en' = 'en'
function railGuide(): string {
  return hostLocale === 'zh' ? '此会话的终端与 Agent' : 'Terminals and agents for this session'
}
export async function mountWorkbench(ctx: WebContext, modules: readonly WebModule[]): Promise<void> {
  let closed = false
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => async () => { closed = true; await unmount() })
  if (ctx.sidebarRightTabs) ctx.effect(() => ctx.sidebarRightTabs!.register({
    id: herdrTabId, kind: 'herdr', priority: 'extension', title: () => 'Herdr',
    guide: [{ id: 'workspace', order: 40, title: () => 'Herdr', description: () => railGuide() }],
  }))
  ctx.inject(['remote.workbench', 'locale'], scope => {
    if (closed) return
    const raw = scope.remote.workbench, locale = scope.locale
    const subscribeLocale = locale ? (listener: () => void) => locale.subscribe(listener) : noSubscribe
    const readLocale = locale ? () => locale.getSnapshot().active ?? 'zh' : defaultLocale
    const applyHostLocale = () => { hostLocale = readLocale().startsWith('zh') ? 'zh' : 'en' }
    applyHostLocale()
    if (locale) ctx.effect(() => locale.subscribe(applyHostLocale))
    function projectPath(sessionId?: string) {
      return sessionId ? ctx.sessions?.list.getSnapshot().byId[sessionId]?.cwd : undefined
    }
    function Panel({ conversationId, settings = false, entry = false, rail = false }: {conversationId?:string;settings?:boolean;entry?:boolean;rail?:boolean}) {
      const client = useMemo(() => new DshClient(raw, conversationId), [conversationId])
      const language = useSyncExternalStore(subscribeLocale, readLocale, defaultLocale)
      const path = useSyncExternalStore(ctx.sessions ? listener => ctx.sessions!.list.subscribe(listener) : noSubscribe, () => projectPath(conversationId), () => undefined)
      useEffect(() => () => client.close(), [client])
      return <Workbench client={client} modules={modules} presentation={entry?'entry':rail?'rail':'app'} sessionEntry={entry||!conversationId} projectPath={path} initialRoute={settings?'platform.settings':conversationId?'herdr.workspaces':'herdr.overview'} locale={language.startsWith('zh')?'zh':'en'} conversationId={conversationId}/>
    }
    function MissingSession() {
      const language=useSyncExternalStore(subscribeLocale,readLocale,defaultLocale)
      return <div role="alert">{language.startsWith('zh')?'无法识别当前会话':'Session identity unavailable'}</div>
    }
    const title = () => 'Workbench'
    scope.slots.inject('sidebar.panellist', () => scope.slots.register({name:'sidebar.panellist',id:'workbench',order:20,label:title}, () => <Layers3 size={20} data-workbench-entry/>))
    scope.slots.inject('main', function* () { yield scope.slots.register({name:'main',key:'workbench'}, Panel) })
    scope.slots.inject('conversation.view', () => scope.slots.register({name:'conversation.view',id:'workbench',order:20,label:title}, ({sessionId}:{sessionId:string}) => sessionId?<Panel conversationId={sessionId}/>:<MissingSession/>))
    scope.slots.inject('settings.plugins.tab', () => scope.slots.register({name:'settings.plugins.tab',id:'workbench-settings',order:30,label:title}, () => <Panel settings/>))
    // DSH mounts conversation.session.header.actions only after the session leaves
    // the blank phase (Into the Unknown). A workspace created before the first
    // message is visible in the right rail; the header count appears once DSH
    // renders this slot. The corner slot stays with the host's expand button.
    function SessionHeader({sessionId, selectView, actions}:{sessionId?:string; selectView?:(view:string)=>void; actions?:{setView?:(view:string)=>void}}) {
      const choose = selectView ?? actions?.setView
      useEffect(() => {
        if (!sessionId || !choose || !pageBinder) return
        return pageBinder(sessionId, () => choose('workbench'))
      }, [sessionId, choose])
      return sessionId ? <Panel conversationId={sessionId} entry/> : null
    }
    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({name:'conversation.session.header.actions',id:'workbench-session-terminals',order:40}, SessionHeader))
    if (ctx.sidebarRightTabs) scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({name:'sidebar.right.pane.tab',key:herdrTabId}, ({sessionId}:{sessionId?:string}) => sessionId ? <Panel conversationId={sessionId} rail/> : null))
  })
}

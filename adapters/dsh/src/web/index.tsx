import { useEffect, useMemo, useSyncExternalStore } from 'react'
import { Layers3 } from 'lucide-react'
import { Workbench } from '@workbench/shell'
import type { Locale } from '@workbench/contracts'
import type { WebModule } from '@workbench/ui'
import { TYPERT_REMOTE } from '../contract.ts'
import { DshClient, type RemoteNamespace } from './client.ts'
export { DshClient } from './client.ts'
interface SnapshotSource<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface Sessions { list?: SnapshotSource<{ current?: string }> }
interface LocaleService extends SnapshotSource<{ active?: string }> {}
interface Slots { inject(name: string, register: () => unknown): unknown; register(options: Record<string, unknown>, component: unknown): unknown }
export interface WebContext {
  slots: Slots
  remote: { $mount(contribution: unknown): Promise<() => Promise<void>> }
  inject(names: string[], callback: (scope: WebScope) => unknown): unknown
  effect(callback: () => (() => void | Promise<void>) | void): unknown
}
interface WebScope extends Omit<WebContext, 'remote'> { remote: { workbench: RemoteNamespace }; sessions?: Sessions; locale?: LocaleService }
const noSubscribe = () => () => {}
const absentSession = () => undefined
const defaultLocale = () => 'zh'
/** Register only documented slot contributions; never inspect or patch the host DOM. */
export async function mountWorkbench(ctx: WebContext, modules: readonly WebModule[]): Promise<void> {
  let closed = false
  const unmount = await ctx.remote.$mount(TYPERT_REMOTE)
  ctx.effect(() => async () => { closed = true; await unmount() })
  ctx.inject(['remote.workbench', 'locale', 'sessions'], scope => {
    if (closed) return
    const raw = scope.remote.workbench, locale = scope.locale, sessions = scope.sessions?.list
    const subscribeLocale = locale ? (listener: () => void) => locale.subscribe(listener) : noSubscribe
    const readLocale = locale ? () => locale.getSnapshot().active ?? 'zh' : defaultLocale
    const subscribeSession = sessions ? (listener: () => void) => sessions.subscribe(listener) : noSubscribe
    const readSession = sessions ? () => sessions.getSnapshot().current : absentSession
    function Panel({ conversation = false, settings = false }: {conversation?:boolean;settings?:boolean}) {
      const client = useMemo(() => new DshClient(raw), [])
      const language = useSyncExternalStore(subscribeLocale, readLocale, defaultLocale)
      const conversationId = useSyncExternalStore(subscribeSession, readSession, absentSession)
      useEffect(() => () => client.close(), [client])
      return <Workbench client={client} modules={modules} initialRoute={settings?'platform.settings':conversation?'herdr.workspaces':'herdr.overview'} locale={language.startsWith('zh')?'zh':'en'} conversationId={conversation?conversationId:undefined}/>
    }
    const title = () => 'Workbench'
    scope.slots.inject('sidebar.panellist', () => scope.slots.register({name:'sidebar.panellist',id:'workbench',order:20,label:title}, () => <Layers3 size={20} data-workbench-entry/>))
    scope.slots.inject('main', function* () { yield scope.slots.register({name:'main',key:'workbench'}, Panel) })
    scope.slots.inject('conversation.view', () => scope.slots.register({name:'conversation.view',id:'workbench',order:20,label:title}, () => <Panel conversation/>))
    scope.slots.inject('settings.plugins.tab', () => scope.slots.register({name:'settings.plugins.tab',id:'workbench-settings',order:30,label:title}, () => <Panel settings/>))
  })
}

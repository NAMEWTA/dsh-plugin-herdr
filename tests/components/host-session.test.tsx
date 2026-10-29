import { test, expect, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { ComponentType } from 'react'
import { mountWorkbench, type WebContext } from '../../adapters/dsh/src/web/index.tsx'
import { DshClient } from '../../adapters/dsh/src/web/client.ts'
vi.mock('@workbench/shell',()=>({Workbench:({conversationId,initialRoute}:{conversationId?:string;initialRoute:string})=><div data-testid="host-slot" data-session={conversationId??''} data-route={initialRoute}/>}))
async function host(locale='en') {
  const slots=new Map<string,ComponentType<any>>(),injects:string[][]=[]
  const scope={
    slots:{inject(_name:string,register:()=>unknown){const result=register();if(result&&typeof result==='object'&&Symbol.iterator in result)Array.from(result as Iterable<unknown>);return result},register(options:Record<string,unknown>,component:unknown){slots.set(String(options.name),component as ComponentType<any>)}},
    locale:{getSnapshot:()=>({active:locale}),subscribe:()=>()=>{}},
    remote:{workbench:{}},effect:()=>{}
  }
  const ctx={...scope,remote:{$mount:async()=>async()=>{}},inject(names:string[],register:(scope:unknown)=>unknown){injects.push(names);register(scope)}}
  await mountWorkbench(ctx as WebContext,[])
  return {slots,injects}
}
test('conversation slot uses public SessionStandardProps.sessionId, never a nonexistent sessions.list.current',async()=>{
  const {slots,injects}=await host(),Slot=slots.get('conversation.view')!
  const close=vi.spyOn(DshClient.prototype,'close')
  const view=render(<Slot sessionId="conversation-a"/>)
  expect(screen.getByTestId('host-slot').getAttribute('data-session')).toBe('conversation-a')
  expect(screen.getByTestId('host-slot').getAttribute('data-route')).toBe('herdr.workspaces')
  view.rerender(<Slot sessionId="conversation-b"/>)
  expect(screen.getByTestId('host-slot').getAttribute('data-session')).toBe('conversation-b')
  await waitFor(()=>expect(close).toHaveBeenCalledTimes(1))
  expect(injects.flat()).not.toContain('sessions')
  view.unmount();expect(close).toHaveBeenCalledTimes(2)
})
test('missing session identity fails closed instead of rendering a global workspace as session-owned',async()=>{
  const {slots}=await host('zh'),Slot=slots.get('conversation.view')!
  render(<Slot/>)
  expect(screen.queryByTestId('host-slot')).toBeNull()
  expect(screen.getByRole('alert').textContent).toBe('无法识别当前会话')
})
test('Herdr registers a right-sidebar page tab when the host provides the registry',async()=>{
  const registered: Array<{id?:string;kind?:string}> = []
  const slots=new Map<string,ComponentType<any>>()
  const scope={
    slots:{inject(_name:string,register:()=>unknown){const result=register();if(result&&typeof result==='object'&&Symbol.iterator in result)Array.from(result as Iterable<unknown>);return result},register(options:Record<string,unknown>,component:unknown){slots.set(String(options.key??options.name),component as ComponentType<any>)}},
    locale:{getSnapshot:()=>({active:'en'}),subscribe:()=>()=>{}},
    remote:{workbench:{}},
    effect(callback:()=>unknown){return callback()}
  }
  const ctx={...scope,remote:{$mount:async()=>async()=>{}},inject(_names:string[],register:(scope:unknown)=>unknown){register(scope)},sidebarRightTabs:{register(definition:{id?:string;kind?:string}){registered.push(definition);return()=>{}}},sessions:{list:{getSnapshot:()=>({byId:{'conversation-a':{cwd:'/demo/workbench'}}}),subscribe:()=>()=>{}}}}
  await mountWorkbench(ctx as WebContext,[])
  expect(registered.map(item=>item.kind)).toEqual(['herdr'])
  expect(registered[0]?.id).toBe('@namewta/dsh-workbench/herdr')
  const guide=(registered[0] as {guide?:Array<{description?:()=>string}>}).guide
  expect(guide?.[0]?.description?.()).toBe('Terminals and agents for this session')
  const Tab=slots.get('@namewta/dsh-workbench/herdr')!
  render(<Tab sessionId="conversation-a"/>)
  expect(screen.getByTestId('host-slot').getAttribute('data-session')).toBe('conversation-a')
})
test('host sidebar labels follow the DSH locale',async()=>{
  const labels:string[]=[]
  const scope={
    slots:{inject(_name:string,register:()=>unknown){const result=register();if(result&&typeof result==='object'&&Symbol.iterator in result)Array.from(result as Iterable<unknown>);return result},register(options:Record<string,unknown>){if(typeof options.label==='function')labels.push((options.label as ()=>string)())}},
    locale:{getSnapshot:()=>({active:'zh'}),subscribe:()=>()=>{}},
    remote:{workbench:{}},effect:()=>{}
  }
  const ctx={...scope,remote:{$mount:async()=>async()=>{}},inject(_names:string[],register:(scope:unknown)=>unknown){register(scope)}}
  await mountWorkbench(ctx as WebContext,[])
  expect(labels.length).toBeGreaterThan(0)
  expect(labels.every(label=>label==='工作台')).toBe(true)
})
test('global entry stays independent from conversation and system settings has its own default route',async()=>{
  const {slots}=await host(),Main=slots.get('main')!,Settings=slots.get('settings.plugins.tab')!
  const view=render(<Main/>)
  expect(screen.getByTestId('host-slot').getAttribute('data-route')).toBe('herdr.overview')
  expect(screen.getByTestId('host-slot').getAttribute('data-session')).toBe('')
  view.rerender(<Settings/>)
  expect(screen.getByTestId('host-slot').getAttribute('data-route')).toBe('platform.settings')
})

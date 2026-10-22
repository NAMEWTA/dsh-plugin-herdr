// Test-only public host adapter. The plugin under test is the actual built client.js,
// not a recompiled Workbench component. No terminal loader is configured by this fixture.
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactDOMClient from 'react-dom/client'
import * as JSX from 'react/jsx-runtime'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
import type { RequestEnvelope } from '@workbench/contracts'
void (async()=>{
const demo = await createDemo('normal')
const effects: Array<() => unknown> = [], slots = new Map<string, React.ComponentType>()
const operations: Array<{operation:string;input:unknown}> = []
function queue() {
  const items: unknown[] = []; let wake: (() => void) | undefined, closed = false
  return {push(value:unknown){items.push(value);wake?.()},close(){closed=true;wake?.()},async *[Symbol.asyncIterator](){while(!closed){if(items.length)yield items.shift();else await new Promise<void>(resolve=>{wake=resolve})}}}
}
function handle(run:(signal:AbortSignal,input:AsyncIterable<unknown>)=>AsyncIterable<unknown>) {
  const abort = new AbortController(), input = queue()
  return {send:(value:unknown)=>input.push(value),end:()=>input.close(),dispose(){abort.abort();input.close()},[Symbol.asyncIterator]:()=>run(abort.signal,input)[Symbol.asyncIterator]()}
}
const remote = {
  connect:async()=>({ok:true,value:{clientId:'fixture-client-id-1234567890123456',capabilities:[]}}),
  disconnect:async()=>({ok:true,value:{}}),
  request:async({envelope}:{envelope:RequestEnvelope})=>{operations.push({operation:envelope.operation,input:envelope.input});return {ok:true,value:await demo.client.request(envelope)}},
  events:()=>handle(signal=>demo.client.events(signal)),
  stream:({envelope}:{envelope:RequestEnvelope})=>handle((signal,input)=>demo.client.stream(envelope,input,signal)),
}
const scope = {
  remote:{workbench:remote,$mount:async()=>()=>{}},
  locale:{getSnapshot:()=>({active:'zh'}),subscribe:()=>()=>{}},
  slots:{register(options:{name:string},component:React.ComponentType){slots.set(options.name,component)},inject(_name:string,fn:()=>unknown){const result=fn();if(result&&typeof result==='object'&&Symbol.iterator in result)Array.from(result as Iterable<unknown>)}},
  effect(fn:()=>unknown){const dispose=fn();if(typeof dispose==='function')effects.push(dispose as ()=>unknown)},
  inject(_names:string[],fn:(ctx:unknown)=>unknown){fn(scope)},
}
const host = {react:React,'react/jsx-runtime':JSX,'react-dom':ReactDOM,'react-dom/client':ReactDOMClient}
Object.assign(window, {terminalOperations:operations,__ModuleLoader__:{async load(value:{factory:(require:(name:string)=>unknown)=>{apply:(ctx:unknown)=>Promise<void>}}){
  try{
    const plugin=value.factory(name=>{if(!(name in host))throw Error('Unexpected dependency '+name);return host[name as keyof typeof host]})
    await plugin.apply(scope)
    const Panel=slots.get('main');if(!Panel)throw Error('Missing public main slot')
    ReactDOMClient.createRoot(document.getElementById('root')!).render(<Panel/>)
  }catch(error){document.getElementById('root')!.textContent=String(error);throw error}
}}})

})()

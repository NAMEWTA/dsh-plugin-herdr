import { test, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { herdrWeb } from '@workbench/herdr/web'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
import type { WorkbenchClient, Locale } from '@workbench/contracts'
import type { HerdrSnapshot } from '@workbench/herdr/contracts'

vi.mock('../../modules/herdr/src/web/terminal/driver.ts',()=>({loadTerminal:async()=>({})}))
vi.mock('../../modules/herdr/src/web/terminal/screen.tsx',()=>({TerminalScreen:()=> <div data-testid="terminal-renderer"/>}))

async function start(scenario='normal',locale:Locale='en',snapshot?:(value:HerdrSnapshot)=>HerdrSnapshot){
  const demo=await createDemo(scenario)
  const request=vi.fn(async(envelope:Parameters<WorkbenchClient['request']>[0],signal?:AbortSignal)=>{
    const result=await demo.client.request(envelope,signal)
    return envelope.operation==='herdr.snapshot'&&result.ok&&snapshot
      ? {...result,data:snapshot(structuredClone(result.data) as unknown as HerdrSnapshot)} : result
  })
  const view=render(<Workbench client={{...demo.client,request:request as WorkbenchClient['request']}} modules={[herdrWeb]} initialRoute="herdr.workspaces" locale={locale}/>)
  await screen.findByRole('heading',{level:1})
  return {request,async close(){view.unmount();await demo.dispose()}}
}

test('sidebar workspace switching resets the tab filter in both directions',async()=>{
  const d=await start()
  try{
    const tree=within(await screen.findByRole('navigation',{name:'Workspaces and panes'}))
    await userEvent.click(tree.getByRole('button',{name:'Workbench'}))
    const main=within(screen.getByRole('main'))
    await userEvent.click(await main.findByRole('button',{name:'Main'}))
    expect(main.getByRole('button',{name:'Main'}).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(tree.getByRole('button',{name:'服务端控制面'}))
    await screen.findByRole('heading',{level:1,name:'服务端控制面'})
    expect(main.getByRole('button',{name:'View pane UI · 组件系统'})).toBeTruthy()
    expect(main.getByRole('button',{name:'All'}).getAttribute('aria-pressed')).toBe('true')
    await userEvent.click(main.getByRole('button',{name:'Main'}))
    await userEvent.click(tree.getByRole('button',{name:'Workbench'}))
    await screen.findByRole('heading',{level:1,name:'Workbench'})
    expect(main.getByRole('button',{name:'View pane API · 请求校验'})).toBeTruthy()
    expect(main.getByRole('button',{name:'All'}).getAttribute('aria-pressed')).toBe('true')
  }finally{await d.close()}
})

for(const change of ['removed','replaced'] as const)test('selected tab '+change+' in a refreshed snapshot falls back to All',async()=>{
  let changed=false
  const d=await start('normal','en',snapshot=>{
    const original=snapshot.tabs.find(t=>t.ref.id==='w1:t1')!
    snapshot.tabs.push({...original,ref:{...original.ref,id:'w1:t2',instance:'second-tab'},label:'Other'})
    snapshot.panes=snapshot.panes.map(p=>p.ref.id==='w1:p4'?{...p,tabId:'w1:t2'}:p)
    if(changed){
      snapshot.tabs=snapshot.tabs.flatMap(t=>t.ref.id!=='w1:t1'?[t]:change==='removed'?[]:[{...t,ref:{...t.ref,instance:'replacement-tab'}}])
      if(change==='removed')snapshot.panes=snapshot.panes.filter(p=>p.tabId!=='w1:t1')
    }
    return snapshot
  })
  try{
    await userEvent.click(within(await screen.findByRole('navigation',{name:'Workspaces and panes'})).getByRole('button',{name:'Workbench'}))
    const main=within(screen.getByRole('main'))
    await userEvent.click(await main.findByRole('button',{name:'Main'}))
    expect(main.queryByRole('button',{name:'View pane 文档 · 架构说明'})).toBeNull()
    changed=true
    await userEvent.click(main.getByRole('button',{name:'Refresh'}))
    await main.findByRole('button',{name:'View pane 文档 · 架构说明'})
    expect(main.getByRole('button',{name:'All'}).getAttribute('aria-pressed')).toBe('true')
  }finally{await d.close()}
})

for(const locale of ['en','zh'] as const)test('external takeover explains adoption and revocation before effects ('+locale+')',async()=>{
  const d=await start('external',locale)
  const zh=locale==='zh'
  try{
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button',{name:(zh?'查看面板':'View pane')+' API · 请求校验'}))
    await screen.findByTestId('terminal-renderer')
    const before=d.request.mock.calls.length
    await userEvent.click(screen.getByRole('button',{name:zh?'接管控制权':'Take over control'}))
    let dialog=within(await screen.findByRole('dialog'))
    expect(dialog.getByText(zh?/仅接管此面板的管理权限.*旧窗口的控制租约将失效/:/adopt only this pane.*old window loses its control lease/)).toBeTruthy()
    expect(d.request.mock.calls.slice(before).some(([r])=>r.operation==='herdr.resource.adopt'||r.operation==='herdr.terminal.open'||r.operation==='herdr.terminal.release')).toBe(false)
    await userEvent.click(dialog.getByRole('button',{name:zh?'取消':'Cancel'}))
    expect(screen.getByTestId('terminal-renderer')).toBeTruthy()
    expect(d.request.mock.calls.slice(before).some(([r])=>r.operation==='herdr.resource.adopt'||r.operation==='herdr.terminal.open'||r.operation==='herdr.terminal.release')).toBe(false)
    await userEvent.click(screen.getByRole('button',{name:zh?'接管控制权':'Take over control'}))
    dialog=within(await screen.findByRole('dialog'))
    await userEvent.click(dialog.getByRole('button',{name:zh?'确认':'Confirm'}))
    await waitFor(()=>expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')).toHaveLength(2))
    const effects=d.request.mock.calls.slice(before).map(([r])=>r).filter(r=>['herdr.terminal.release','herdr.resource.adopt','herdr.terminal.open'].includes(r.operation))
    expect(effects.map(r=>r.operation)).toEqual(['herdr.terminal.release','herdr.resource.adopt','herdr.terminal.open'])
    expect(effects[1]!.input).toMatchObject({ref:{kind:'pane',id:'w1:p1',instance:'fixture-w1:p1'},confirmed:true})
    expect(effects[2]!.input).toMatchObject({ref:{kind:'pane',id:'w1:p1'},mode:'control',confirmed:true,takeover:true})
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.resource.adopt')).toHaveLength(1)
  }finally{await d.close()}
})

test('owned pane takeover retains control warning without adopting a resource',async()=>{
  const d=await start()
  try{
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button',{name:'View pane API · 请求校验'}))
    await screen.findByTestId('terminal-renderer')
    await userEvent.click(screen.getByRole('button',{name:'Take over control'}))
    const dialog=within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/Input goes directly into a live terminal.*old window loses its control lease/)).toBeTruthy()
    expect(dialog.queryByText(/adopt only this pane/)).toBeNull()
    await userEvent.click(dialog.getByRole('button',{name:'Confirm'}))
    await waitFor(()=>expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')).toHaveLength(2))
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.resource.adopt')).toBe(false)
  }finally{await d.close()}
})

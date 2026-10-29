import { test, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { herdrWeb } from '@workbench/herdr/web'
import { notesWeb } from '@workbench/example-notes/web'
import { createDemo } from '../../apps/dev-workbench/src/mock.ts'
import type { WorkbenchClient } from '@workbench/contracts'
vi.mock('../../modules/herdr/src/web/terminal/driver.ts',()=>({loadTerminal:async()=>({})}))
vi.mock('../../modules/herdr/src/web/terminal/screen.tsx',()=>({TerminalScreen:()=> <div data-testid="terminal-renderer"/>}))
async function start(scenario='normal',initialRoute='herdr.overview'){
  const demo=await createDemo(scenario),request=vi.fn(demo.client.request.bind(demo.client))
  const client:WorkbenchClient={...demo.client,request:request as WorkbenchClient['request']}
  const props={client,modules:[herdrWeb,notesWeb],initialRoute,locale:'en' as const,conversationId:'demo-conversation'}
  const view=render(<Workbench {...props}/>);await screen.findByRole('heading',{level:1})
  return {request,view,props,async close(){view.unmount();await demo.dispose()}}
}
test('one click collapses the feature sidebar',async()=>{
  const d=await start();try{
    const side=screen.getByRole('complementary',{name:'Feature navigation'})
    await userEvent.click(within(side).getByRole('button',{name:'Collapse navigation'}))
    expect(screen.queryByRole('complementary',{name:'Feature navigation'})).toBeNull()
    expect(screen.getByRole('button',{name:'Expand navigation'})).toBeTruthy()
  }finally{await d.close()}
})
test('the top bar toggle collapses on the first click and expands on the next',async()=>{
  const d=await start();try{
    const bar=within(screen.getByRole('main'))
    await userEvent.click(bar.getByRole('button',{name:'Collapse navigation'}))
    expect(screen.queryByRole('complementary',{name:'Feature navigation'})).toBeNull()
    await userEvent.click(screen.getByRole('button',{name:'Expand navigation'}))
    expect(screen.getByRole('complementary',{name:'Feature navigation'})).toBeTruthy()
  }finally{await d.close()}
})
test('module rail is a disclosure; administration is separate from Herdr navigation',async()=>{
  const d=await start();try{
    const rail=screen.getByRole('navigation',{name:'Feature modules'})
    const title=screen.getByRole('heading',{level:1}).textContent
    expect(within(screen.getByRole('complementary')).queryByRole('button',{name:'Audit log'})).toBeNull()
    await userEvent.click(within(rail).getByRole('button',{name:'Workbench settings'}))
    expect(screen.getByRole('heading',{level:1}).textContent).toBe(title)
    expect(within(screen.getByRole('complementary')).getByRole('button',{name:'Audit log'})).toBeTruthy()
    expect(within(screen.getByRole('complementary')).queryByRole('navigation',{name:'Workspaces and panes'})).toBeNull()
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Appearance'}))
    await screen.findByRole('heading',{level:1,name:'Appearance'})
    await userEvent.click(within(rail).getByRole('button',{name:'Herdr'}))
    expect(screen.getByRole('heading',{level:1}).textContent).toBe('Appearance')
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Overview'}))
    await screen.findByRole('heading',{name:'Your agent workspace'})
  }finally{await d.close()}
})
test('workspace tree shows nested tabs and panes; clicking a pane only opens observation',async()=>{
  const d=await start();try{
    const sidebar=within(screen.getByRole('complementary'))
    const tree=within(await sidebar.findByRole('navigation',{name:'Workspaces and panes'}))
    await userEvent.click(tree.getByRole('button',{name:'View pane API · 请求校验'}))
    await screen.findByTestId('terminal-renderer')
    expect(screen.getByRole('tab',{name:'Main'})).toBeTruthy()
    const opens=d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')
    expect(opens).toHaveLength(1);expect(opens[0]![0].input).toMatchObject({mode:'observe',confirmed:false,takeover:false})
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.resource.adopt')).toBe(false)
  }finally{await d.close()}
})
test('control shortcut opens a confirmation first; cancel never sends control or adoption',async()=>{
  const d=await start();try{
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button',{name:'Control pane API · 请求校验'}))
    const dialog=await screen.findByRole('dialog')
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.terminal.open')).toBe(false)
    await userEvent.click(within(dialog).getByRole('button',{name:'Cancel'}))
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.terminal.open'||r.operation==='herdr.resource.adopt')).toBe(false)
    await userEvent.click(screen.getByRole('button',{name:'Acquire control'}))
    await userEvent.click(within(await screen.findByRole('dialog')).getByRole('button',{name:'Confirm'}))
    await screen.findByTestId('terminal-renderer')
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')[0]![0].input).toMatchObject({mode:'control',confirmed:true,takeover:false})
  }finally{await d.close()}
})
test('bound conversation opens its workspace and panes, not another active workspace',async()=>{
  const d=await start('bound','herdr.workspaces');try{
    await screen.findByRole('heading',{level:1,name:'Workbench'})
    const main=within(screen.getByRole('main'))
    expect(main.getByRole('button',{name:'View pane API · 请求校验'})).toBeTruthy()
    expect(main.queryByRole('button',{name:'View pane UI · 组件系统'})).toBeNull()
    await userEvent.click(main.getByRole('button',{name:'View pane API · 请求校验'}))
    await screen.findByTestId('terminal-renderer')
    d.view.rerender(<Workbench {...d.props} conversationId="other-conversation"/>)
    await screen.findByText('Not bound',{exact:true})
    expect(screen.queryByTestId('terminal-renderer')).toBeNull()
    await waitFor(()=>expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.terminal.release')).toBe(true))
  }finally{await d.close()}
})
test('create-for-conversation uses one scoped operation and displays its initial pane',async()=>{
  const d=await start('normal','herdr.workspaces');try{
    await screen.findByText('Not bound',{exact:true})
    await userEvent.click(within(screen.getByRole('main')).getByRole('button',{name:'New workspace'}))
    const dialog=within(await screen.findByRole('dialog'))
    await userEvent.type(dialog.getByLabelText('Name',{exact:true}),'Session UI test')
    expect((dialog.getByRole('checkbox') as HTMLInputElement).checked).toBe(true)
    await userEvent.click(dialog.getByRole('button',{name:'New workspace'}))
    await screen.findByRole('heading',{level:1,name:'Session UI test'})
    expect(within(screen.getByRole('main')).getByRole('button',{name:'View pane Shell'})).toBeTruthy()
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.conversation.create')).toHaveLength(1)
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.workspace.create')).toHaveLength(0)
  }finally{await d.close()}
})
test('stale data keeps resources visible but disables pane entry and control',async()=>{
  const d=await start('stale');try{
    const view=await within(screen.getByRole('main')).findByRole('button',{name:'View pane API · 请求校验'})
    expect((view as HTMLButtonElement).disabled).toBe(true)
    expect((screen.getByRole('button',{name:'Control pane API · 请求校验'}) as HTMLButtonElement).disabled).toBe(true)
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')).toHaveLength(0)
  }finally{await d.close()}
})
test('external pane control adopts only that exact pane after explicit confirmation',async()=>{
  const d=await start('external');try{
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button',{name:'Control pane API · 请求校验'}))
    const dialog=within(await screen.findByRole('dialog'))
    expect(dialog.getByText(/only this pane/)).toBeTruthy()
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.resource.adopt')).toBe(false)
    await userEvent.click(dialog.getByRole('button',{name:'Confirm'}))
    await screen.findByTestId('terminal-renderer')
    const adopted=d.request.mock.calls.filter(([r])=>r.operation==='herdr.resource.adopt')
    expect(adopted).toHaveLength(1);expect(adopted[0]![0].input).toMatchObject({ref:{kind:'pane',id:'w1:p1'},confirmed:true})
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'View pane API · 请求校验'}))
    await waitFor(()=>expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')).toHaveLength(2))
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')[1]![0].input).toMatchObject({mode:'observe',confirmed:false})
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.terminal.release')).toBe(true)
  }finally{await d.close()}
})
test('late observation response after navigating away is released, never attached to the next page',async()=>{
  const demo=await createDemo('normal')
  let deliver:(()=>void)|undefined
  const request=vi.fn(async(envelope:Parameters<WorkbenchClient['request']>[0],signal?:AbortSignal)=>{
    const result=await demo.client.request(envelope,signal)
    if(envelope.operation==='herdr.terminal.open')return await new Promise<typeof result>(resolve=>{deliver=()=>resolve(result)})
    return result
  })
  const view=render(<Workbench client={{...demo.client,request:request as WorkbenchClient['request']}} modules={[herdrWeb]} initialRoute="herdr.overview" locale="en"/>)
  try{
    await userEvent.click(await within(screen.getByRole('main')).findByRole('button',{name:'View pane API · 请求校验'}))
    await waitFor(()=>expect(deliver).toBeTypeOf('function'))
    await userEvent.click(within(screen.getByRole('complementary')).getByRole('button',{name:'Workspaces'}))
    await screen.findByRole('heading',{level:1,name:'Workspaces'})
    deliver!()
    await waitFor(()=>expect(request.mock.calls.some(([r])=>r.operation==='herdr.terminal.release')).toBe(true))
    expect(screen.queryByTestId('terminal-renderer')).toBeNull()
  }finally{view.unmount();await demo.dispose()}
})
test('chinese chrome translates the studio title, workbench label, shell kind and attention states',async()=>{
  const demo=await createDemo('normal')
  const view=render(<Workbench client={demo.client} modules={[herdrWeb]} initialRoute="herdr.overview" locale="zh" conversationId="demo-conversation"/>)
  try{
    await screen.findByRole('heading',{level:1,name:'你的 Agent 工作室'})
    const side=screen.getByRole('complementary',{name:'功能导航'})
    expect(side.querySelector('.wb-eyebrow')?.textContent).toBe('工作区工作室')
    expect(side.querySelector('.wb-sidebar-footer')?.textContent).toContain('工作台')
    expect(side.querySelector('.wb-sidebar-footer')?.textContent).not.toContain('Workbench')
    expect(screen.getByTitle('工作台')).toBeTruthy()
    expect(document.querySelector('.wb-studio-kicker')?.textContent?.replace(/\s+/g,' ')).toBe('Herdr / 工作区工作室')
    expect(await screen.findByText('等待介入的事项需要查看原始终端；回合结束只表示一轮结束，不代表任务成功。')).toBeTruthy()
    expect(screen.queryByText(/blocked|done/)).toBeNull()
    expect(screen.getByText('终端 · 空闲')).toBeTruthy()
  }finally{view.unmount();await demo.dispose()}
})

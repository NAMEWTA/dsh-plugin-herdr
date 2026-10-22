import { test, expect, vi } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { userEvent } from '@testing-library/user-event'
import { Workbench } from '@workbench/shell'
import { WorkbenchError, type WorkbenchClient } from '@workbench/contracts'
import { herdrWeb } from '@workbench/herdr/web'
import { createDemo, fixture } from '../../apps/dev-workbench/src/mock.ts'

async function start(scenario='normal') {
  const demo=await createDemo(scenario)
  let rejectInspection=false
  const request=vi.fn(async(envelope:Parameters<WorkbenchClient['request']>[0],signal?:AbortSignal)=>{
    if(rejectInspection&&envelope.operation==='herdr.pane.inspect')throw new WorkbenchError('RESOURCE_CHANGED')
    return demo.client.request(envelope,signal)
  })
  const target=fixture(scenario).panes[0]!.ref
  history.replaceState({},'', '/?wb.route=herdr.inspector&wb.target='+encodeURIComponent(JSON.stringify(target)))
  const view=render(<Workbench client={{...demo.client,request:request as WorkbenchClient['request']}} modules={[herdrWeb]} initialRoute="herdr.inspector" locale="en"/>)
  return {request,view,reject(){rejectInspection=true},async close(){view.unmount();await demo.dispose()}}
}
test('inspector displays real IDs and six copy-only commands without opening a terminal',async()=>{
  const d=await start();try{
    const main=within(screen.getByRole('main'))
    await main.findByRole('button',{name:'Copy command: Pane ID'})
    expect(main.getAllByRole('button',{name:/^Copy command:/})).toHaveLength(6)
    expect(main.getByText('w1:p1',{exact:true})).toBeTruthy()
    expect(main.getByText('/demo/workbench',{exact:true})).toBeTruthy()
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.terminal.open'||r.operation==='herdr.resource.adopt')).toBe(false)
    expect(main.queryByRole('button',{name:'Acquire control'})).toBeNull()
  }finally{await d.close()}
})
test('copy performs a fresh authoritative read before writing the clipboard',async()=>{
  const d=await start();try{
    const button=await screen.findByRole('button',{name:'Copy command: Pane ID'})
    const writeText=vi.fn(async(_value:string)=>{})
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
    const before=d.request.mock.calls.filter(([r])=>r.operation==='herdr.pane.inspect').length
    await userEvent.click(button)
    await waitFor(()=>expect(writeText).toHaveBeenCalledTimes(1))
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.pane.inspect').length).toBeGreaterThan(before)
    expect(writeText.mock.calls[0]![0]).toBe("HERDR_SOCKET_PATH='/demo/herdr.sock' '/demo/herdr' pane get 'w1:p1'")
  }finally{await d.close()}
})
test('clipboard rejection is visible and keeps the command selectable',async()=>{
  const d=await start();try{
    const button=await screen.findByRole('button',{name:'Copy command: Pane ID'})
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}})
    await userEvent.click(button)
    expect(await screen.findByText('Clipboard unavailable. Select and copy the command manually.')).toBeTruthy()
    expect(d.view.container.querySelector('[data-inspector-command="pane"]')?.textContent).toContain("pane get 'w1:p1'")
  }finally{await d.close()}
})
test('a vanished or replaced pane cannot copy commands from the old response',async()=>{
  const d=await start();try{
    const button=await screen.findByRole('button',{name:'Copy command: Pane ID'})
    const writeText=vi.fn(async(_value:string)=>{})
    Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText}})
    d.reject();await userEvent.click(button)
    await screen.findByRole('alert')
    await waitFor(()=>expect(d.view.container.querySelector('[data-inspector-command]')).toBeNull())
    expect(writeText).not.toHaveBeenCalled()
  }finally{await d.close()}
})
test('stale snapshot hides inspection actions rather than presenting cached executable targets',async()=>{
  const d=await start('stale');try{
    await screen.findByText('The data is stale. Refresh and confirm again.')
    expect(screen.queryByRole('button',{name:/^Copy command:/})).toBeNull()
    expect(d.request.mock.calls.some(([r])=>r.operation==='herdr.pane.inspect')).toBe(false)
  }finally{await d.close()}
})

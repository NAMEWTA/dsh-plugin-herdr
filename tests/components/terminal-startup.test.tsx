import {test,expect,vi,afterEach} from 'vitest'
import {render,screen,within,waitFor} from '@testing-library/react'
import {userEvent} from '@testing-library/user-event'
import {Workbench} from '@workbench/shell'
import {herdrWeb,configureTerminalLoader} from '@workbench/herdr/web'
import {RequestError} from '@workbench/ui'
import {createDemo} from '../../apps/dev-workbench/src/mock.ts'
import type {TerminalDriver} from '../../modules/herdr/src/web/terminal/driver.ts'
import type {WorkbenchClient} from '@workbench/contracts'
const disposed=vi.fn(),streamed=vi.fn()
function driver(failOpen=true):TerminalDriver {
  return {Terminal:class {
    options={};parser={registerOscHandler:()=>({dispose(){}})}
    loadAddon(){};open(){if(failOpen)throw Error('canvas initialization failed')}
    onData(){return {dispose(){}}};dispose(){disposed()};getSelection(){return ''}
  },FitAddon:class {fit(){};proposeDimensions(){return {cols:80,rows:24}}}} as unknown as TerminalDriver
}
afterEach(()=>{disposed.mockClear();streamed.mockClear()})
async function start(load:()=>Promise<TerminalDriver>,streamFailure?:Error){
  const demo=await createDemo('normal'),reset=configureTerminalLoader(load)
  const request=vi.fn(demo.client.request.bind(demo.client))
  const client:WorkbenchClient={...demo.client,request:request as WorkbenchClient['request'],async *stream(){streamed();throw streamFailure??Error('test stream closed')}}
  const view=render(<Workbench client={client} modules={[herdrWeb]} initialRoute="herdr.overview" locale="en"/>)
  await screen.findByRole('heading',{name:'Your agent workspace'})
  await userEvent.click(await within(screen.getByRole('main')).findByRole('button',{name:'View pane API · 请求校验'}))
  return {request,view,async close(){view.unmount();reset();await demo.dispose()}}
}
test('renderer failure displays a diagnostic and offers observation-only retry without opening a lease',async()=>{
  let loads=0
  const d=await start(async()=>{loads++;throw Error('private path /secret token=SECRET')})
  try{
    const error=await screen.findByRole('alert');expect(error.textContent).toContain('TERMINAL_RENDERER_UNAVAILABLE')
    expect(error.textContent).not.toMatch(/SECRET|Request ID|internal error/)
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open')).toHaveLength(0)
    await userEvent.click(within(error).getByRole('button',{name:'Retry'}))
    await waitFor(()=>expect(loads).toBe(2))
    expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.open'||r.operation==='herdr.resource.adopt')).toHaveLength(0)
  }finally{await d.close()}
})
test('partial xterm initialization is disposed and its lease released instead of leaking resources',async()=>{
  const d=await start(async()=>driver())
  try{
    await screen.findByText('TERMINAL_INITIALIZATION_FAILED',{exact:true})
    await waitFor(()=>expect(d.request.mock.calls.filter(([r])=>r.operation==='herdr.terminal.release')).toHaveLength(1))
    expect(disposed).toHaveBeenCalledTimes(1);expect(streamed).not.toHaveBeenCalled()
    const open=d.request.mock.calls.find(([r])=>r.operation==='herdr.terminal.open')!
    expect(open[0].input).toMatchObject({mode:'observe',confirmed:false})
  }finally{await d.close()}
  expect(disposed).toHaveBeenCalledTimes(1)
})
test('an authenticated stream error retains its actual request identifier and code',async()=>{
  const d=await start(async()=>driver(false),new RequestError('AUTH_REQUIRED','real-request-123'))
  try{const alert=await screen.findByRole('alert');expect(alert.textContent).toContain('real-request-123');expect(alert.textContent).toContain('Authentication expired');expect(alert.textContent).not.toContain('terminal-stream')}
  finally{await d.close()}
})

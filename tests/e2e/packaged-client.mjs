import {build} from 'tsdown'
import {execFileSync} from 'node:child_process'
import {createServer} from 'node:http'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
import {chromium} from 'playwright'
const legacy=process.argv.includes('--expect-legacy-failure')
const out=resolve('.evidence/packaged-client'+(legacy?'-before':''));await mkdir(out,{recursive:true})
await build({config:false,entry:{host:'tests/e2e/packaged-client-host.tsx'},outDir:out,platform:'browser',format:['iife'],dts:false,minify:true,jsx:'automatic',target:'es2022',outputOptions:{codeSplitting:false},deps:{alwaysBundle:[/.*/]},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'})
const host=await readFile(resolve(out,'host.iife.js')),client=process.argv[2]?execFileSync('tar',['-xOf',resolve(process.argv[2]),'package/lib/client.js']):await readFile('apps/dsh-plugin/lib/client.js')
const legacyRequests=[],errors=[]
const server=createServer((req,res)=>{
  if(req.url?.startsWith('/_workbench/')){legacyRequests.push(req.url);res.writeHead(404);res.end('No private root route');return}
  if(req.url==='/host.js'||req.url==='/client.js'){res.setHeader('Content-Type','text/javascript');res.end(req.url==='/host.js'?host:client);return}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>Packaged terminal regression fixture</title></head><body style="margin:0;height:100vh"><div id="root" style="height:100%"></div><script src="/host.js"></script></body></html>')
})
await new Promise(done=>server.listen(0,'127.0.0.1',done))
let browser,page
try{
  browser=await chromium.launch({headless:true,...process.env.PLAYWRIGHT_EXECUTABLE_PATH?{executablePath:process.env.PLAYWRIGHT_EXECUTABLE_PATH}:{},args:['--no-sandbox']})
  page=await browser.newPage({viewport:{width:1280,height:900}});page.on('pageerror',e=>errors.push(e.message))
  await page.goto(`http://127.0.0.1:${server.address().port}/proxy/dsh/`)
  await page.waitForFunction(()=>!!window.__ModuleLoader__);await page.addScriptTag({url:'/client.js'})
  await page.getByRole('heading',{name:'你的 Agent 工作室',exact:true}).waitFor()
  await page.locator('.wb-page').getByRole('button',{name:'查看面板 API · 请求校验',exact:true}).click()
  // Old 1.0.1 fails here: root-relative dynamic import rejects before any lease request.
  await page.waitForFunction(()=>document.querySelector('[data-wb-terminal][data-ready="true"]')||document.querySelector('.wb-page [role="alert"]'))
  await page.screenshot({path:resolve(out,'terminal.png'),fullPage:true})
  const operations=await page.evaluate(()=>window.terminalOperations)
  const alerts=await page.locator('.wb-page [role="alert"]').allTextContents()
  await writeFile(resolve(out,'result.json'),JSON.stringify({legacyRequests,alerts,errors,operations:operations.filter(x=>x.operation.startsWith('herdr.terminal')).map(x=>({operation:x.operation,mode:x.input.mode}))},null,2))
  if(legacy){
    assert.equal(legacyRequests.length,1);assert.ok(legacyRequests[0].endsWith('/terminal.js'))
    assert.equal(alerts.length,1);assert.ok(alerts[0].includes('发生内部错误，请保留请求编号用于诊断。'))
    assert.equal(operations.filter(x=>x.operation==='herdr.terminal.open').length,0)
    console.log('Confirmed 1.0.1 renderer failure before any terminal lease request');
  }else{
  assert.deepEqual(alerts,[],'Terminal initialization must not become a generic internal error')
  await page.getByText('观察中 · 不接收输入',{exact:true}).waitFor()
  assert.equal(operations.filter(x=>x.operation==='herdr.terminal.open').length,1)
  assert.equal(operations.find(x=>x.operation==='herdr.terminal.open').input.mode,'observe')
  assert.deepEqual(legacyRequests,[],'Published plugin must not require a separately proxied root asset route')
  assert.deepEqual(errors,[])
  console.log('Packaged-client terminal startup passed without private root asset route')
  }
}finally{await browser?.close();await new Promise(done=>server.close(done))}

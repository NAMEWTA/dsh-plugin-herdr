import {chromium} from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import {spawn} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {setTimeout as delay} from 'node:timers/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const out=resolve('.evidence/inspector'),errors=[],checks=[]
await mkdir(out,{recursive:true})
let server,browser,log=''
try {
  server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','apps/dev-workbench/vite.config.ts','--port','5184'],{stdio:['ignore','pipe','pipe']})
  server.stdout.on('data',b=>{log=(log+b).slice(-8192)});server.stderr.on('data',b=>{log=(log+b).slice(-8192)})
  let ready=false
  for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5184')).ok){ready=true;break}}catch{}await delay(100)}
  assert.ok(ready,log)
  browser=await chromium.launch({headless:true,args:['--no-sandbox']})
  for(const width of [375,1280])for(const theme of ['light','dark']){
    const context=await browser.newContext({viewport:{width,height:1000},reducedMotion:'reduce'})
    await context.addInitScript(theme=>localStorage.setItem('namewta.workbench.preferences.v1',JSON.stringify({version:1,locale:'en',theme,density:'comfortable'})),theme)
    const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message))
    await page.goto('http://127.0.0.1:5184/?lang=en&scenario=external&wb.route=herdr.inspector')
    await page.getByLabel('Select a pane',{exact:true}).selectOption({index:1})
    await page.locator('[data-inspector-command="pane"]').waitFor()
    assert.equal(await page.locator('[data-inspector-command]').count(),6)
    assert.equal(await page.locator('[data-wb-terminal]').count(),0)
    const main=page.locator('.wb-main')
    assert.ok(await main.evaluate(e=>e.scrollWidth-e.clientWidth)<=1,'Inspector horizontal overflow')
    const report=await new AxeBuilder({page}).include('.wb-root').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze()
    await writeFile(resolve(out,`${width}-${theme}-axe.json`),JSON.stringify(report,null,2))
    await page.screenshot({path:resolve(out,`${width}-${theme}.png`),fullPage:true})
    assert.deepEqual(report.violations,[],'Inspector accessibility violations')
    await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw Error('denied')}}}))
    await page.getByRole('button',{name:'Copy command: Pane ID',exact:true}).click()
    await page.getByText('Clipboard unavailable. Select and copy the command manually.',{exact:true}).waitFor()
    checks.push(`${width}-${theme}: metadata, six read-only commands, accessibility and clipboard denial`)
    await context.close()
  }
  const page=await browser.newPage()
  await page.goto('http://127.0.0.1:5184/?lang=en&scenario=stale&wb.route=herdr.inspector')
  await page.getByLabel('Select a pane',{exact:true}).selectOption({index:1})
  await page.getByText('The data is stale. Refresh and confirm again.',{exact:true}).waitFor()
  assert.equal(await page.locator('[data-inspector-command]').count(),0)
  checks.push('stale snapshots do not expose executable targets');await page.close()
  assert.deepEqual(errors,[])
  console.log('Inspector browser checks passed:',checks.length)
} finally {
  await writeFile(resolve(out,'results.json'),JSON.stringify({checks,errors},null,2))
  await browser?.close();server?.kill('SIGTERM')
}

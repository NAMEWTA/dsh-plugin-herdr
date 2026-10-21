import {chromium} from 'playwright'
import AxeBuilder from '@axe-core/playwright'
import {build} from 'tsdown'
import {readFile,mkdir,writeFile} from 'node:fs/promises'
import {spawn} from 'node:child_process'
import {setTimeout as delay} from 'node:timers/promises'
import {resolve} from 'node:path'
import assert from 'node:assert/strict'
const offline=process.argv.includes('--offline'),out=resolve('.evidence/browser')
await mkdir(out,{recursive:true})
let server,browser,htmlScript,css
const results=[],errors=[]
try{
 if(offline){
   await build({config:false,entry:{fixture:'tests/e2e/offline-entry.tsx'},outDir:'.evidence/offline',platform:'browser',format:['iife'],dts:false,clean:true,minify:true,jsx:'automatic',target:'es2022',outputOptions:{codeSplitting:false},deps:{alwaysBundle:[/.*/]},define:{'process.env.NODE_ENV':'"production"'},logLevel:'error'})
   htmlScript=await readFile('.evidence/offline/fixture.iife.js','utf8').catch(()=>readFile('.evidence/offline/fixture.js','utf8'));css=await readFile('.evidence/workbench-scoped.css','utf8')
 }else{
   server=spawn(process.execPath,['node_modules/vite/bin/vite.js','--config','apps/dev-workbench/vite.config.ts','--port','5183'],{stdio:['ignore','pipe','pipe']})
   let log='';server.stdout.on('data',b=>log=(log+b).slice(-10000));server.stderr.on('data',b=>log=(log+b).slice(-10000))
   let ready=false;for(let i=0;i<100;i++){try{if((await fetch('http://127.0.0.1:5183')).ok){ready=true;break}}catch{}await delay(100)}assert.ok(ready,'Vite did not start: '+log)
 }
 browser=await chromium.launch({headless:true,...process.env.WB_BROWSER_PATH?{executablePath:process.env.WB_BROWSER_PATH}:{},args:['--no-sandbox']})
 async function open(scenario='normal',route='herdr.overview',width=1280){
   const context=await browser.newContext({viewport:{width,height:900},reducedMotion:'reduce'}),page=await context.newPage()
   page.on('pageerror',e=>errors.push(e.message))
   if(offline){await page.setContent('<!doctype html><html lang="en"><head><title>Workbench component evidence</title></head><body style="margin:0;height:100vh"><div id="root" style="height:100vh"></div></body></html>');await page.addStyleTag({content:css});await page.evaluate(options=>{window.fixtureOptions=options},{scenario,route});await page.addScriptTag({content:htmlScript})}
   else await page.goto('http://127.0.0.1:5183/?lang=en&scenario='+scenario+'&wb.route='+route,{waitUntil:'domcontentloaded'})
   await page.locator('.wb-root').waitFor();return page
 }
 async function go(page,name){if(!await page.locator('.wb-sidebar').isVisible())await page.locator('.wb-topbar').getByRole('button',{name:'Modules',exact:true}).click();await page.locator('.wb-sidebar').getByRole('button',{name,exact:true}).click()}
 async function audit(page,name){const report=await new AxeBuilder({page}).include('.wb-root').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await writeFile(resolve(out,name+'-axe.json'),JSON.stringify(report,null,2));assert.deepEqual(report.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)})),[],name+' accessibility violations')}
 for(const width of [375,768,1280,1920])for(const theme of ['light','dark'])for(const density of ['comfortable','compact']){
   const page=await open('normal','platform.settings',width),name=`${width}-${theme}-${density}`
   await page.getByLabel('Theme',{exact:true}).selectOption(theme);await page.getByLabel('Density',{exact:true}).selectOption(density);await go(page,'Overview');await page.getByRole('heading',{name:'Operations overview',exact:true}).waitFor();await page.getByText('API · 请求校验',{exact:true}).waitFor()
   const overflow=await page.locator('.wb-main').evaluate(el=>el.scrollWidth-el.clientWidth);assert.ok(overflow<=1,name+' horizontal overflow '+overflow)
   await audit(page,name);await page.screenshot({path:resolve(out,name+'.png'),fullPage:true});results.push({case:name,passed:true});await page.close()
 }
 for(const scenario of ['empty','stale','offline','unsupported','forbidden','large','loading']){
   const page=await open(scenario,scenario==='large'?'herdr.agents':'herdr.overview')
   await page.getByRole('heading',{level:1}).waitFor()
   if(scenario==='large'){await page.getByRole('table').waitFor();assert.ok(await page.getByRole('row').count()<=51);await page.getByRole('button',{name:'Next page'}).click();assert.ok(await page.getByRole('row').count()<=51)}
   else if(scenario==='empty')await page.getByText('No workspaces yet',{exact:true}).waitFor()
   else if(scenario==='forbidden')await page.getByRole('alert').waitFor()
   else if(scenario==='loading')await page.getByLabel('Loading…').waitFor()
   else await page.getByText('API · 请求校验',{exact:true}).waitFor()
   await audit(page,scenario);await page.screenshot({path:resolve(out,scenario+'.png'),fullPage:true});results.push({case:scenario,passed:true});await page.close()
 }
 const page=await open('normal','herdr.workspaces')
 await page.getByText('Not bound',{exact:true}).waitFor()
 const trigger=page.getByRole('button',{name:'New workspace',exact:true});await trigger.click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Dialog must restore focus')
 await page.keyboard.press('Control+k');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});results.push({case:'dialog-focus-and-keyboard',passed:true})
 await go(page,'Notes');await page.getByRole('heading',{level:1}).waitFor();await audit(page,'second-module');results.push({case:'second-module',passed:true});await page.close()
 assert.deepEqual(errors,[],'Unhandled browser exceptions')
 await writeFile(resolve(out,'results.json'),JSON.stringify({mode:offline?'offline component rendering; no HTTP/gateway verification':'HTTP fixture browser',results,errors},null,2))
 console.log('Browser checks passed:',results.length,offline?'offline component mode':'HTTP fixture mode')
}finally{await browser?.close();server?.kill('SIGTERM')}

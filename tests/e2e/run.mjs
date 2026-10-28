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
const results=[],errors=[],accessibilityFailures=[]
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
 async function go(page,name){
   const section=['Appearance','Modules','Audit log'].includes(name)?'Workbench settings':name==='Notes'?'Example notes':'Herdr'
   const rail=page.locator('.wb-rail').getByRole('button',{name:section,exact:true})
   if(await rail.getAttribute('aria-expanded')!=='true')await rail.click()
   await page.locator('.wb-sidebar:visible').getByRole('button',{name,exact:true}).click()
 }
 async function audit(page,name){const report=await new AxeBuilder({page}).include('.wb-root').withTags(['wcag2a','wcag2aa','wcag21aa']).analyze();await writeFile(resolve(out,name+'-axe.json'),JSON.stringify(report,null,2));if(report.violations.length)accessibilityFailures.push({case:name,violations:report.violations.map(v=>({id:v.id,nodes:v.nodes.map(n=>n.target)}))})}
 for(const width of [375,768,1280,1920])for(const theme of ['light','dark'])for(const density of ['comfortable','compact']){
   const page=await open('normal','platform.settings',width),name=`${width}-${theme}-${density}`
   await page.getByLabel('Theme',{exact:true}).selectOption(theme);await page.getByLabel('Density',{exact:true}).selectOption(density);await go(page,'Overview');await page.getByRole('heading',{name:'Your agent workspace',exact:true}).waitFor();await page.locator('.wb-page').getByRole('button',{name:'View pane API · 请求校验',exact:true}).waitFor()
   const overflow=await page.locator('.wb-main').evaluate(el=>el.scrollWidth-el.clientWidth);assert.ok(overflow<=1,name+' horizontal overflow '+overflow)
   await audit(page,name);await page.screenshot({path:resolve(out,name+'.png'),fullPage:true});results.push({case:name,passed:true});await page.close()
 }
 for(const scenario of ['empty','stale','offline','unsupported','forbidden','large','loading']){
   const page=await open(scenario,scenario==='large'?'herdr.agents':'herdr.overview')
   await page.getByRole('heading',{level:1}).waitFor()
   if(scenario==='large'){await page.getByRole('table').waitFor();assert.ok(await page.getByRole('row').count()<=51);await page.getByRole('button',{name:'Next page'}).click();assert.ok(await page.getByRole('row').count()<=51)}
   else if(scenario==='empty')await page.getByText('No workspaces yet',{exact:true}).waitFor()
   else if(scenario==='forbidden')await page.getByRole('alert').first().waitFor()
   else if(scenario==='loading')await page.getByLabel('Loading…').first().waitFor()
   else await page.locator('.wb-page').getByRole('button',{name:'View pane API · 请求校验',exact:true}).waitFor()
   await audit(page,scenario);await page.screenshot({path:resolve(out,scenario+'.png'),fullPage:true});results.push({case:scenario,passed:true});await page.close()
 }
 const page=await open('normal','herdr.workspaces')
 await page.getByText('Not bound',{exact:true}).waitFor()
 const trigger=page.getByRole('button',{name:'New workspace',exact:true});await trigger.click();const dialog=page.getByRole('dialog');await dialog.waitFor();await page.keyboard.press('Escape');await dialog.waitFor({state:'hidden'});assert.equal(await trigger.evaluate(el=>el===document.activeElement),true,'Dialog must restore focus')
 await page.keyboard.press('Control+k');await page.getByRole('dialog').waitFor();await page.keyboard.press('Escape');await page.getByRole('dialog').waitFor({state:'hidden'});results.push({case:'dialog-focus-and-keyboard',passed:true})
 await go(page,'Notes');await page.getByRole('heading',{level:1}).waitFor();await audit(page,'second-module');results.push({case:'second-module',passed:true});await page.close()
 // The new navigation must disclose a module without navigating the current page.
 const desktop=await open('bound','herdr.workspaces')
 await desktop.getByRole('heading',{level:1,name:'Workbench',exact:true}).waitFor()
 const tree=desktop.getByRole('navigation',{name:'Workspaces and panes',exact:true})
 await tree.getByRole('button',{name:'View pane API · 请求校验',exact:true}).click()
 await desktop.locator('[data-wb-terminal][data-ready="true"]').waitFor()
 await desktop.getByText('Observing · Input disabled',{exact:true}).waitFor()
 assert.equal(await desktop.getByRole('dialog').count(),0,'Viewing must not require a control confirmation')
 await desktop.screenshot({path:resolve(out,'session-pane-readonly.png'),fullPage:true})
 await audit(desktop,'session-pane-readonly');results.push({case:'bound-session-direct-readonly-pane',passed:true})
 await desktop.getByRole('button',{name:'Acquire control',exact:true}).click()
 await desktop.getByRole('dialog').waitFor();await desktop.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click()
 await desktop.getByText('Observing · Input disabled',{exact:true}).waitFor();results.push({case:'control-confirmation-cancel-retains-observation',passed:true})
 const currentTitle=await desktop.getByRole('heading',{level:1}).textContent()
 await desktop.locator('.wb-rail').getByRole('button',{name:'Workbench settings',exact:true}).click()
 assert.equal(await desktop.getByRole('heading',{level:1}).textContent(),currentTitle)
 await desktop.locator('.wb-sidebar').getByRole('button',{name:'Audit log',exact:true}).waitFor()
 await desktop.locator('.wb-rail').getByRole('button',{name:'Herdr',exact:true}).click()
 assert.equal(await desktop.locator('.wb-sidebar').getByRole('button',{name:'Audit log',exact:true}).count(),0)
 results.push({case:'module-disclosure-and-administration-separation',passed:true});await desktop.close()
 // Regression #26: direct sibling workspace navigation must not retain the previous tab.
 const switching=await open('normal','herdr.workspaces')
 const workspaceTree=switching.getByRole('navigation',{name:'Workspaces and panes',exact:true})
 await workspaceTree.getByRole('button',{name:'Workbench',exact:true}).click()
 await switching.locator('.wb-page').getByRole('button',{name:'Main',exact:true}).click()
 await workspaceTree.getByRole('button',{name:'服务端控制面',exact:true}).click()
 await switching.getByRole('heading',{level:1,name:'服务端控制面',exact:true}).waitFor()
 await switching.locator('.wb-page').getByRole('button',{name:'View pane UI · 组件系统',exact:true}).waitFor()
 assert.equal(await switching.locator('.wb-page').getByRole('button',{name:'All',exact:true}).getAttribute('aria-pressed'),'true')
 await switching.locator('.wb-page').getByRole('button',{name:'Main',exact:true}).click()
 await workspaceTree.getByRole('button',{name:'Workbench',exact:true}).click()
 await switching.locator('.wb-page').getByRole('button',{name:'View pane API · 请求校验',exact:true}).waitFor()
 assert.equal(await switching.locator('.wb-page').getByRole('button',{name:'All',exact:true}).getAttribute('aria-pressed'),'true')
 await switching.screenshot({path:resolve(out,'workspace-switch-resets-filter.png'),fullPage:true})
 results.push({case:'workspace-switch-resets-filter-both-directions',passed:true});await switching.close()
 // Regression #27: show both management adoption and controller revocation before takeover.
 const external=await open('external','herdr.overview')
 await external.locator('.wb-page').getByRole('button',{name:'View pane API · 请求校验',exact:true}).click()
 await external.locator('[data-wb-terminal][data-ready="true"]').waitFor()
 await external.getByRole('button',{name:'Take over control',exact:true}).click()
 const takeover=external.getByRole('dialog')
 await takeover.getByText(/adopt only this pane.*old window loses its control lease/).waitFor()
 await external.screenshot({path:resolve(out,'external-takeover-consequences.png'),fullPage:true})
 await takeover.getByRole('button',{name:'Cancel',exact:true}).click()
 await external.getByText('Observing · Input disabled',{exact:true}).waitFor()
 await external.getByRole('button',{name:'Take over control',exact:true}).click()
 await takeover.getByText(/adopt only this pane.*old window loses its control lease/).waitFor()
 await takeover.getByRole('button',{name:'Confirm',exact:true}).click()
 await external.getByText('Controlling · Live terminal input',{exact:true}).waitFor()
 results.push({case:'external-takeover-consequences-cancel-and-confirm',passed:true});await external.close()
 const mobile=await open('normal','herdr.overview',375)
 await mobile.getByRole('heading',{level:1,name:'Your agent workspace'}).waitFor()
 const entry=mobile.locator('.wb-rail').getByRole('button',{name:'Herdr',exact:true})
 await entry.click();await mobile.getByRole('dialog',{name:'Feature navigation'}).waitFor()
 await mobile.locator('.wb-sidebar').getByRole('button',{name:'Expand workspace Workbench',exact:true}).click()
 await mobile.getByRole('navigation',{name:'Workspaces and panes'}).getByRole('button',{name:'View pane API · 请求校验',exact:true}).waitFor()
 await audit(mobile,'mobile-navigation');await mobile.screenshot({path:resolve(out,'mobile-navigation.png'),fullPage:true})
 await mobile.keyboard.press('Escape');await mobile.getByRole('dialog').waitFor({state:'hidden'})
 assert.equal(await entry.evaluate(el=>el===document.activeElement),true,'Navigation drawer restores module trigger focus')
 results.push({case:'mobile-secondary-menu-focus-and-escape',passed:true});await mobile.close()
 assert.deepEqual(accessibilityFailures,[],'Accessibility violations across tested layouts')
 assert.deepEqual(errors,[],'Unhandled browser exceptions')
 await writeFile(resolve(out,'results.json'),JSON.stringify({mode:offline?'offline component rendering; no HTTP/gateway verification':'HTTP fixture browser',results,errors},null,2))
 console.log('Browser checks passed:',results.length,offline?'offline component mode':'HTTP fixture mode')
}finally{await writeFile(resolve(out,'results.json'),JSON.stringify({mode:offline?'offline component rendering; no HTTP/gateway verification':'HTTP fixture browser',results,errors,accessibilityFailures},null,2));await browser?.close();server?.kill('SIGTERM')}

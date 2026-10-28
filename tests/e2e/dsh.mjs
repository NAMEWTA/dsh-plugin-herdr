// Exercise the actual published DSH CLI and FINAL tarball in an isolated home.
// Only a dummy localhost-fixture key is supplied; no external model or existing profile is used.
import assert from 'node:assert/strict'
import {execFileSync,spawn} from 'node:child_process'
import {mkdtemp,mkdir,writeFile,rm,readFile} from 'node:fs/promises'
import {createServer} from 'node:net'
import {tmpdir} from 'node:os'
import {join,resolve} from 'node:path'
import {setTimeout as delay} from 'node:timers/promises'
import {chromium} from 'playwright'
import {readWebStartupUrl,redactLaunchTokens} from './startup-utils.mjs'
import {refuseWebsocket} from './gateway-probe.mjs'
import {startLocalModel,FIXTURE_KEY} from './local-model.mjs'
import {exerciseNativeWorkspace} from './native-workspace.mjs'
const [cliArg,archiveArg]=process.argv.slice(2)
assert.ok(cliArg&&archiveArg,'Usage: node tests/e2e/dsh.mjs <dsh/bin.js> <final-package.tgz>')
const cli=resolve(cliArg),archive=resolve(archiveArg),binary=process.env.HERDR_TEST_BINARY
assert.ok(binary&&binary.startsWith('/'),'HERDR_TEST_BINARY must name the pinned executable; no silent skips')
const out=resolve('.evidence/dsh'),home=await mkdtemp(join(tmpdir(),'wb-dsh-'))
await mkdir(out,{recursive:true});const paths={HOME:home,DSH_HOME:join(home,'dsh'),XDG_CONFIG_HOME:join(home,'config'),XDG_RUNTIME_DIR:join(home,'run'),XDG_DATA_HOME:join(home,'data'),XDG_STATE_HOME:join(home,'state'),XDG_CACHE_HOME:join(home,'cache')}
for(const path of Object.values(paths))await mkdir(path,{recursive:true,mode:0o700})
const socket=join(home,'herdr.sock'),env={...process.env,...paths,CI:'1',TERM:'xterm-256color',SHELL:'/bin/sh',HERDR_SOCKET_PATH:socket,HERDR_SESSION:'default',WORKBENCH_HERDR_SOCKET:socket,WORKBENCH_HERDR_BINARY:binary}
let daemon,host,browser,page,context,model,hostLog='',daemonLog='',failure
const errors=[],checks=[],legacyAssetRequests=[],diagnostics=[],defaultWorkspaceWarnings=[],packageName='@namewta/dsh-workbench'
const clean=value=>redactLaunchTokens(String(value)).replaceAll(home,'[isolated-home]')
function command(args){try{return execFileSync(process.execPath,[cli,...args],{env,cwd:home,encoding:'utf8',timeout:180000,maxBuffer:8*1024*1024})}catch(e){throw new Error(clean(String(e.stdout??'')+String(e.stderr??'')+e.message))}}
async function stop(child){if(!child||child.exitCode!==null||child.signalCode)return;const exited=new Promise(done=>child.once('exit',done));child.kill('SIGTERM');await Promise.race([exited,delay(4000)]);if(child.exitCode===null&&!child.signalCode){child.kill('SIGKILL');await exited}}
async function record(name){checks.push(name);console.log('PASS',name)}
async function nav(p,name){
 const section=['Appearance','Modules','Audit log'].includes(name)?'Workbench settings':'Herdr'
 const rail=p.locator('.wb-rail').getByRole('button',{name:section,exact:true})
 if(await rail.getAttribute('aria-expanded')!=='true')await rail.click()
 await p.locator('.wb-sidebar:visible').getByRole('button',{name,exact:true}).click()
}
async function enter(p,url,first){
 p.on('pageerror',error=>errors.push(error.message))
 p.on('console',message=>{if(['warning','error'].includes(message.type())&&diagnostics.length<200)diagnostics.push({type:message.type(),text:clean(message.text()).slice(0,2000)})})
 const address=url=>{try{const parsed=new URL(url);return parsed.origin+parsed.pathname}catch{return '[invalid-url]'}}
 p.on('requestfailed',request=>{if(diagnostics.length<200)diagnostics.push({type:'requestfailed',url:address(request.url()),error:request.failure()?.errorText})})
 p.on('response',response=>{if(response.status()>=400&&diagnostics.length<200)diagnostics.push({type:'http',url:address(response.url()),status:response.status()})})
 // Observe the specific host warning without dismissing it or modifying host state.
 await p.exposeFunction('recordDefaultWorkspaceWarning',()=>{defaultWorkspaceWarnings.push('DSH default workspace initialization failed; explicit native picker recovery is tested separately')})
 await p.addInitScript(()=>{let seen=false;const scan=()=>{if(!seen&&document.body?.textContent?.includes('Unable to create default workspace. Use Choose workspace to select a folder.')){seen=true;void window.recordDefaultWorkspaceWarning()}};new MutationObserver(scan).observe(document,{subtree:true,childList:true,characterData:true})})
await p.goto(url,{waitUntil:'domcontentloaded',timeout:60000});const icon=p.locator('[data-workbench-entry]').first();await icon.waitFor({state:'attached',timeout:60000});if(first){const notice=p.getByRole('dialog',{name:'Preview Notice',exact:true});await notice.getByRole('button',{name:'Continue',exact:true}).click({timeout:30000});await notice.waitFor({state:'hidden'})}
  // The disposable host discovers the dummy key from its launch environment. No real credential UI is filled.
  await icon.locator('xpath=ancestor::*[self::button or @role="button" or @role="tab"][1]').click();await p.locator('.wb-root').waitFor({timeout:30000});await p.getByRole('heading',{name:'Your agent workspace',exact:true}).waitFor({timeout:30000})}
async function confirm(p){await p.getByRole('dialog').getByRole('button',{name:'Confirm',exact:true}).click()}
async function terminalReady(p){await p.locator('[data-wb-terminal][data-ready="true"]').waitFor({timeout:30000})}
try{
 model=await startLocalModel();Object.assign(env,{DEEPSEEK_API_KEY:FIXTURE_KEY,DEEPSEEK_BASE_URL:model.baseURL,DSH_TELEMETRY_DISABLED:'1'})
 // Diagnose the native host's documented Linux Documents prerequisite; never fabricate xdg-user-dir or suppress its toast.
 try{const documents=execFileSync('xdg-user-dir',['DOCUMENTS'],{env,cwd:home,encoding:'utf8',timeout:10000}).trim();diagnostics.push({type:'documents-lookup',result:clean(documents),disabled:documents===home||documents===''})}catch(error){diagnostics.push({type:'documents-lookup',error:clean(error.message).slice(0,2000)})}
 const version=command(['--version']).trim();assert.match(version,/0\.2\.1-rc\.2/);assert.match(execFileSync(binary,['--version'],{encoding:'utf8'}),/0\.9\.3/)
 daemon=spawn(binary,['server'],{env,cwd:home,stdio:['ignore','pipe','pipe']});daemon.stdout.on('data',b=>daemonLog=(daemonLog+b).slice(-65536));daemon.stderr.on('data',b=>daemonLog=(daemonLog+b).slice(-65536))
 let daemonReady=false;for(let i=0;i<100;i++){try{execFileSync(binary,['api','snapshot'],{env,cwd:home,stdio:'pipe',timeout:2000});daemonReady=true;break}catch{await delay(100)}}assert.ok(daemonReady,'Disposable Herdr server did not start: '+daemonLog)
 await writeFile(join(out,'install.log'),clean(command(['plugin','--profile','web','add',archive])));assert.ok(command(['plugin','--profile','web','list']).includes(packageName));await record('final tarball install/list')
 const probe=createServer();await new Promise(done=>probe.listen(0,'127.0.0.1',done));const port=probe.address().port;await new Promise(done=>probe.close(done));const origin=`http://127.0.0.1:${port}`
 host=spawn(process.execPath,[cli,'web','--no-open','--port',String(port)],{env,cwd:home,stdio:['ignore','pipe','pipe']});host.stdout.on('data',b=>hostLog=(hostLog+b).slice(-2*1024*1024));host.stderr.on('data',b=>hostLog=(hostLog+b).slice(-2*1024*1024));let launch
 for(let i=0;i<120;i++){if(host.exitCode!==null)throw Error('DSH exited: '+clean(hostLog));launch=readWebStartupUrl(hostLog,origin);if(launch){try{const response=await fetch(launch,{redirect:'manual',signal:AbortSignal.timeout(2000)});if(response.ok||[302,303,307,308].includes(response.status))break}catch{}}await delay(500)}assert.ok(launch,'Authenticated DSH launch URL missing')
 const token=new URL(launch).searchParams.get('token');if(process.env.GITHUB_ACTIONS==='true'&&token)console.log('::add-mask::'+token)
 browser=await chromium.launch({headless:true,args:['--no-sandbox']});context=await browser.newContext({viewport:{width:1440,height:1000},locale:'en-US'});await context.route('**/_workbench/assets/**',route=>{legacyAssetRequests.push(route.request().url());return route.fulfill({status:404,body:'No private root asset route'})});page=await context.newPage();await enter(page,launch,true)
 await page.getByText('No workspaces yet',{exact:true}).waitFor({timeout:30000});await record('real DSH module factory, Remote arity and authenticated snapshot')
 const bodyCss=await page.locator('body').evaluate(e=>({font:getComputedStyle(e).fontFamily,color:getComputedStyle(e).color}));await nav(page,'Appearance');await page.getByLabel('Theme',{exact:true}).selectOption('dark');assert.deepEqual(await page.locator('body').evaluate(e=>({font:getComputedStyle(e).fontFamily,color:getComputedStyle(e).color})),bodyCss);await record('scoped theme does not mutate host body styles')
 await nav(page,'Herdr connection');await page.getByText('0.9.3',{exact:true}).first().waitFor({timeout:30000});await page.getByText('22',{exact:true}).first().waitFor();await page.screenshot({path:join(out,'environment.png'),fullPage:true});await record('real CLI, daemon, protocol and streaming environment')
 await nav(page,'Workspaces');await page.getByRole('button',{name:'New workspace',exact:true}).click();await page.getByRole('dialog').getByLabel('Name',{exact:true}).fill('Browser acceptance');await page.getByRole('dialog').getByRole('button',{name:'New workspace',exact:true}).click();await page.getByRole('heading',{level:1,name:'Browser acceptance',exact:true}).waitFor({timeout:30000});await record('real resource creation and owned workspace details')
 // The inspector is reached through the new workspace cards, without restoring legacy panels.
 await nav(page,'Overview');await page.locator('.wb-page').getByRole('button',{name:/^Inspect pane /}).first().click()
 await page.locator('[data-pane-inspector]').waitFor({timeout:30000})
 assert.equal(await page.locator('[data-inspector-command]').count(),6)
 const inspectionCommand=await page.locator('[data-inspector-command="pane"]').innerText()
 assert.ok(inspectionCommand.includes(socket));assert.ok(inspectionCommand.includes(binary));assert.ok(!inspectionCommand.includes('--session'))
 assert.equal(await page.locator('[data-wb-terminal]').count(),0,'Inspector must not acquire a terminal lease')
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('intentional clipboard denial')}}}))
 await page.getByRole('button',{name:'Copy command: Pane ID',exact:true}).click()
 await page.getByText('Clipboard unavailable. Select and copy the command manually.',{exact:true}).waitFor()
 await page.screenshot({path:join(out,'pane-inspector.png'),fullPage:true})
 await record('real pane inspector uses actual socket/binary and handles clipboard denial without execution')
 await page.getByRole('button',{name:'Open workspace',exact:true}).click()
 await page.locator('.wb-page').getByRole('button',{name:/^View pane /}).first().click();await terminalReady(page);await page.getByText('Observing · Input disabled',{exact:true}).waitFor();assert.deepEqual(legacyAssetRequests,[]);await record('in-bundle xterm and full-frame observer without a private root asset route; no implicit controller')
 await page.getByRole('button',{name:'Acquire control',exact:true}).click();await confirm(page);await terminalReady(page);await page.getByText('Controlling · Live terminal input',{exact:true}).waitFor();const input=page.locator('.xterm-helper-textarea');await input.focus();await page.keyboard.type("printf 'WB_BROWSER_CONTROL\\n'");await page.keyboard.press('Enter');await page.locator('.xterm-accessibility-tree').getByText('WB_BROWSER_CONTROL',{exact:true}).waitFor({timeout:30000});await record('real input, stream uplink, ACK and terminal rendering')
 await page.screenshot({path:join(out,'terminal.png'),fullPage:true})
 const second=await context.newPage();await enter(second,origin,false);await nav(second,'Workspaces');await second.locator('.wb-page').getByRole('button',{name:/^View pane /}).first().click();await terminalReady(second);await second.getByText('Observing · Input disabled',{exact:true}).waitFor();await second.getByRole('button',{name:'Acquire control',exact:true}).click();await confirm(second);await second.getByText('The terminal has a controller. Explicit takeover is required.',{exact:true}).waitFor({timeout:30000});await record('two browser clients refuse implicit control takeover')
 await second.getByRole('button',{name:'Take over control',exact:true}).click();await confirm(second);await terminalReady(second);await page.locator('[data-wb-terminal]').waitFor({state:'detached',timeout:30000});await second.getByRole('button',{name:'Stop observing / release control',exact:true}).click();await second.locator('[data-wb-terminal]').waitFor({state:'detached'});await record('explicit takeover revokes old browser and release preserves workspace')
 await second.close()
 await exerciseNativeWorkspace(page,{home,out,model,record})
 const wsUrl=origin.replace('http:','ws:')+'/api/remote.mux';await refuseWebsocket(wsUrl,{Origin:origin});const cookie=(await context.cookies(origin)).map(c=>c.name+'='+c.value).join('; ');assert.ok(cookie);await refuseWebsocket(wsUrl,{Origin:'https://untrusted.invalid',Cookie:cookie});await record('actual gateway rejects anonymous and foreign-Origin WebSocket upgrades')
 await nav(page,'Overview');await page.screenshot({path:join(out,'overview.png'),fullPage:true});assert.deepEqual(errors,[],'Unhandled real-browser errors')
 await browser.close();browser=null;await stop(host);await writeFile(join(out,'remove.log'),clean(command(['plugin','--profile','web','remove',packageName])));assert.ok(!command(['plugin','--profile','web','list']).includes(packageName));assert.equal(daemon.exitCode,null,'Unloading workbench stopped external daemon');await record('uninstall removes package without stopping external Herdr')
 await writeFile(join(out,'result.json'),JSON.stringify({dsh:version,herdr:'0.9.3',protocol:22,archive:archive.split('/').at(-1),checks,errors,defaultWorkspaceWarnings,modelEvidence:'localhost deterministic Messages fixture only; no external-model quality acceptance',hostReact:'provided by pinned DSH; see support matrix'},null,2))
}catch(error){failure=error;for(const [index,p] of (context?.pages()??[]).entries()){if(p.isClosed())continue;await p.screenshot({path:join(out,`failure-${index}.png`),fullPage:true}).catch(()=>{});await writeFile(join(out,`failure-${index}.html`),clean(await p.content().catch(()=>'')))}await writeFile(join(out,'failure.log'),clean(error.stack??error));throw error}
finally{await writeFile(join(out,'host-diagnostics.json'),clean(JSON.stringify({diagnostics,defaultWorkspaceWarnings},null,2)));await writeFile(join(out,'host.log'),clean(hostLog));await writeFile(join(out,'herdr.log'),clean(daemonLog));await writeFile(join(out,'browser-errors.json'),clean(JSON.stringify(errors)));await browser?.close().catch(()=>{});await stop(host);await stop(daemon);await model?.close();await rm(home,{recursive:true,force:true})}


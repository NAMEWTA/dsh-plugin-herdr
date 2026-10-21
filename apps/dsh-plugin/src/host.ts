import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { WorkbenchRuntime, createPlatformModule } from '@workbench/core'
import { createHerdrModule, createHerdrToolBridge, herdrManifest } from '@workbench/herdr'
import { FileAudit, FileStorage, ClientSessions, WorkbenchRemote } from '@workbench/dsh'
import { Config, resolveConfig, type HostConfig } from '@workbench/dsh/config'
import { registerTools } from '@workbench/dsh/tools'
import { connectionConfigSchema } from '@workbench/herdr/contracts/config'
import { BUILD } from './build.ts'
export { Config }
export const name = 'namewta-workbench'
export const inject = ['profileContext','webServer']
declare module '@deepseek-ai/cordis' { interface Context { profileContext: {name:string;dir:string} } }
interface PresetRegistry { register(definition:{id:string;name:string;description:string;plugins:Array<{id:string;name:string;config:Record<string,unknown>}>}):Promise<()=>Promise<void>> }
export async function apply(ctx: Context, input: HostConfig): Promise<void> {
  const asset=await readFile(new URL('./terminal.js',import.meta.url))
  const stopAsset=ctx.webServer.register({kind:'exact',path:'/_workbench/assets/'+BUILD.sha+'/terminal.js',handler:(req,res)=>{
    if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405,{Allow:'GET, HEAD'});res.end();return}
    // Public executable code only: this handler has no data or terminal authority.
    res.writeHead(200,{'Content-Type':'text/javascript; charset=utf-8','X-Content-Type-Options':'nosniff','Cross-Origin-Resource-Policy':'same-origin','Cache-Control':'public, max-age=31536000, immutable','Content-Length':asset.byteLength})
    res.end(req.method==='HEAD'?undefined:asset)
  }})
  ctx.effect(()=>stopAsset)
  const profile = z.object({name:z.string(),dir:z.string()}).parse(ctx.profileContext)
  const config = resolveConfig(input,profile.dir)
  const storage = new FileStorage(config.dataDirectory), audit = new FileAudit(join(config.dataDirectory,'audit'))
  const runtime = new WorkbenchRuntime({storage,audit})
  const capabilities = config.readOnly ? ['platform.read','herdr.read','herdr.observe'] : ['platform.read','platform.manage',...herdrManifest.capabilities]
  const clients = new ClientSessions(capabilities)
  runtime.register(createPlatformModule(runtime,audit,BUILD))
  runtime.register(createHerdrModule(connectionConfigSchema.parse({id:'local',socketPath:config.socket,session:config.session,rootDirectory:config.workspaceRoot,pollMs:config.pollMs,terminal:{binPath:config.binary,maxObservers:config.maxObservers,maxControllers:config.maxControllers,maxProcesses:config.maxProcesses}})))
  let closed = false
  ctx.effect(() => async () => { closed = true; clients.dispose(); await runtime.dispose() })
  await runtime.start('platform')
  const enabled = await storage.scope('platform').read('enabled-herdr')
  if (enabled?.value !== false) await runtime.start('herdr')
  new WorkbenchRemote(ctx,runtime,clients)
  if (config.toolsEnabled) await ctx.plugin({name:'workbench-tools',inject:['tools'],apply:(scope:Context)=>registerTools(scope,createHerdrToolBridge(runtime),capabilities)})
  ctx.inject(['agentPresets'], scope => {
    const registry = (scope as unknown as {agentPresets:PresetRegistry}).agentPresets
    let dispose: (()=>Promise<void>) | undefined, scopeClosed = false
    scope.effect(() => async () => { scopeClosed = true; await dispose?.() })
    void registry.register({id:'workbench-herdr',name:'Workbench · Herdr',description:'Explicitly bound Herdr workspace; no implicit creation or destructive cleanup.',plugins:[{id:'workbench-persona',name:'@deepseek-ai/dsh-persona',config:{prefix:'Use workbench_herdr_inspect to read the explicitly bound workspace. Ask the user to bind one in the Workbench conversation tab when unbound. Never fall back to current focus. Use workbench_herdr_action only for an explicit user-requested action; approval is mandatory. Never automatically adopt or close external resources.'}}]}).then(stop=>{if(closed||scopeClosed)void stop();else dispose=stop}).catch(()=>{/* preset is optional; the actual workbench and tools remain available */})
  })
}

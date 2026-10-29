import { spawn, execFileSync, type ChildProcess } from 'node:child_process'
import { mkdtemp, rm, access, mkdir } from 'node:fs/promises'
import { join, isAbsolute } from 'node:path'
import { tmpdir } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'
import { WorkbenchRuntime, MemoryStorage, MemoryAudit, createPlatformModule, BoundedAsyncQueue } from '@workbench/core'
import { createHerdrModule, herdrManifest } from '@workbench/herdr'
import { LocalHerdrClient } from '../../modules/herdr/src/infrastructure/herdr-api/client.ts'
import { connectionConfigSchema } from '../../modules/herdr/src/contracts/config.ts'
import { TerminalSessionManager } from '../../modules/herdr/src/infrastructure/terminal/manager.ts'
import { catalog, terminalEventSchema, type OperationId, type Input, type Output, type TerminalEvent, type TerminalInput } from '../../modules/herdr/src/contracts/index.ts'
import { testPrincipal } from '@workbench/testkit'
import { WorkbenchError, type Json, type Principal } from '@workbench/contracts'
export async function createFixture(options?: {extraPath?: string}) {
  const binary = process.env.HERDR_TEST_BINARY
  if (!binary || !isAbsolute(binary)) throw Error('HERDR_TEST_BINARY must point to the pinned Herdr 0.9.3 executable. Integration never silently skips.')
  await access(binary)
  if (!/\b0\.9\.3\b/.test(execFileSync(binary,['--version'],{encoding:'utf8'}))) throw Error('This suite validates Herdr 0.9.3 / protocol 22 only')
  const home = await mkdtemp(join(tmpdir(),'wb-it-')),socketPath=join(home,'herdr.sock')
  const config=connectionConfigSchema.parse({socketPath,session:'wb-test',rootDirectory:home,pollMs:500,terminal:{binPath:binary,disconnectGraceMs:100,maxControllers:2}})
  const xdg={XDG_CONFIG_HOME:join(home,'config'),XDG_RUNTIME_DIR:join(home,'run'),XDG_DATA_HOME:join(home,'data'),XDG_STATE_HOME:join(home,'state'),XDG_CACHE_HOME:join(home,'cache')}
  await Promise.all(Object.values(xdg).map(dir=>mkdir(dir,{recursive:true,mode:0o700})))
  const env={...process.env,...xdg,HOME:home,HERDR_SOCKET_PATH:socketPath,HERDR_SESSION:config.session,TERM:'xterm-256color',SHELL:'/bin/sh',...options?.extraPath?{PATH:`${options.extraPath}:${process.env.PATH??''}`}:{}}
  let daemon:ChildProcess,log=''
  const port=new LocalHerdrClient(config)
  async function launch(){daemon=spawn(binary!,['server'],{env,stdio:['ignore','pipe','pipe']});daemon.stdout!.on('data',v=>{log=(log+v).slice(-8192)});daemon.stderr!.on('data',v=>{log=(log+v).slice(-8192)});daemon.on('error',error=>{log+=String(error)});const deadline=Date.now()+10000;while(Date.now()<deadline){if(daemon.exitCode!==null)throw Error('Disposable Herdr exited: '+log);try{const snapshot=await port.snapshot();if(snapshot.protocol!==22)throw Error('Protocol mismatch');return}catch{await delay(100)}}throw Error('Herdr start failed: '+log)}
  async function terminate(){if(!daemon||daemon.exitCode!==null||daemon.signalCode)return;const exited=new Promise<void>(resolve=>daemon.once('exit',()=>resolve()));daemon.kill('SIGTERM');await Promise.race([exited,delay(2000)]);if(daemon.exitCode===null&&!daemon.signalCode){daemon.kill('SIGKILL');await exited}}
  const storage=new MemoryStorage(),audit=new MemoryAudit(),runtime=new WorkbenchRuntime({storage,audit}),manager=new TerminalSessionManager({config:config.terminal,binPath:binary,socketPath,session:config.session,env})
  try{await launch();runtime.register(createPlatformModule(runtime,audit,{version:'integration',sha:'current-source'}));runtime.register(createHerdrModule(config,{port,manager}));await runtime.startAll()}catch(error){await terminate();await rm(home,{recursive:true,force:true});throw error}
  const controllerA=new AbortController(),controllerB=new AbortController()
  const a:Principal={...testPrincipal(['platform.read','platform.manage',...herdrManifest.capabilities],'browser-a'),signal:controllerA.signal},b:Principal={...a,clientId:'browser-b',signal:controllerB.signal}
  async function invoke<K extends OperationId>(operation:K,input:Input<K>,principal=a,requestId=crypto.randomUUID()):Promise<Output<K>>{const response=await runtime.invoke({operation,input:catalog[operation].input.parse(input) as Json,requestId},principal);if(!response.ok){const issueText=response.error.issues?.map(issue=>`${issue.path||'(root)'}: ${issue.message}`).join('; ');const detail=[response.error.detail,issueText].filter(Boolean).join(' ');throw new WorkbenchError(response.error.code,detail||undefined)}return catalog[operation].output.parse(response.data) as Output<K>}
  const streams=new Set<{controller:AbortController;input:BoundedAsyncQueue<TerminalInput>}>()
  function stream(leaseId:string,principal=a){const controller=new AbortController(),input=new BoundedAsyncQueue<TerminalInput>(32,262144,()=>8192),stream=runtime.stream({operation:'herdr.terminal.frames',requestId:crypto.randomUUID(),input:{leaseId}},{...principal,signal:AbortSignal.any([principal.signal,controller.signal])},input),handle={controller,input};streams.add(handle);return {input,iterator:stream,abort(){controller.abort();input.close();streams.delete(handle)}}}
  return {home,port,runtime,manager,a,b,controllerA,controllerB,storage,audit,invoke,stream,config,async restart(){await terminate();await launch();await delay(700)},async dispose(){for(const s of streams){s.controller.abort();s.input.close()}controllerA.abort();controllerB.abort();await runtime.dispose();await terminate();await rm(home,{recursive:true,force:true})}}
}
export async function untilEvent(iterator:AsyncIterator<unknown>,predicate:(event:TerminalEvent)=>boolean,timeout=8000):Promise<TerminalEvent>{const deadline=Date.now()+timeout;while(Date.now()<deadline){let timer:ReturnType<typeof setTimeout>|undefined;try{const item=await Promise.race([iterator.next(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(Error('Timed out awaiting terminal event')),Math.max(1,deadline-Date.now()))})]);if(item.done)throw Error('Terminal ended before expected event');const event=terminalEventSchema.parse(item.value);if(predicate(event))return event}finally{if(timer)clearTimeout(timer)}}throw Error('Terminal event deadline')}

import { execFile, spawn } from 'node:child_process'
import { promisify } from 'node:util'
import { arch, platform } from 'node:os'
import { realpath, stat } from 'node:fs/promises'
import { isAbsolute, relative, sep } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { WorkbenchError } from '@workbench/contracts'
import type { ConnectionConfig } from '../../contracts/config.ts'
import type { EnvironmentReport } from '../../contracts/index.ts'
import { findHerdrExecutable } from './executable.ts'
import { terminalEnv } from '../terminal/spawn.ts'
import type { HerdrReadModel } from '../../application/read-model.ts'
import type { TerminalSessionManager } from '../terminal/manager.ts'
const exec=promisify(execFile)
export class EnvironmentService {
  private previous: {cpu:NodeJS.CpuUsage;time:bigint}|undefined
  private readonly startedAt=Date.now()-process.uptime()*1000
  constructor(private readonly config:ConnectionConfig,private readonly model:HerdrReadModel,private readonly terminal:TerminalSessionManager){}
  async read():Promise<EnvironmentReport> {
    const binary=findHerdrExecutable({binPath:this.config.terminal.binPath})??null
    const supported=['linux','darwin'].includes(platform())
    let version:string|null=null,error:string|null=null,streaming=false
    if(binary&&supported){
      try {
        const v=await exec(binary,['--version'],{timeout:3000,maxBuffer:8192});version=v.stdout.trim().slice(0,100)
        const help=await exec(binary,['terminal','session','observe','--help'],{timeout:3000,maxBuffer:32768})
        streaming=this.config.terminal.enabled&&help.stdout.includes('--cols')&&help.stdout.includes('--rows')
      }catch {error='PROBE_FAILED'}
    }
    const snap=await this.model.refresh(),report=this.terminal.report()
    const cpu=process.cpuUsage(),time=process.hrtime.bigint(),prior=this.previous;this.previous={cpu,time}
    const elapsed=prior?Number(time-prior.time)/1000:0
    const cpuPercent=prior&&elapsed>0?Math.max(0,(cpu.user-prior.cpu.user+cpu.system-prior.cpu.system)/elapsed*100):null
    return {process:{pid:process.pid,startedAt:this.startedAt,sampledAt:Date.now(),cpuPercent,rssBytes:process.memoryUsage.rss(),source:'node-process'},replayBytes:report.replayBytes,subscriptions:report.subscriptions,closingProcesses:report.closingProcesses,platform:platform(),arch:arch(),binary,version,installation:binary?'installed':'missing',connected:snap.connection==='online',verified:snap.protocol===22&&snap.version==='0.9.3',socketPath:this.config.socketPath,session:this.config.session,rootDirectory:this.config.rootDirectory,streaming,supported,error,bridgeProcesses:report.activeProcesses,observers:report.observers,controllers:report.controllers,limits:report.limits,agentKinds:this.config.allowedAgentKinds}
  }
  async start(signal:AbortSignal):Promise<EnvironmentReport> {
    const report=await this.read()
    if(report.connected)return report
    if(!report.supported||!report.binary)throw new WorkbenchError('CONNECTION_UNAVAILABLE')
    // Never replace/stop an existing daemon. An inaccessible existing socket is not permission to replace it.
    try {await stat(this.config.socketPath);throw new WorkbenchError('CONNECTION_UNAVAILABLE')}
    catch(error){if(!(error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'))throw error}
    if(signal.aborted)throw new WorkbenchError('CANCELLED')
    const child=spawn(report.binary,['server'],{detached:true,stdio:'ignore',env:terminalEnv(process.env,this.config.socketPath,this.config.session==='default'?undefined:this.config.session)})
    let spawnFailed=false
    child.on('error',()=>{spawnFailed=true});child.unref()
    const until=Date.now()+10000
    while(Date.now()<until&&!signal.aborted&&!spawnFailed){await delay(200);if((await this.model.refresh()).connection==='online')return this.read()}
    throw new WorkbenchError('OPERATION_OUTCOME_UNKNOWN')
  }
}
/** Resolve symlinks and constrain creation to the administrator's configured root. */
export async function workspaceDirectory(root:string,input:string):Promise<string> {
  if(!isAbsolute(input)||input.includes('\0'))throw new WorkbenchError('INVALID_REQUEST')
  const [base,path]=await Promise.all([realpath(root),realpath(input)]).catch(()=>{throw new WorkbenchError('INVALID_REQUEST')})
  const rel=relative(base,path)
  if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||(await stat(path)).isDirectory()===false)throw new WorkbenchError('FORBIDDEN')
  return path
}

import { WorkbenchError, type ModuleManifest } from '@workbench/contracts'
import { platformOperations, platformSnapshotSchema } from '@workbench/contracts/schemas'
import type { AuditSink, WorkbenchModule } from '@workbench/sdk'
import type { WorkbenchRuntime } from './runtime.ts'
const manifest:ModuleManifest={id:'platform',version:'1.0.2-alpha.1',platformApi:1,title:{zh:'平台',en:'Platform'},description:{zh:'模块与操作审计',en:'Modules and operation audit'},dependencies:[],capabilities:['platform.read','platform.manage'],contributions:[]}
export function createPlatformModule(runtime:WorkbenchRuntime,audit:AuditSink,build:{version:string;sha:string}):WorkbenchModule {
  return {manifest,start(ctx){
    ctx.operation({...platformOperations['platform.snapshot'],id:'platform.snapshot',run:(_input,c)=>platformSnapshotSchema.parse({apiVersion:1,build,modules:runtime.statuses(),capabilities:[...c.principal.capabilities],contributions:runtime.contributions(c.principal)})})
    ctx.operation({...platformOperations['platform.module.set'],id:'platform.module.set',run:async(input)=>{
      if(input.id==='platform')throw new WorkbenchError('FORBIDDEN')
      // Module intent is saved before applying it; a restart repeats the desired state, never writes a resource.
      const current=await ctx.storage.read('enabled-'+input.id)
      await ctx.storage.write('enabled-'+input.id,input.enabled,current?.version??null)
      if(input.enabled)await runtime.start(input.id);else await runtime.stop(input.id)
      return {}
    }})
    ctx.operation({...platformOperations['platform.audit'],id:'platform.audit',run:async(input)=>[...await audit.read(input.limit)]})
  }}
}

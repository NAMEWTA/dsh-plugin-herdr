import { constants } from 'node:fs'
import { mkdir, open, readdir, rename, unlink, lstat } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes, createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { WorkbenchError, type AuditRecord, type Json } from '@workbench/contracts'
import type { AuditSink, ScopedStorage, StorageDriver, Stored } from '@workbench/sdk'
import { auditSchema } from '@workbench/contracts/schemas'
import { z } from 'zod'
const storedSchema=z.object({schema:z.literal(1),version:z.number().int().positive(),value:z.json()}).strict()
function key(value:string):string {if(!/^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,127}$/.test(value)||['__proto__','constructor'].includes(value))throw new WorkbenchError('INVALID_REQUEST');return value}
async function directory(path:string):Promise<void>{await mkdir(path,{recursive:true,mode:0o700});const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink())throw new WorkbenchError('STORAGE_UNAVAILABLE')}
function missing(error:unknown):boolean {return !!error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'}
/** Separate namespace directories, owner-only files, CAS under a cross-process lock, fsync + atomic rename. */
export class FileStorage implements StorageDriver {
  constructor(private readonly root:string){}
  scope(namespace:string):ScopedStorage {
    const dir=join(this.root,'modules',key(namespace))
    const read=async<T extends Json>(name:string):Promise<Stored<T>|null>=>{
      key(name)
      await directory(dir)
      let file
      try{
        file=await open(join(dir,key(name)+'.json'),constants.O_RDONLY|constants.O_NOFOLLOW)
        if((await file.stat()).size>1_048_576)throw new Error('oversized storage')
        const parsed=storedSchema.parse(JSON.parse(await file.readFile('utf8')))
        return {version:parsed.version,value:parsed.value as T}
      }catch(error){if(missing(error))return null;throw new WorkbenchError('STORAGE_UNAVAILABLE')}
      finally{await file?.close()}
    }
    return {read,write:async<T extends Json>(name:string,value:T,expectedVersion:number|null):Promise<Stored<T>>=>{
      const filename=join(dir,key(name)+'.json'),lock=filename+'.lock'
      await directory(dir)
      let handle
      const until=Date.now()+5000
      while(!handle){
        try{handle=await open(lock,'wx',0o600)}catch(error){
          if(!error||typeof error!=='object'||!('code'in error)||error.code!=='EEXIST'||Date.now()>until)throw new WorkbenchError('STORAGE_UNAVAILABLE')
          await delay(20)
        }
      }
      const temporary=filename+'.'+randomBytes(8).toString('hex')+'.tmp'
      try{
        const previous=await read<T>(name)
        if((previous?.version??null)!==expectedVersion)throw new WorkbenchError('RESOURCE_CHANGED')
        const record={schema:1,version:(previous?.version??0)+1,value}
        storedSchema.parse(record)
        const body=JSON.stringify(record)
        if(Buffer.byteLength(body)>1_048_576)throw new WorkbenchError('QUOTA_EXCEEDED')
        const file=await open(temporary,'wx',0o600)
        try{await file.writeFile(body);await file.sync()}finally{await file.close()}
        await rename(temporary,filename)
        const parent=await open(dir,'r');try{await parent.sync()}finally{await parent.close()}
        return {version:record.version,value:structuredClone(value)}
      }finally{await handle.close();await unlink(lock).catch(()=>{});await unlink(temporary).catch(()=>{})}
    }}
  }
}
/** Metadata-only, owner-only audit: seven days, at most four 1 MiB segments/day. */
export class FileAudit implements AuditSink {
  private tail:Promise<unknown>=Promise.resolve()
  constructor(private readonly root:string,private readonly now=Date.now,private readonly segmentBytes=1_048_576){}
  append(record:AuditRecord):Promise<void>{
    const work=this.tail.catch(()=>{}).then(async()=>{
      await directory(this.root)
      const day=new Date(this.now()).toISOString().slice(0,10),filename=join(this.root,day+'.ndjson')
      const scrubbed=auditSchema.parse({...record,actor:createHash('sha256').update(record.actor).digest('hex').slice(0,16),client:createHash('sha256').update(record.client).digest('hex').slice(0,16)})
      const line=JSON.stringify(scrubbed)+'\n'
      if(Buffer.byteLength(line)>this.segmentBytes)throw new WorkbenchError('QUOTA_EXCEEDED')
      let handle=await open(filename,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600)
      try{
        if((await handle.stat()).size+Buffer.byteLength(line)>this.segmentBytes){
          await handle.close()
          await unlink(join(this.root,day+'.3.ndjson')).catch(error=>{if(!missing(error))throw error})
          for(let index=2;index>=0;index--){
            const old=join(this.root,day+(index?'.'+index:'')+'.ndjson')
            await rename(old,join(this.root,day+'.'+(index+1)+'.ndjson')).catch(error=>{if(!missing(error))throw error})
          }
          handle=await open(filename,constants.O_CREAT|constants.O_APPEND|constants.O_WRONLY|constants.O_NOFOLLOW,0o600)
        }
        await handle.writeFile(line);await handle.sync()
      }finally{await handle.close()}
      const cutoff=new Date(this.now()-6*86_400_000).toISOString().slice(0,10)
      for(const file of await readdir(this.root))if(/^\d{4}-\d{2}-\d{2}(?:\.[1-3])?\.ndjson$/.test(file)&&file.slice(0,10)<cutoff)await unlink(join(this.root,file))
    })
    this.tail=work;return work
  }
  async read(limit:number):Promise<readonly AuditRecord[]>{
    const count=Math.min(200,Math.max(0,Math.trunc(limit)))
    if(!count)return []
    await this.tail.catch(()=>{});await directory(this.root)
    const result:AuditRecord[]=[]
    const files=(await readdir(this.root)).filter(f=>/^\d{4}-\d{2}-\d{2}(?:\.[1-3])?\.ndjson$/.test(f)).sort((a,b)=>b.slice(0,10).localeCompare(a.slice(0,10))||(Number(a.slice(10).match(/^\.(\d)/)?.[1]??0)-Number(b.slice(10).match(/^\.(\d)/)?.[1]??0))).slice(0,28)
    for(const file of files){
      const handle=await open(join(this.root,file),constants.O_RDONLY|constants.O_NOFOLLOW)
      try{
        if((await handle.stat()).size>this.segmentBytes)throw new WorkbenchError('STORAGE_UNAVAILABLE')
        const text=await handle.readFile('utf8')
        for(const line of text.trim().split('\n').reverse()){
          if(!line)continue
          const value=auditSchema.safeParse(JSON.parse(line))
          if(!value.success)throw new WorkbenchError('STORAGE_UNAVAILABLE')
          result.push(value.data as AuditRecord)
          if(result.length>=count)return result
        }
      }finally{await handle.close()}
    }
    return result
  }
}

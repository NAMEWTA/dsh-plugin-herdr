import { z } from 'zod'
import type { ModuleManifest } from '@workbench/contracts'
import { defineModule } from '@workbench/sdk'
export const notesManifest: ModuleManifest = {id:'notes',version:'1.0.3-alpha.1',platformApi:1,title:{zh:'便笺示例',en:'Example notes'},description:{zh:'验证第二模块独立接入；不进入正式发布包。',en:'Independent second-module proof; excluded from the published package.'},dependencies:['platform'],capabilities:['notes.read','notes.manage'],contributions:[{id:'notes.home',kind:'route',title:{zh:'便笺',en:'Notes'},capability:'notes.read',order:10}]}
const note = z.object({id:z.string(),text:z.string().max(500)}), notes = z.array(note).max(100)
export const notesModule = defineModule({manifest:notesManifest,start(ctx){
  ctx.contribution(notesManifest.contributions[0]!)
  ctx.operation({id:'notes.list',kind:'query',capability:'notes.read',input:z.object({}).strict(),output:notes,run:async()=>notes.parse((await ctx.storage.read('items'))?.value??[])})
  ctx.operation({id:'notes.add',kind:'action',capability:'notes.manage',input:z.object({text:z.string().trim().min(1).max(500)}).strict(),output:notes,run:async(input)=>{
    const prior = await ctx.storage.read('items'), current = notes.parse(prior?.value??[])
    const next = [...current,{id:globalThis.crypto.randomUUID(),text:input.text}].slice(-100)
    await ctx.storage.write('items',next,prior?.version??null);ctx.emit({type:'invalidate'});return next
  }})
}})

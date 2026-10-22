import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, parse, sep } from 'node:path'
import { workspaceDirectory } from '../../modules/herdr/src/infrastructure/environment/service.ts'

test('PR18: filesystem root permits real descendants without creating a double separator boundary',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wb-root-regression-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const root=parse(await realpath(dir)).root
  assert.equal(await workspaceDirectory(root,dir),await realpath(dir))
  assert.equal(await workspaceDirectory(root,root),await realpath(root))
})
test('PR18: ordinary roots reject siblings sharing a prefix and support trailing separators',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wb-prefix-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const root=join(dir,'project'),child=join(root,'inside'),sibling=join(dir,'project-other')
  await mkdir(child,{recursive:true});await mkdir(sibling)
  assert.equal(await workspaceDirectory(root+sep,child),await realpath(child))
  await assert.rejects(workspaceDirectory(root,sibling),{code:'FORBIDDEN'})
})
test('PR18: resolving filesystem root does not weaken symlink or directory checks',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'wb-root-safety-'));t.after(()=>rm(dir,{recursive:true,force:true}))
  const inside=join(dir,'inside');await mkdir(inside)
  await symlink(tmpdir(),join(inside,'escape'));await writeFile(join(inside,'not-directory'),'x')
  await assert.rejects(workspaceDirectory(inside,join(inside,'escape')),{code:'FORBIDDEN'})
  await assert.rejects(workspaceDirectory(inside,join(inside,'not-directory')),{code:'FORBIDDEN'})
  for(const path of ['','relative','bad\0path'])await assert.rejects(workspaceDirectory(inside,path),{code:'INVALID_REQUEST'})
})

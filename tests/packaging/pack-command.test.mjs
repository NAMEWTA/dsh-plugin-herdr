import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {readFile,stat} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {join} from 'node:path'
import {checkPackage} from '../../tooling/check-package.mjs'

test('documented root pack:plugin command places a verified tarball in repository artifacts',async()=>{
  const root=fileURLToPath(new URL('../../',import.meta.url))
  const pkg=JSON.parse(await readFile(join(root,'apps/dsh-plugin/package.json'),'utf8'))
  const name=pkg.name.replace(/^@/,'').replaceAll('/','-')+'-'+pkg.version+'.tgz'
  const archive=join(root,'artifacts',name),started=Date.now()
  execFileSync('pnpm',['run','pack:plugin'],{cwd:root,stdio:'pipe'})
  const info=await stat(archive)
  assert.ok(info.isFile()&&info.size>0)
  assert.ok(info.mtimeMs>=started-1000,'pack command must create this run\'s candidate, not reuse stale output')
  assert.equal((await checkPackage(archive)).version,pkg.version)
})

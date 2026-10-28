import {execFileSync} from 'node:child_process'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import assert from 'node:assert/strict'
export async function checkPackage(archive){
  const names=execFileSync('tar',['-tzf',resolve(archive)],{encoding:'utf8'}).trim().split('\n')
  assert.ok(names.every(name=>name.startsWith('package/')&&!name.includes('..')))
  assert.ok(names.every(name=>!/(?:^|\/)(?:node_modules|src|test|tests|\.env|\.git|presets|locale)(?:\/|$)/.test(name)))
  const dir=await mkdtemp(join(tmpdir(),'wb-package-'))
  try{
    execFileSync('tar',['-xzf',resolve(archive),'-C',dir]);const base=join(dir,'package'),pkg=JSON.parse(await readFile(join(base,'package.json'),'utf8'))
    assert.equal(pkg.name,'@namewta/dsh-workbench');assert.equal(pkg.dsh.manifestVersion,1)
    assert.equal(pkg.engines.dsh,'0.2.1-rc.2');assert.ok(!pkg.exports['./session-mode'])
    for(const file of ['lib/host.js','lib/client.js','lib/contract.js','lib/typert.host.js','lib/build.json','lib/sbom.cdx.json','lib/THIRD-PARTY-LICENSES.txt','LICENSE','NOTICE','README.md','cordis.patch.yml','icon.svg'])assert.ok(names.includes('package/'+file),'Missing '+file)
    const build=JSON.parse(await readFile(join(base,'lib/build.json'),'utf8'));assert.equal(build.version,pkg.version)
    const checks=await readFile(join(base,'lib/SHA256SUMS'),'utf8'),hashed=new Set()
    for(const line of checks.trim().split('\n')){const [hash,file]=line.split('  ');assert.match(file,/^[a-zA-Z0-9._-]+$/);assert.equal(createHash('sha256').update(await readFile(join(base,'lib',file))).digest('hex'),hash);hashed.add(file)}
    for(const file of await readdir(join(base,'lib')))if(file!=='SHA256SUMS')assert.ok(hashed.has(file),'Unhashed '+file)
    const client=await readFile(join(base,'lib/client.js'),'utf8');assert.ok(client.includes('window.__ModuleLoader__.load'));assert.ok(!client.includes('workbench_herdr_inspect'));assert.ok(!client.includes('notes.add'));assert.ok(!client.includes('__reactFiber'));assert.doesNotMatch(client,/\bimport\s*\(/,'Renderer must not depend on a second network import');assert.ok(!client.includes('/_workbench/assets/'));assert.ok(!names.includes('package/lib/terminal.js'))
    assert.match(await readFile(join(base,'LICENSE'),'utf8'),/sunny0826/)
    const bom=JSON.parse(await readFile(join(base,'lib/sbom.cdx.json'),'utf8'));assert.ok(bom.components.some(c=>c.name==='@xterm/xterm'));assert.ok(bom.components.some(c=>c.name==='@base-ui/react'))
    console.log('Verified distributable:',pkg.name,pkg.version,names.length,'files')
    return {name:pkg.name,version:pkg.version,files:names.length}
  }finally{await rm(dir,{recursive:true,force:true})}
}
if(process.argv[1]?.endsWith('check-package.mjs')){if(!process.argv[2])throw Error('Usage: node tooling/check-package.mjs /absolute/package.tgz');await checkPackage(process.argv[2])}


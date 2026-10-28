import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
const require=createRequire(import.meta.url)
const json=async path=>JSON.parse(await readFile(new URL(path,import.meta.url),'utf8'))
test('candidate is built and installed against one exact DSH rc.2 host contract',async()=>{
  const root=await json('../../package.json'),plugin=await json('../../apps/dsh-plugin/package.json')
  assert.equal(plugin.engines.dsh,'0.2.1-rc.2')
  const contracts=Object.entries(root.devDependencies).filter(([name])=>name.startsWith('@deepseek-ai/dsh-'))
  assert.ok(contracts.length>=7)
  for(const [name,version] of contracts){
    assert.equal(version,plugin.engines.dsh,name+' must use the sole host baseline')
    assert.equal(require(name+'/package.json').version,version,name+' installed version drift')
  }
  for(const [name,version] of Object.entries(plugin.peerDependencies)){
    assert.equal(root.devDependencies[name],version,name+' build/peer contract mismatch')
    assert.equal(require(name+'/package.json').version,version,name+' installed peer mismatch')
  }
  assert.equal(plugin.peerDependencies['@deepseek-ai/cordis'],'4.0.5')
  assert.equal(plugin.peerDependencies['@deepseek-ai/schemastery'],'3.18.5')
  const build=await json('../../apps/dsh-plugin/lib/build.json')
  assert.equal(build.dsh,plugin.engines.dsh)
  const ci=await readFile(new URL('../../.github/workflows/ci.yml',import.meta.url),'utf8')
  assert.ok(ci.includes('@deepseek-ai/dsh@'+plugin.engines.dsh),'final-package CI must install the declared host')
})


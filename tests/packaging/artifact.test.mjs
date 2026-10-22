import {test} from 'node:test'
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdtemp,rm,readFile,readdir} from 'node:fs/promises'
import {join,resolve} from 'node:path'
import {tmpdir} from 'node:os'
import {checkPackage} from '../../tooling/check-package.mjs'
test('fresh packed artifact has complete new host, browser, deferred in-bundle terminal, provenance and licenses',async t=>{const temp=await mkdtemp(join(tmpdir(),'wb-pack-'));t.after(()=>rm(temp,{recursive:true,force:true}));execFileSync('pnpm',['--filter','@namewta/dsh-workbench','pack','--pack-destination',temp],{stdio:'pipe'});const file=(await readdir(temp)).find(file=>file.endsWith('.tgz'));assert.ok(file);await checkPackage(join(temp,file))})
test('all Remote descriptors derive from one registry and use a single request parameter',async()=>{const contract=await import('../../apps/dsh-plugin/lib/contract.js');assert.equal(contract.remoteMethods.length,5);assert.deepEqual(new Set(contract.remoteDescriptors.map(d=>d.method)),new Set(contract.remoteMethods));for(const d of contract.remoteDescriptors){assert.equal(d.parameters.length,1);const codec=d.parameters[0].codec.create();assert.equal(codec.safeParse(null).success,false)}})
test('browser initializes through the host factory with host React, without bundling a second renderer',async()=>{const source=await readFile('apps/dsh-plugin/lib/client.js','utf8');const requireNames=[...source.matchAll(/require\(["']([^"']+)["']\)/g)].map(m=>m[1]);assert.ok(requireNames.includes('react'));assert.ok(requireNames.includes('react-dom'));assert.ok(requireNames.every(name=>['react','react/jsx-runtime','react-dom','react-dom/client'].includes(name)));assert.ok(!source.includes('react-dom-client.production'));assert.doesNotMatch(source,/\bimport\s*\(/,'Renderer must be bundled, not fetched through another route');assert.ok(!source.includes('/_workbench/assets/'))})

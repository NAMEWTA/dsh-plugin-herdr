import {test} from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {runInContext} from 'node:vm'
import {JSDOM} from 'jsdom'

// Regression reproduced against the failing tarball: factory() threw `process is not defined`.
test('built client factory boots with browser globals and host React, without a Node process shim',async t=>{
  const dom=new JSDOM('<!doctype html><html><head></head><body></body></html>',{url:'http://localhost/',runScripts:'outside-only'})
  t.after(()=>dom.window.close())
  let registration
  dom.window.__ModuleLoader__={load(value){registration=value}}
  const source=await readFile(new URL('../../apps/dsh-plugin/lib/client.js',import.meta.url),'utf8')
  assert.equal(typeof dom.window.process,'undefined')
  runInContext(source,dom.getInternalVMContext(),{timeout:10000})
  assert.equal(registration?.id,'@namewta/dsh-workbench')
  const require=createRequire(import.meta.url)
  const face=registration.factory(name=>{
    assert.ok(['react','react/jsx-runtime','react-dom','react-dom/client'].includes(name),'Only host React may be external')
    return require(name)
  })
  assert.equal(typeof face.apply,'function')
  assert.ok(Array.isArray(face.inject))
  assert.equal(dom.window.document.querySelectorAll('#namewta-workbench-styles').length,1)
  const style=dom.window.document.getElementById('namewta-workbench-styles')
  assert.equal(style?.getAttribute('data-plugin'),'@namewta/dsh-workbench')
  assert.match(style?.textContent??'',/\.wb-rightbar-empty/)
  assert.match(style?.textContent??'',/\.wb-session-leaf/)
  assert.ok(face.inject.includes('layout'))
  assert.ok(face.inject.includes('sidebarRight'))
  assert.equal(typeof dom.window.process,'undefined')
  assert.doesNotMatch(source,/process\.env\.NODE_ENV/)
})

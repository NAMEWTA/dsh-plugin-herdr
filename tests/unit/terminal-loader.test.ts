import {test} from 'node:test'
import assert from 'node:assert/strict'
import {configureTerminalLoader,loadTerminal,type TerminalDriver} from '../../modules/herdr/src/web/terminal/driver.ts'
const driver={Terminal:class {},FitAddon:class {}} as unknown as TerminalDriver

test('unconfigured renderer is a stable local diagnostic, not an internal server error',async()=>{
  await assert.rejects(loadTerminal(),{code:'TERMINAL_RENDERER_UNAVAILABLE'})
})
test('renderer loading is single-flight and successful results are shared',async()=>{
  let calls=0
  const dispose=configureTerminalLoader(async()=>{calls++;return driver})
  try{assert.deepEqual(await Promise.all([loadTerminal(),loadTerminal()]),[driver,driver]);await loadTerminal();assert.equal(calls,1)}finally{dispose()}
})
test('failed renderer load is normalized, does not leak a sensitive URL and can be retried',async()=>{
  let calls=0
  const dispose=configureTerminalLoader(async()=>{if(++calls===1)throw new TypeError('fetch https://host/?token=SECRET');return driver})
  try{await assert.rejects(loadTerminal(),e=>typeof e==='object'&&e!==null&&'message'in e&&e.message==='TERMINAL_RENDERER_UNAVAILABLE');assert.equal(await loadTerminal(),driver);assert.equal(calls,2)}finally{dispose()}
})
test('invalid module exports are refused before terminal acquisition',async()=>{
  const dispose=configureTerminalLoader(async()=>({}) as TerminalDriver)
  try{await assert.rejects(loadTerminal(),{code:'TERMINAL_RENDERER_UNAVAILABLE'})}finally{dispose()}
})
test('out-of-order application disposal never resurrects an already disposed loader',async()=>{
  let old=0,newer=0
  const a=configureTerminalLoader(async()=>{old++;return driver}),b=configureTerminalLoader(async()=>{newer++;return driver})
  try{a();await loadTerminal();assert.equal(old,0);assert.equal(newer,1);b();await assert.rejects(loadTerminal(),{code:'TERMINAL_RENDERER_UNAVAILABLE'});a();b()}finally{a();b()}
})
test('disposing latest registration retains an older still-live application',async()=>{
  let calls=0
  const a=configureTerminalLoader(async()=>{calls++;return driver}),b=configureTerminalLoader(async()=>driver)
  try{b();assert.equal(await loadTerminal(),driver);assert.equal(calls,1)}finally{a();b()}
})

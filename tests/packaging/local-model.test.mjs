import {test} from 'node:test'
import assert from 'node:assert/strict'
import {startLocalModel,FIXTURE_KEY,FIXTURE_PROMPT,FIXTURE_REPLY} from '../e2e/local-model.mjs'
test('local Messages fixture streams a bounded deterministic turn and retains metadata only',async t=>{
  const model=await startLocalModel();t.after(()=>model.close())
  const result=await fetch(model.baseURL+'/v1/messages',{method:'POST',headers:{'content-type':'application/json','x-api-key':FIXTURE_KEY},body:JSON.stringify({model:'deepseek-flash',stream:true,messages:[{role:'user',content:FIXTURE_PROMPT}]})})
  assert.equal(result.status,200)
  const source=await result.text();assert.ok(source.includes('event: message_start'));assert.ok(source.includes(FIXTURE_REPLY));assert.ok(source.includes('event: message_stop'))
  assert.deepEqual(model.requests,[{stream:true,acceptancePrompt:true}])
  assert.equal((await fetch(model.baseURL+'/v1/messages',{method:'POST',body:'{}'})).status,401)
  assert.equal((await fetch(model.baseURL+'/unexpected')).status,404)
  assert.equal(model.requests.length,1)
})
test('local Messages fixture also returns complete nonstream messages for host background requests',async t=>{
  const model=await startLocalModel();t.after(()=>model.close())
  const result=await fetch(model.baseURL+'/v1/messages',{method:'POST',headers:{'x-api-key':FIXTURE_KEY},body:JSON.stringify({model:'deepseek-flash',messages:[]})})
  const message=await result.json();assert.equal(message.stop_reason,'end_turn');assert.equal(message.content[0].text,FIXTURE_REPLY)
  assert.deepEqual(model.requests,[{stream:false,acceptancePrompt:false}])
})

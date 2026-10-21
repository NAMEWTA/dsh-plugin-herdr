import {test,type TestContext} from 'node:test'
import assert from 'node:assert/strict'
import {createServer,type Server} from 'node:http'
import type {Socket} from 'node:net'
import {refuseWebsocket} from '../e2e/gateway-probe.mjs'

async function listen(t:TestContext,server:Server){
  const sockets=new Set<Socket>()
  server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket))})
  t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()))})
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve))
  const address=server.address()
  assert.ok(address&&typeof address!=='string')
  return `ws://127.0.0.1:${address.port}/api/remote.mux`
}
for(const status of [401,403])test(`gateway probe confirms explicit HTTP ${status} rejection and sends real upgrade headers`,async t=>{
  const server=createServer((request,response)=>{
    assert.equal(request.headers.upgrade,'websocket')
    assert.equal(request.headers.connection,'Upgrade')
    assert.equal(request.headers.origin,'https://untrusted.invalid')
    assert.equal(request.headers.cookie,'session=fixture')
    assert.equal(Buffer.from(String(request.headers['sec-websocket-key']),'base64').length,16)
    response.writeHead(status);response.end()
  })
  const address=await listen(t,server)
  assert.equal(await refuseWebsocket(address,{Origin:'https://untrusted.invalid',Cookie:'session=fixture'}),status)
})
test('gateway probe fails when an anonymous upgrade is accepted',async t=>{
  const server=createServer()
  server.on('upgrade',(_request,socket)=>socket.end('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n'))
  await assert.rejects(refuseWebsocket(await listen(t,server)),/upgrade was accepted/)
})
test('gateway probe does not confuse an unrelated HTTP response with a security rejection',async t=>{
  const server=createServer((_request,response)=>{response.writeHead(404);response.end()})
  await assert.rejects(refuseWebsocket(await listen(t,server)),/Unexpected gateway rejection status 404/)
})
test('gateway probe times out rather than reporting an unresponsive server as protected',async t=>{
  const server=createServer(()=>{})
  await assert.rejects(refuseWebsocket(await listen(t,server),{},50),/Security probe timed out/)
})

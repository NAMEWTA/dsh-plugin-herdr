import {request as httpRequest} from 'node:http'
import {request as httpsRequest} from 'node:https'
import {randomBytes} from 'node:crypto'

// Test the actual upgrade gate without relying on jsdom's transitive dependencies.
// Transport errors, timeouts and unrelated HTTP statuses are failures, not proof of authorization.
export function refuseWebsocket(address,headers={},timeoutMs=5000){
  const url=new URL(address)
  if(!['ws:','wss:'].includes(url.protocol))throw new TypeError('A WebSocket URL is required')
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1)throw new TypeError('Positive timeout required')
  url.protocol=url.protocol==='wss:'?'https:':'http:'
  return new Promise((resolve,reject)=>{
    let finished=false
    const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',headers:{...headers,Connection:'Upgrade',Upgrade:'websocket','Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64')}})
    const finish=(error,status)=>{
      if(finished)return
      finished=true;clearTimeout(timer);request.destroy()
      error?reject(error):resolve(status)
    }
    const timer=setTimeout(()=>finish(new Error('Security probe timed out')),timeoutMs)
    request.on('upgrade',(_response,socket)=>{
      socket.destroy()
      finish(new Error('Unauthenticated/foreign-Origin gateway upgrade was accepted'))
    })
    request.on('response',response=>{
      response.resume()
      const status=response.statusCode
      if(status===401||status===403)finish(null,status)
      else finish(new Error('Unexpected gateway rejection status '+status))
    })
    request.on('error',error=>finish(error))
    request.end()
  })
}

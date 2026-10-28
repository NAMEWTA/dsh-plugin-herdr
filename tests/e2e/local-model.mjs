// Disposable localhost Messages fixture, not a live-model quality test.
import {createServer} from 'node:http'
export const FIXTURE_PROMPT='WB_NATIVE_CONVERSATION_ACCEPTANCE'
export const FIXTURE_REPLY='Workbench local fixture conversation completed.'
export const FIXTURE_KEY='sk-workbench-local-test-not-a-secret'
export async function startLocalModel(){
  const requests=[]
  const server=createServer(async(req,res)=>{
    if(req.method!=='POST'||req.url!=='/v1/messages'){res.writeHead(404);res.end();return}
    if(req.headers['x-api-key']!==FIXTURE_KEY){res.writeHead(401);res.end();return}
    let body=''
    try{
      for await(const chunk of req){body+=chunk;if(Buffer.byteLength(body)>8*1024*1024)throw Error('Fixture request too large')}
      const input=JSON.parse(body)
      // Only booleans/counts are retained. Never log prompts, tool schemas, headers or session events.
      requests.push({stream:input.stream===true,acceptancePrompt:JSON.stringify(input.messages).includes(FIXTURE_PROMPT)})
      const message={id:'msg_workbench_fixture_'+requests.length,type:'message',role:'assistant',model:input.model,content:[{type:'text',text:FIXTURE_REPLY}],stop_reason:'end_turn',stop_sequence:null,usage:{input_tokens:1,output_tokens:8}}
      if(input.stream!==true){res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify(message));return}
      res.writeHead(200,{'content-type':'text/event-stream','cache-control':'no-cache'})
      const send=(event,data)=>res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      send('message_start',{type:'message_start',message:{...message,content:[],stop_reason:null,usage:{input_tokens:1,output_tokens:0}}})
      send('content_block_start',{type:'content_block_start',index:0,content_block:{type:'text',text:''}})
      send('content_block_delta',{type:'content_block_delta',index:0,delta:{type:'text_delta',text:FIXTURE_REPLY}})
      send('content_block_stop',{type:'content_block_stop',index:0})
      send('message_delta',{type:'message_delta',delta:{stop_reason:'end_turn',stop_sequence:null},usage:{output_tokens:8}})
      send('message_stop',{type:'message_stop'});res.end()
    }catch{res.writeHead(400);res.end(JSON.stringify({type:'error',error:{type:'invalid_request_error',message:'Invalid fixture request'}}))}
  })
  await new Promise((done,reject)=>{server.once('error',reject);server.listen(0,'127.0.0.1',done)})
  return {baseURL:`http://127.0.0.1:${server.address().port}`,requests,async close(){server.closeAllConnections();await new Promise((done,reject)=>server.close(error=>error?reject(error):done()))}}
}

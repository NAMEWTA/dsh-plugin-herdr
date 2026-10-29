import { z } from 'zod'
import type { TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'
import { requestSchema,resultSchema,platformEventSchema } from '@workbench/contracts/schemas'
const client=z.string().regex(/^[a-zA-Z0-9_-]{32}$/)
export const remoteDefinitions={
  connect:{request:z.object({conversationId:z.string().min(1).max(128).optional()}).strict(),result:z.object({clientId:client,capabilities:z.array(z.string())}).strict(),mode:'rpc'},
  request:{request:z.object({clientId:client,envelope:requestSchema}).strict(),result:resultSchema,mode:'rpc'},
  disconnect:{request:z.object({clientId:client}).strict(),result:z.object({}).strict(),mode:'rpc'},
  events:{request:z.object({clientId:client}).strict(),result:platformEventSchema,mode:'stream'},
  stream:{request:z.object({clientId:client,envelope:requestSchema}).strict(),result:z.json(),uplink:z.json(),mode:'stream'},
} as const
export type RemoteMethod=keyof typeof remoteDefinitions
export const remoteMethods=Object.keys(remoteDefinitions) as RemoteMethod[]
export const remotePackage='@namewta/dsh-workbench'
const codec=(name:RemoteMethod,part:'request'|'result'|'uplink')=>({mode:'strict' as const,typeSymbol:`${remotePackage}#${name}:${part}`,create:()=>{const d=remoteDefinitions[name];return part==='uplink'&&'uplink'in d?d.uplink:d[part==='uplink'?'request':part]}})
export const remoteDescriptors=remoteMethods.map(name=>({
  id:`${remotePackage}#workbench/${name}`,service:'workbench',namespace:'workbench',method:name,
  ...remoteDefinitions[name].mode==='stream'?{mode:'stream' as const,cancellation:{parameter:'signal' as const}}:{},
  ...name==='stream'?{uplink:{codec:codec(name,'uplink')}}:{},
  invocation:{kind:'direct' as const},
  parameters:[{name:'request',wire:'request',source:'json' as const,codec:codec(name,'request')}],result:codec(name,'result'),
  sourceLocation:{file:'adapters/dsh/src/host/remote.ts',line:1,column:1},
}))
export const TYPERT_REMOTE={package:remotePackage,descriptors:remoteDescriptors} satisfies TypertRemoteContribution


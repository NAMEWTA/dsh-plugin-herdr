import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { request, useWorkbench } from '@workbench/ui'
import { catalog, snapshotSchema, environmentSchema, type Input, type OperationId, type Output } from '../contracts/index.ts'
import type { Json, WorkbenchClient } from '@workbench/contracts'
export async function call<K extends OperationId>(client:WorkbenchClient,operation:K,input:Input<K>,signal?:AbortSignal):Promise<Output<K>>{
  const parsed=catalog[operation].input.parse(input)
  const value=await request<unknown>(client,operation,parsed as Json,signal)
  return catalog[operation].output.parse(value) as Output<K>
}
export function useSnapshot(){const {client}=useWorkbench();return useQuery({queryKey:['herdr','snapshot'],queryFn:({signal})=>call(client,'herdr.snapshot',{},signal),refetchInterval:5000})}
export function useEnvironment(){const {client,capabilities}=useWorkbench();return useQuery({queryKey:['herdr','environment'],queryFn:({signal})=>call(client,'herdr.environment',{},signal),enabled:capabilities.has('herdr.settings'),staleTime:15000,refetchInterval:30000})}
export function useAction<K extends OperationId>(operation:K){const {client}=useWorkbench(),cache=useQueryClient();return useMutation({mutationFn:(input:Input<K>)=>call(client,operation,input),retry:false,onSuccess:()=>cache.invalidateQueries({queryKey:['herdr']})})}

export function useBinding(){const {client,conversationId}=useWorkbench();return useQuery({queryKey:['herdr','binding',conversationId],queryFn:({signal})=>call(client,'herdr.binding.get',{conversationId:conversationId!},signal),enabled:!!conversationId,refetchInterval:5000})}
export function useSessionResources(){const {client,conversationId,capabilities}=useWorkbench();return useQuery({queryKey:['herdr','session',conversationId],queryFn:({signal})=>call(client,'herdr.session.resources',{conversationId:conversationId!},signal),enabled:!!conversationId&&capabilities.has('herdr.read'),refetchInterval:5000})}

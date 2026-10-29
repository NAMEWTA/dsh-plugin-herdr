import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button, Card, EmptyState, ErrorNotice, Field, Input, PageHeader, request, useWorkbench, type WebModule } from '@workbench/ui'
import { notesManifest } from './index.ts'
const words = {content:['内容','Content']} as const
function NotesPage() {
  const ui = useWorkbench(),cache = useQueryClient(),[text,setText] = useState('')
  const query = useQuery({queryKey:['notes','list'],queryFn:({signal})=>request<Array<{id:string;text:string}>>(ui.client,'notes.list',{},signal)})
  const add = useMutation({mutationFn:()=>request(ui.client,'notes.add',{text}),onSuccess:()=>{setText('');void cache.invalidateQueries({queryKey:['notes']})}})
  return <><PageHeader title={ui.localize(notesManifest.title)} description={ui.localize(notesManifest.description)}/><Card><form onSubmit={e=>{e.preventDefault();add.mutate()}} className="wb-toolbar"><Field label={words.content[ui.locale==='zh'?0:1]}><Input value={text} maxLength={500} onChange={e=>setText(e.target.value)}/></Field><Button type="submit" variant="primary" disabled={!text.trim()||add.isPending}>{ui.t('save')}</Button></form>{(query.error||add.error)&&<ErrorNotice error={query.error??add.error}/>}<div className="wb-stack">{query.data?.map(note=><p className="wb-row" key={note.id}>{note.text}</p>)}</div>{query.data?.length===0&&<EmptyState title={ui.t('noResults')}/>}</Card></>
}
export const notesWeb: WebModule = {manifest:notesManifest,pages:{'notes.home':NotesPage}}

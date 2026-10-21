import { useState } from 'react'
const key='namewta.workbench.herdr.attention.v1'
interface Mark{seen?:number;snoozeUntil?:number;pinned?:boolean;updated:number}
function read():Record<string,Mark>{
  try{const parsed=JSON.parse(localStorage.getItem(key)??'{}');if(!parsed||typeof parsed!=='object'||Array.isArray(parsed))return {};return Object.fromEntries(Object.entries(parsed).filter(([k,v])=>k.length<2048&&v&&typeof v==='object'&&'updated'in v&&typeof v.updated==='number'&&v.updated>Date.now()-7*86400000).slice(-2000)) as Record<string,Mark>}
  catch{return {}}
}
export function useAttentionMarks(){
  const [marks,setMarks]=useState(read)
  const update=(ids:string[],patch:Omit<Mark,'updated'>)=>setMarks(current=>{
    const copy={...current};for(const id of ids)copy[id]={...copy[id],...patch,updated:Date.now()}
    const next=Object.fromEntries(Object.entries(copy).sort((a,b)=>a[1].updated-b[1].updated).slice(-2000))
    try{localStorage.setItem(key,JSON.stringify(next))}catch{/* memory-only fallback */}return next
  })
  return {marks,update}
}

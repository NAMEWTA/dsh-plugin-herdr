/**
 * Status glyphs and the sidebar row grid follow Ovis (devswha/ovis, MIT).
 * Copyright © 2026 devswha. Redrawn with Workbench theme tokens and lucide icons;
 * Ovis brand SVGs are not copied. See THIRD_PARTY_NOTICES.md.
 */
import type { ReactNode } from 'react'
import { AlertCircle, CircleCheck, CircleHelp, Layers, LoaderCircle } from 'lucide-react'
import type { AgentState } from '../contracts/index.ts'
import { useHerdrText } from './messages.ts'

const marks: Record<Exclude<AgentState,'idle'>, {icon: typeof LoaderCircle; className: string}> = {
  working: {icon: LoaderCircle, className: 'wb-status-working wb-spin'},
  blocked: {icon: AlertCircle, className: 'wb-status-blocked'},
  done: {icon: CircleCheck, className: 'wb-status-done'},
  unknown: {icon: CircleHelp, className: 'wb-status-unknown'},
}

/** Ready/idle draws no status. Every other state has its own icon and color. */
export function StatusMark({state}:{state?: AgentState | null}) {
  const h = useHerdrText()
  if (!state || state === 'idle') return <span className="wb-sr-only">{h('idle')}</span>
  const mark = marks[state]
  const Icon = mark.icon
  return <span className={'wb-status-mark ' + mark.className} title={h(state)}><Icon size={14} aria-hidden="true"/><span className="wb-sr-only">{h(state)}</span></span>
}

export function AgentMark({kind}:{kind: string | null}) {
  const text = (kind ?? 'sh').slice(0, 2)
  return <span className="wb-agent-mark" data-kind={kind ?? 'shell'} aria-hidden="true">{text}</span>
}

export function BackgroundCount({count}:{count: number}) {
  const h = useHerdrText()
  if (count <= 0) return null
  return <span className="wb-bg-count" title={h('backgroundTasks')}><Layers size={12} aria-hidden="true"/><span>{count}</span><span className="wb-sr-only">{h('backgroundTasks')}</span></span>
}

export function ResourceRow({icon,title,subtitle,state,count=0,selected=false,disabled=false,onClick,label}:{icon:ReactNode;title:string;subtitle:string;state?:AgentState|null;count?:number;selected?:boolean;disabled?:boolean;onClick:()=>void;label:string}) {
  return <button type="button" className="wb-resource-row" aria-label={label} aria-current={selected ? 'page' : undefined} disabled={disabled} onClick={onClick}>
    {icon}
    <span className="wb-resource-copy"><strong>{title}</strong><small>{subtitle}</small></span>
    <span className="wb-resource-end"><BackgroundCount count={count}/><StatusMark state={state}/></span>
  </button>
}

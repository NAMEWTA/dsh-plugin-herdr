import { cloneElement, isValidElement, createContext, useContext, useEffect, useId, useRef, useState, type ComponentProps, type ComponentType, type ReactNode } from 'react'
import { Button as ButtonPrimitive } from '@base-ui/react/button'
import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
import { AlertCircle, Check, LoaderCircle, X } from 'lucide-react'
import type { Json, Locale, Localized, ModuleManifest, RouteLocation, WorkbenchClient } from '@workbench/contracts'
import type { Preferences } from '@workbench/contracts/schemas'
import { messages, type MessageKey } from './messages.ts'
export { messages, type MessageKey } from './messages.ts'
export const cn=(...values:ClassValue[])=>twMerge(clsx(values))
export const buttonVariants=cva('wb-button',{variants:{variant:{primary:'wb-button-primary',secondary:'wb-button-secondary',ghost:'wb-button-ghost',danger:'wb-button-danger'},size:{default:'',sm:'wb-button-sm',icon:'wb-button-icon'}},defaultVariants:{variant:'secondary',size:'default'}})
export function Button({className,variant,size,type='button',...props}:ComponentProps<typeof ButtonPrimitive>&VariantProps<typeof buttonVariants>){return <ButtonPrimitive type={type} className={cn(buttonVariants({variant,size}),className)} {...props}/>}
export function Card({children,className,...props}:ComponentProps<'section'>){return <section className={cn('wb-card',className)} {...props}>{children}</section>}
export function Badge({children,tone='neutral'}:{children:ReactNode;tone?:'neutral'|'success'|'warning'|'danger'|'info'}){return <span className={'wb-badge wb-tone-'+tone}>{children}</span>}
export function Field({label,hint,children}:{label:string;hint?:string;children:ReactNode}){
  const generated=useId(),valid=isValidElement<{id?:string;'aria-describedby'?:string}>(children),id=valid?children.props.id??generated:generated
  const control=valid?cloneElement(children,{id,'aria-describedby':[children.props['aria-describedby'],hint?id+'-hint':undefined].filter(Boolean).join(' ')||undefined}):children
  return <div className="wb-field"><label className="wb-label" htmlFor={id}>{label}</label>{control}{hint&&<span id={id+'-hint'} className="wb-muted wb-small">{hint}</span>}</div>
}
export function Input(props:ComponentProps<'input'>){return <input {...props} className={cn('wb-input',props.className)}/>}
export function Select(props:ComponentProps<'select'>){return <select {...props} className={cn('wb-input',props.className)}/>}
export function Textarea(props:ComponentProps<'textarea'>){return <textarea {...props} className={cn('wb-input wb-textarea',props.className)}/>}
export function Skeleton(){const {t}=useWorkbench();return <div role="status" className="wb-loading" aria-label={t('loading')}><LoaderCircle className="wb-spin" size={20}/>{t('loading')}<div className="wb-skeleton"/></div>}
export function EmptyState({title,description,action,icon}:{title:string;description?:string;action?:ReactNode;icon?:ReactNode}){return <div className="wb-empty">{icon}<h3>{title}</h3>{description&&<p>{description}</p>}{action}</div>}
export function Notice({children,tone='info',title}:{children:ReactNode;tone?:'info'|'warning'|'danger';title?:string}){return <div className={'wb-notice wb-tone-'+tone} role={tone==='danger'?'alert':'status'}><AlertCircle size={18} aria-hidden="true"/><div>{title&&<strong>{title}</strong>}<div>{children}</div></div></div>}
export function Metric({label,value,detail}:{label:string;value:ReactNode;detail?:string}){return <Card className="wb-metric"><div className="wb-muted wb-small">{label}</div><strong>{value}</strong>{detail&&<span className="wb-muted wb-small">{detail}</span>}</Card>}
export function PageHeader({eyebrow,title,description,actions}:{eyebrow?:string;title:string;description?:string;actions?:ReactNode}){return <header className="wb-page-header"><div>{eyebrow&&<p className="wb-eyebrow">{eyebrow}</p>}<h1>{title}</h1>{description&&<p className="wb-muted">{description}</p>}</div>{actions&&<div className="wb-actions">{actions}</div>}</header>}
export function SectionHeader({title,description,action}:{title:string;description?:string;action?:ReactNode}){return <div className="wb-section-header"><div><h2>{title}</h2>{description&&<p className="wb-muted wb-small">{description}</p>}</div>{action}</div>}
export interface Column<T>{key:string;label:string;render:(item:T)=>ReactNode;className?:string}
export function DataTable<T>({items,columns,rowKey,label}:{items:readonly T[];columns:readonly Column<T>[];rowKey:(item:T)=>string;label:string}) {
  const {t}=useWorkbench(),[page,setPage]=useState(0),size=50
  const fingerprint=items.length+':'+(items[0]?rowKey(items[0]):'')+':'+(items.at(-1)?rowKey(items.at(-1)!):'')
  useEffect(()=>setPage(0),[fingerprint])
  const pages=Math.max(1,Math.ceil(items.length/size)),current=Math.min(page,pages-1),visible=items.slice(current*size,(current+1)*size)
  return <><div className="wb-table-scroll" tabIndex={0} role="region" aria-label={label}><table className="wb-table"><caption className="wb-sr-only">{label}</caption><thead><tr>{columns.map(c=><th scope="col" key={c.key}>{c.label}</th>)}</tr></thead><tbody>{visible.map(item=><tr key={rowKey(item)}>{columns.map(c=><td key={c.key} className={c.className}>{c.render(item)}</td>)}</tr>)}</tbody></table></div><PageControls count={items.length} page={current} size={size} onPage={setPage}/></>
}
export function PageControls({count,page,size,onPage}:{count:number;page:number;size:number;onPage:(page:number)=>void}){const {t}=useWorkbench(),pages=Math.max(1,Math.ceil(count/size));if(pages===1)return null;return <nav className="wb-toolbar" aria-label={t('pagination')}><span className="wb-muted wb-small">{page+1} / {pages} · {count}</span><div className="wb-actions"><Button disabled={page===0} onClick={()=>onPage(page-1)}>{t('previousPage')}</Button><Button disabled={page>=pages-1} onClick={()=>onPage(page+1)}>{t('nextPage')}</Button></div></nav>}
export class RequestError extends Error{constructor(readonly code:string,readonly requestId:string){super(code);this.name='RequestError'}}
export async function request<T>(client:WorkbenchClient,operation:string,input:Json={},signal?:AbortSignal):Promise<T>{
  const id=crypto.randomUUID(),response=await client.request<T>({operation,input,requestId:id},signal)
  if(!response.ok)throw new RequestError(response.error.code,response.error.requestId)
  return response.data
}
interface ConfirmOptions{title:string;description:string;danger?:boolean;confirmLabel?:string;target?:string}
interface WorkbenchUi {
  client:WorkbenchClient;locale:Locale;preferences:Preferences;setPreferences:(value:Partial<Preferences>)=>void;
  route:RouteLocation;navigate:(id:string,params?:Record<string,string>)=>void;capabilities:ReadonlySet<string>;
  t:(key:MessageKey)=>string;localize:(text:Localized)=>string;
  confirm:(options:ConfirmOptions)=>Promise<boolean>;notify:(message:string,tone?:'success'|'danger')=>void;
  portal:HTMLDivElement|null;conversationId?:string;
}
const UiContext=createContext<WorkbenchUi|null>(null)
export function useWorkbench():WorkbenchUi{const value=useContext(UiContext);if(!value)throw new Error('Workbench UI provider missing');return value}
export interface PageProps{route:RouteLocation}
export interface WebModule {navigation?:ComponentType;icon?:ComponentType<{size?:number}>;manifest:ModuleManifest;pages:Readonly<Record<string,ComponentType<PageProps>>>;widgets?:Readonly<Record<string,ComponentType>>;commands?:Readonly<Record<string,(ui:WorkbenchUi)=>void>>}
export function UiProvider({children,value}:{children:ReactNode;value:Omit<WorkbenchUi,'t'|'localize'|'confirm'|'notify'|'portal'>}){
  const [portal,setPortal]=useState<HTMLDivElement|null>(null)
  const [confirm,setConfirm]=useState<ConfirmOptions|null>(null),pending=useRef<((ok:boolean)=>void)|null>(null)
  const [toast,setToast]=useState<{id:number;text:string;tone:'success'|'danger'}|null>(null)
  const t=(key:MessageKey)=>messages[key][value.locale==='zh'?0:1]
  const resolve=(ok:boolean)=>{pending.current?.(ok);pending.current=null;setConfirm(null)}
  useEffect(()=>()=>{pending.current?.(false)},[])
  useEffect(()=>{if(!toast)return;const timer=setTimeout(()=>setToast(null),6000);return()=>clearTimeout(timer)},[toast])
  const ui:WorkbenchUi={...value,t,portal,localize:text=>text[value.locale],confirm:options=>new Promise<boolean>(resolve=>{pending.current?.(false);pending.current=resolve;setConfirm(options)}),notify:(text,tone='success')=>setToast({id:Date.now(),text,tone})}
  return <UiContext.Provider value={ui}>{children}<div className="wb-portal" ref={setPortal}/>
    {toast&&<div className={'wb-toast wb-tone-'+toast.tone} role={toast.tone==='danger'?'alert':'status'}><Check size={16}/><span>{toast.text}</span><Button size="icon" variant="ghost" aria-label={t('dismiss')} onClick={()=>setToast(null)}><X size={16}/></Button></div>}
    <Modal open={!!confirm} onOpenChange={open=>{if(!open)resolve(false)}} title={confirm?.title??''} description={confirm?.description??''}>
      {confirm?.target&&<code className="wb-target">{confirm.target}</code>}
      <div className="wb-dialog-footer"><Button data-wb-initial-focus onClick={()=>resolve(false)}>{t('cancel')}</Button><Button variant={confirm?.danger?'danger':'primary'} onClick={()=>resolve(true)}>{confirm?.confirmLabel??t('confirm')}</Button></div>
    </Modal>
  </UiContext.Provider>
}
export function Modal({open,onOpenChange,title,description,children,className}:{open:boolean;onOpenChange:(open:boolean)=>void;title:string;description?:string;children:ReactNode;className?:string}){
  const {portal}=useWorkbench(),restore=useRef<HTMLElement|null>(null)
  const previousOpen=useRef(false)
  if(open&&!previousOpen.current)restore.current=document.activeElement instanceof HTMLElement?document.activeElement:null
  previousOpen.current=open
  return <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}><DialogPrimitive.Portal container={portal??undefined}>
    <DialogPrimitive.Backdrop className="wb-backdrop"/>
    <DialogPrimitive.Popup className={cn("wb-dialog",className)} initialFocus={()=>{const el=portal?.querySelector<HTMLElement>('[data-wb-initial-focus]');return el??true}} finalFocus={()=>restore.current??true}>
      <DialogPrimitive.Title className="wb-dialog-title">{title}</DialogPrimitive.Title>
      {description&&<DialogPrimitive.Description className="wb-muted">{description}</DialogPrimitive.Description>}{children}
    </DialogPrimitive.Popup>
  </DialogPrimitive.Portal></DialogPrimitive.Root>
}
export function ErrorNotice({error,retry}:{error:unknown;retry?:()=>void}){
  const {t}=useWorkbench(),code=error&&typeof error==='object'&&'code'in error&&typeof error.code==='string'?error.code:'INTERNAL_ERROR'
  const known=Object.hasOwn(messages,code),local=!(error instanceof RequestError)
  return <Notice tone="danger" title={t('errorTitle')}><p>{local&&(!known||code==='INTERNAL_ERROR')?t('LOCAL_OPERATION_FAILED'):known?t(code as MessageKey):t('INTERNAL_ERROR')}</p>{local&&<p className="wb-small">{t('diagnosticCode')}: <code>{known?code:'LOCAL_OPERATION_FAILED'}</code></p>}{error instanceof RequestError&&<p className="wb-small">{t('requestId')}: <code>{error.requestId}</code></p>}{retry&&<Button onClick={retry}>{t('retry')}</Button>}</Notice>
}

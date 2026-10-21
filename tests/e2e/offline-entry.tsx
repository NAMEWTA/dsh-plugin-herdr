import {createRoot} from 'react-dom/client'
import {Workbench} from '@workbench/shell'
import {herdrWeb,configureTerminalLoader} from '@workbench/herdr/web'
import {notesWeb} from '@workbench/example-notes/web'
import {createDemo} from '../../apps/dev-workbench/src/mock.ts'
declare global {interface Window {fixtureOptions?:{scenario?:string;route?:string};fixtureDispose?:()=>Promise<void>}}
// about:blank has no secure-context randomUUID; this test-only equivalent uses Web Crypto entropy.
if(!crypto.randomUUID)Object.defineProperty(crypto,'randomUUID',{value:()=>{const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]!&15)|64;bytes[8]=(bytes[8]!&63)|128;const hex=Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`}})
configureTerminalLoader(async()=>{const [term,fit]=await Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit')]);return {...term,...fit}})
void(async()=>{const options=window.fixtureOptions??{},demo=await createDemo(options.scenario??'normal');const root=createRoot(document.getElementById('root')!);window.fixtureDispose=async()=>{root.unmount();await demo.dispose()};root.render(<Workbench client={demo.client} modules={[herdrWeb,notesWeb]} initialRoute={options.route??'herdr.overview'} locale="en" conversationId="demo-conversation"/>)})()

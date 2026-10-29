import { createRoot } from 'react-dom/client'
import { Workbench } from '@workbench/shell'
import { herdrWeb, configureTerminalLoader } from '@workbench/herdr/web'
import { notesWeb } from '@workbench/example-notes/web'
import { createDemo } from './mock.ts'
import '@workbench/ui/styles.css'
import '@xterm/xterm/css/xterm.css'
configureTerminalLoader(async()=>{const [terminal,fit]=await Promise.all([import('@xterm/xterm'),import('@xterm/addon-fit')]);return {...terminal,...fit}})
const params = new URLSearchParams(location.search)
const scenario = params.get('scenario') ?? 'normal'
const projectPath = params.get('nopath') === '1' ? undefined : '/demo/workbench'
const demo = await createDemo(scenario)
const root = document.getElementById('root')
if (!root) throw new Error('Root element missing')
createRoot(root).render(<Workbench client={demo.client} modules={[herdrWeb,notesWeb]} initialRoute="herdr.overview" locale={params.get('lang')==='en'?'en':'zh'} conversationId="demo-conversation" {...projectPath ? {projectPath} : {}}/>)
window.addEventListener('pagehide',()=>void demo.dispose(),{once:true})

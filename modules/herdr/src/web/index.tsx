import { PanelsTopLeft } from 'lucide-react'
import { HerdrNavigation } from './navigation.tsx'
import type { WebModule } from '@workbench/ui'
import { herdrManifest } from '../manifest.ts'
import { OverviewPage } from './overview.tsx'
import { AttentionPage,AttentionWidget } from './attention.tsx'
import { WorkspacesPage } from './workspaces.tsx'
import { AgentsPage } from './agents.tsx'
import { EnvironmentPage } from './environment.tsx'
import { TerminalPage } from './terminal/page.tsx'
export const herdrWeb:WebModule={manifest:herdrManifest,navigation:HerdrNavigation,icon:PanelsTopLeft,pages:{'herdr.overview':OverviewPage,'herdr.attention':AttentionPage,'herdr.workspaces':WorkspacesPage,'herdr.agents':AgentsPage,'herdr.environment':EnvironmentPage,'herdr.terminal':TerminalPage},widgets:{'herdr.attention-widget':AttentionWidget},commands:{'herdr.create-workspace':ui=>ui.navigate('herdr.workspaces',{create:'1'})}}

export { configureTerminalLoader } from './terminal/driver.ts'

// Test-only bundle entry for SSR render tests (test/unit/web-render.test.ts).
// node --experimental-transform-types cannot run TSX, so the test bundles this
// entry with tsdown and renders with react-dom/server.
export { DashboardContent } from '../../src/web/dashboard-view.tsx'
export { DashboardSummary } from '../../src/web/dashboard-summary.tsx'
export { DashboardWorkspaces } from '../../src/web/dashboard-workspaces.tsx'
export { HerdrDashboardPanel, HerdrPanelIcon } from '../../src/web/global-dashboard.tsx'
export { HerdrServerBanner } from '../../src/web/server-banner.tsx'
export { HerdrPanesView } from '../../src/web/herdr-view.tsx'
export { HerdrPaneList } from '../../src/web/pane-list.tsx'
export { setHerdrLang } from '../../src/web/i18n.ts'
export { setHerdrRemote } from '../../src/web/remote.ts'
export { closeGlobalDashboard, openGlobalDashboard, statusStore } from '../../src/web/store.ts'

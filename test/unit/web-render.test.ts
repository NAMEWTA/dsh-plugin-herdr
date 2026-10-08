// Regression: the global dashboard slot crashed in 'main' with
// "Cannot read properties of undefined (reading 'flatMap' / 'filter')" when the
// snapshot was not the expected shape. Render the real components (SSR) with
// undefined, partial and real protocol-22 snapshots, in zh and en.
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createElement, type ComponentType } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { build } from 'tsdown'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixtures = join(root, 'test', 'fixtures', 'remote-p22')
const load = (name: string) => JSON.parse(readFileSync(join(fixtures, name), 'utf8')) as { ok: true; value: Record<string, unknown> }

type Render = {
  DashboardContent: ComponentType<Record<string, unknown>>
  DashboardSummary: ComponentType<{ snap: unknown }>
  DashboardWorkspaces: ComponentType<{ snap: unknown }>
  HerdrDashboardPanel: ComponentType
  HerdrPanelIcon: ComponentType<{ size?: number }>
  HerdrServerBanner: ComponentType<{ snap: unknown; error: string | null }>
  HerdrPanesView: ComponentType
  HerdrPaneList: ComponentType
  setHerdrLang: (lang: string) => void
  setHerdrRemote: (remote: unknown) => void
  statusStore: { refresh(): void; subscribe(cb: () => void): () => void; getSnap(): unknown }
  openGlobalDashboard: () => void
  closeGlobalDashboard: () => void
}

let outDir = ''
let ui: Render

before(async () => {
  outDir = mkdtempSync(join(tmpdir(), 'herdr-render-'))
  await build({
    config: false,
    cwd: root,
    entry: { render: join(root, 'test', 'render', 'entry.ts') },
    outDir,
    format: 'esm',
    platform: 'node',
    dts: false,
    clean: false,
    logLevel: 'warn',
    // Resolve React from this package so the bundle and react-dom share one copy.
    external: [/^react(-dom)?(\/|$)/],
    deps: { alwaysBundle: ['@xterm/xterm', '@xterm/addon-fit', 'zod'] },
  })
  // The bundle imports "react"; place it where node resolves this package's node_modules.
  const { copyFileSync, readdirSync } = await import('node:fs')
  const file = readdirSync(outDir).find(name => name.startsWith('render') && /\.m?js$/.test(name))!
  const target = join(root, 'test', 'render', `.render-${process.pid}.mjs`)
  copyFileSync(join(outDir, file), target)
  outDir = target
  ui = await import(pathToFileURL(target).href) as Render
})

after(() => {
  if (outDir) rmSync(outDir, { force: true })
})

const render = <P extends object>(component: ComponentType<P>, props: P = {} as P): string =>
  renderToStaticMarkup(createElement(component, props))

for (const lang of ['zh', 'en'] as const) {
  test(`[${lang}] dashboard sections render undefined / partial snapshots without throwing`, () => {
    ui.setHerdrLang(lang)
    const partials: unknown[] = [
      undefined,
      null,
      {},
      { ok: true, value: {} },
      { summary: { workspaces: 1 } },
      { workspaces: [{ workspace_id: 'w1' }] },
      { workspaces: [{ workspace_id: 'w1', agents: null, panes: [{ pane_id: 'w1:p1' }] }], server: {}, process: null },
    ]
    for (const snap of partials) {
      assert.doesNotThrow(() => render(ui.DashboardSummary, { snap }), `summary ${JSON.stringify(snap)}`)
      const html = render(ui.DashboardWorkspaces, { snap })
      assert.ok(typeof html === 'string')
    }
    const empty = render(ui.DashboardWorkspaces, { snap: {} })
    assert.match(empty, /herdr-dash-empty/)
  })

  test(`[${lang}] dashboard sections render the real protocol-22 snapshot`, () => {
    ui.setHerdrLang(lang)
    const snap = load('dashboard.result.json').value
    const summary = render(ui.DashboardSummary, { snap })
    assert.match(summary, /herdr-dash-kpis/)
    assert.match(summary, /v0\.9\.0 · 22/)
    assert.match(summary, /rvp-impl-ncc/)
    const workspaces = render(ui.DashboardWorkspaces, { snap })
    assert.match(workspaces, /herdr-dash-ws-grid/)
    for (const label of ['WTA-plus', 'rvp-smoke']) assert.match(workspaces, new RegExp(label))
    assert.equal((workspaces.match(/herdr-dash-ws-card|data-workspace-id/g) ?? []).length > 0, true)
    assert.match(workspaces, lang === 'zh' ? /工作区/ : /Workspaces?/)
  })

  test(`[${lang}] dashboard panel shows loading before the first snapshot`, () => {
    ui.setHerdrLang(lang)
    ui.setHerdrRemote(null)
    const content = render(ui.DashboardContent)
    assert.match(content, /herdr-dash-loading/)
    assert.doesNotThrow(() => render(ui.HerdrDashboardPanel))
    assert.doesNotThrow(() => render(ui.HerdrPanelIcon, { size: 16 }))
  })

  test(`[${lang}] status views (banner, pane list, session Herdr tab) tolerate partial status`, () => {
    ui.setHerdrLang(lang)
    for (const snap of [null, {}, { server: {} }, { agents: null, topology: {} }, load('status.result.json').value]) {
      assert.doesNotThrow(() => render(ui.HerdrServerBanner, { snap, error: null }), `banner ${JSON.stringify(snap).slice(0, 80)}`)
    }
    assert.doesNotThrow(() => render(ui.HerdrPaneList))
    assert.doesNotThrow(() => render(ui.HerdrPanesView))
  })
}

test('views render after the status store loads a partial remote payload', async () => {
  ui.setHerdrRemote({ status: async () => ({ ok: true, value: { agents: null, topology: { panes: null } } }) })
  ui.openGlobalDashboard()
  const stop = ui.statusStore.subscribe(() => {})
  try {
    ui.statusStore.refresh()
    await new Promise(resolve => setTimeout(resolve, 30))
    const snap = ui.statusStore.getSnap() as { agents: unknown[]; topology: { panes: unknown[]; workspaces: unknown[] } }
    assert.deepEqual(snap.agents, [])
    assert.deepEqual(snap.topology.panes, [])
    assert.deepEqual(snap.topology.workspaces, [])
    assert.doesNotThrow(() => render(ui.HerdrPanesView))
    assert.doesNotThrow(() => render(ui.HerdrPaneList))
  } finally {
    stop()
    ui.closeGlobalDashboard()
    ui.setHerdrRemote(null)
  }
})

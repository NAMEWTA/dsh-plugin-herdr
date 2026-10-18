import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { PaneInspectorView, type PaneInspectorViewProps } from '../../src/web/pane-inspector-view.ts'
import { setHerdrLang } from '../../src/web/i18n.ts'

const props: PaneInspectorViewProps = {
  selected: {
    pane: { pane_id: 'real-pane-7', label: '<unsafe>', kind: 'codex', status: 'working' },
    workspace: { workspace_id: 'real-workspace-2', label: null, checkout_path_base: '/checkout', tab_count: 1, pane_count: 1, agent_count: 1, agents_working: 1, agents_blocked: 0, agents: [], panes: [] },
    cwd: '/working', tabId: 'real-tab-3', socket: '/tmp/specific.sock', session: null,
  },
  binding: { state: 'unbound' }, report: null, checking: false, opening: false, feedback: null,
  onOpen: () => {}, onCopy: () => {}, onRefresh: () => {}, onClose: () => {},
}
const render = (overrides: Partial<PaneInspectorViewProps> = {}) => renderToStaticMarkup(createElement(PaneInspectorView, { ...props, ...overrides }))

test('real inspector renders IDs/cwd and explains unbound pane in both languages', () => {
  try {
    for (const lang of ['en', 'zh']) {
      setHerdrLang(lang)
      const html = render()
      for (const value of ['real-pane-7', 'real-workspace-2', 'real-tab-3', '/working']) assert.ok(html.includes(value))
      assert.ok(html.includes('&lt;unsafe&gt;'))
      assert.match(html, /<button type="button" disabled="">/)
      assert.ok(html.includes(lang === 'en' ? 'No DSH session is bound' : '未绑定 DeepSeek Harness 会话'))
      assert.ok(html.includes(lang === 'en' ? 'browser display order only' : '仅改变浏览器中的显示顺序'))
    }
  } finally { setHerdrLang('zh') }
})
test('bound navigation is enabled only after verification; errors and copy failure are accessible', () => {
  setHerdrLang('en')
  try {
    const bound = render({ binding: { state: 'bound', sessionId: 'dsh-session-1' } })
    assert.ok(bound.includes('dsh-session-1'))
    assert.match(bound, /<button type="button">Open in DSH<\/button>/)
    for (const state of ['checking', 'error', 'unbound'] as const) {
      const html = render({ binding: { state } })
      assert.match(html, /<button type="button" disabled="">Open in DSH<\/button>/)
    }
    const failure = render({ feedback: 'copyFailed' })
    assert.match(failure, /role="alert" aria-live="polite"/)
    assert.ok(failure.includes('Clipboard unavailable'))
  } finally { setHerdrLang('zh') }
})
test('verified commands are selectable and individually named for copy; no run control', () => {
  setHerdrLang('en')
  try {
    const report: NonNullable<PaneInspectorViewProps['report']> = {
      checkedAt: 1, host: { platform: 'linux', arch: 'x64', hostname: 'test', nodeVersion: '24', wsl: false },
      supported: true, cli: { state: 'available', path: '/bin/herdr', version: '0.9.0' },
      packageManagers: { npm: true, pnpm: true }, connection: { socketPath: '/tmp/specific.sock', session: 'other', running: true, version: '0.9.0', protocol: 22 },
      terminal: { enabled: true, available: true }, verified: { version: '0.9.0', protocol: 22 },
    }
    const html = render({ report })
    assert.equal((html.match(/data-inspector-command=/g) ?? []).length, 6)
    assert.ok(html.includes('HERDR_SOCKET_PATH='))
    assert.ok(html.includes('/tmp/specific.sock'))
    assert.ok(!html.includes('--session'))
    assert.ok(html.includes('aria-label="Copy command: Pane metadata"'))
    assert.ok(html.includes('tabindex="0"'))
    assert.ok(html.includes('not executed by this panel'))
  } finally { setHerdrLang('zh') }
})

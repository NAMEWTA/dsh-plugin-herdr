// 全局 Dashboard 入口（design: dashboard-global v3 —— 插件-only：marker 注入 + 右侧
// surface）契约单测：按钮文案 drift sentinel（rail/wide、aria 依赖 global.* 键）、
// 模块级打开状态桥、样式契约（marker 在文档流内、**不允许 fixed 悬浮按钮**、
// surface 不覆盖 sidebar）。组件渲染 / DOM observer 属 CA-016 浏览器人工验收。
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { I18N_KEYS } from '../../src/web/i18n.ts'
import { closeGlobalDashboard, getGlobalDashboardOpen, globalDashboardStore, openGlobalDashboard } from '../../src/web/store.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const stylesSource = readFileSync(join(root, 'src', 'web', 'styles.ts'), 'utf8')

test('button copy: marker label/aria come from global.title (bilingual)', () => {
  // drift sentinel：marker 按钮文字与 accessible name 均来自 global.title
  // （rail 态无文字时 aria 也用它）——改文案需同步改该键（双语一起）。
  assert.ok(I18N_KEYS['global.title'].zh.length > 0)
  assert.ok(I18N_KEYS['global.title'].en.length > 0)
})

test('dashboard entry is a sidebar.panellist registration, not a DOM marker', () => {
  const app = readFileSync(join(root, 'src', 'web', 'app.tsx'), 'utf8')
  assert.match(app, /name: 'sidebar\.panellist'/)
  assert.match(app, /id: 'herdr-dashboard'/)
  assert.match(app, /name: 'main'/)
  assert.match(app, /key: 'herdr-dashboard'/)
  assert.doesNotMatch(app, /startSidebarMarkerController/)
  assert.match(stylesSource, /\.herdr-dash-panel\s*\{[^}]*background: var\(--dsw-alias-bg-base\)/)
  assert.match(stylesSource, /\.herdr-panel-icon/)
})

test('surface contract: full-height opaque work-area page with its own scroll', () => {
  // surface 从 sidebar 右缘覆盖右侧工作区：opaque 背景、全高、独立滚动、不覆盖 sidebar。
  assert.match(stylesSource, /\.herdr-gds\s*\{[^}]*position: fixed/, 'surface fixed（frame 层）')
  assert.match(stylesSource, /\.herdr-gds\s*\{[^}]*background: var\(--dsw-alias-bg-base\)/, 'opaque 背景（token，无硬编码白）')
  assert.match(stylesSource, /\.herdr-gds-body\s*\{[^}]*overflow-y: auto/, '独立滚动')
  assert.doesNotMatch(stylesSource, /\.herdr-gds\s*\{[^}]*left: 0/, 'surface 左边界由测量内联（不硬编码 0）')
})

test('v4 contracts: stacked bar colors, done=tertiary split, state dots and agent list styles exist (tokens only)', () => {
  // 颜色映射用 DSH token（data-state 选择器），无硬编码色值。
  assert.match(stylesSource, /\.herdr-dash-bar-seg\[data-state='working'\]\s*\{[^}]*var\(--dsw-alias-state-business-primary\)/, 'working 段 business token')
  assert.match(stylesSource, /\.herdr-dash-bar-seg\[data-state='done'\]\s*\{[^}]*var\(--dsw-alias-label-tertiary\)/, 'done 段中性灰（与 idle 绿区分）')
  assert.match(stylesSource, /\.herdr-panel-icon \.herdr-state-dot\[data-state='running'\]/, '面板图标运行状态点')
  assert.match(stylesSource, /\.herdr-panel-icon \.herdr-state-dot\[data-state='not-installed'\]/, '面板图标未安装状态点')
  assert.match(stylesSource, /\.herdr-dash-agent-list/, 'agent 名称列表样式')
})

test('v4 contracts: no self/focused chrome remains (global nature, requirement 6)', () => {
  // v4 全局去会话边界：不得再有 is_self 徽标 / focused 标记样式残留。
  assert.doesNotMatch(stylesSource, /\.herdr-dash-self-tag/, '无本会话徽标样式')
  assert.doesNotMatch(stylesSource, /\.herdr-dash-focused/, '无 focused 标记样式')
  assert.doesNotMatch(stylesSource, /\.herdr-dash-ws-go/, '无 self 导航按钮样式')
})

test('store bridge: open/close/getGlobalDashboardOpen forward the singleton state', () => {
  // store.ts 模块级单例是 marker、surface 与旧入口共享的打开状态桥。
  closeGlobalDashboard()
  assert.equal(getGlobalDashboardOpen(), false)
  openGlobalDashboard()
  assert.equal(getGlobalDashboardOpen(), true)
  closeGlobalDashboard()
  assert.equal(getGlobalDashboardOpen(), false)
})

test('store bridge: exported singleton subscribes to open/close (marker aria sync)', () => {
  // P1-1：marker controller 直接订阅导出单例同步 aria-pressed；断言通知序列。
  const seen: boolean[] = []
  const off = globalDashboardStore.subscribe(() => seen.push(globalDashboardStore.getOpen()))
  try {
    openGlobalDashboard()
    closeGlobalDashboard()
    openGlobalDashboard()
    closeGlobalDashboard()
    assert.deepEqual(seen, [true, false, true, false], '每次实际变化通知一次')
    off()
    openGlobalDashboard()
    assert.deepEqual(seen, [true, false, true, false], '退订后不再通知')
  } finally {
    closeGlobalDashboard()
  }
})

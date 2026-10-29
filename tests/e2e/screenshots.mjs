import { chromium } from 'playwright'
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import assert from 'node:assert/strict'
const out = resolve('docs/screenshots')
await mkdir(out, {recursive: true})
const server = spawn(process.execPath, ['node_modules/vite/bin/vite.js', '--config', 'apps/dev-workbench/vite.config.ts', '--port', '5185'], {stdio: ['ignore', 'pipe', 'pipe']})
let log = ''
server.stdout.on('data', chunk => { log = (log + chunk).slice(-8000) })
server.stderr.on('data', chunk => { log = (log + chunk).slice(-8000) })
let ready = false
for (let i = 0; i < 100; i++) { try { if ((await fetch('http://127.0.0.1:5185')).ok) { ready = true; break } } catch {} await delay(100) }
assert.ok(ready, 'Vite did not start: ' + log)
const browser = await chromium.launch({headless: true, ...process.env.WB_BROWSER_PATH ? {executablePath: process.env.WB_BROWSER_PATH} : {}, args: ['--no-sandbox']})
const saved = []
try {
  async function open({scenario = 'normal', theme = 'light', density = 'comfortable', locale = 'zh', width = 1280, height = 900} = {}) {
    const context = await browser.newContext({viewport: {width, height}, reducedMotion: 'reduce', locale: locale === 'zh' ? 'zh-CN' : 'en-US'})
    await context.addInitScript(prefs => localStorage.setItem('namewta.workbench.preferences.v1', JSON.stringify(prefs)), {version: 1, locale, theme, density})
    const page = await context.newPage()
    await page.goto(`http://127.0.0.1:5185/?scenario=${scenario}&lang=${locale}`, {waitUntil: 'domcontentloaded'})
    await page.locator('.wb-root').waitFor()
    await page.getByRole('heading', {level: 1}).waitFor()
    return page
  }
  async function shot(page, name) {
    await page.screenshot({path: resolve(out, name + '.png'), fullPage: false})
    saved.push(name + '.png')
    await page.context().close()
  }
  const light = await open()
  await light.getByRole('navigation', {name: '工作区与面板'}).waitFor()
  await shot(light, '01-studio-light')
  const dark = await open({theme: 'dark'})
  await dark.getByRole('navigation', {name: '工作区与面板'}).waitFor()
  await shot(dark, '02-studio-dark')
  const compact = await open({density: 'compact', theme: 'dark'})
  await compact.getByRole('navigation', {name: '工作区与面板'}).waitFor()
  await shot(compact, '03-studio-compact-dark')
  const empty = await open({scenario: 'empty'})
  await empty.getByText('还没有工作区', {exact: true}).waitFor()
  await shot(empty, '04-empty')
  const hidden = await open({scenario: 'unlinked'})
  await hidden.getByRole('heading', {name: '你的 Agent 工作室'}).waitFor()
  assert.equal(await hidden.getByRole('button', {name: /^终端 \d+/}).count(), 0)
  await shot(hidden, '05-session-trigger-hidden')
  const terminal = await open()
  await terminal.getByRole('navigation', {name: '工作区与面板'}).getByRole('button', {name: '查看面板 API · 请求校验', exact: true}).click()
  await terminal.locator('[data-wb-terminal][data-ready="true"]').waitFor()
  await terminal.getByText('观察中 · 不接收输入', {exact: true}).waitFor()
  await shot(terminal, '06-terminal-observing')
  const summary = await open()
  await summary.getByRole('navigation', {name: '工作区与面板'}).getByRole('button', {name: '查看面板 修复 · 租约边界', exact: true}).click()
  await summary.locator('[data-wb-terminal][data-ready="true"]').waitFor()
  await summary.getByRole('button', {name: '摘要', exact: true}).click()
  await summary.getByRole('heading', {level: 1, name: '修复 · 租约边界'}).waitFor()
  await shot(summary, '07-terminal-summary')
  const palette = await open({locale: 'en', theme: 'light'})
  await palette.getByRole('navigation', {name: 'Workspaces and panes'}).waitFor()
  await palette.keyboard.press('Control+Shift+K')
  await palette.getByRole('dialog', {name: 'Resource command palette'}).waitFor()
  await palette.getByRole('dialog').getByLabel('Search', {exact: true}).fill('codex')
  await shot(palette, '08-command-palette')
  const narrow = await open({width: 390, height: 844})
  await narrow.getByRole('heading', {name: '你的 Agent 工作室'}).waitFor()
  await narrow.locator('.wb-rail').getByRole('button', {name: 'Herdr', exact: true}).click()
  await narrow.getByRole('dialog', {name: '功能导航'}).waitFor()
  await shot(narrow, '09-narrow-drawer')
  const collapsed = await open({width: 1280})
  await collapsed.getByRole('navigation', {name: '工作区与面板'}).waitFor()
  const sidebar = collapsed.locator('.wb-sidebar')
  await sidebar.getByRole('button', {name: '收起导航', exact: true}).click()
  await sidebar.waitFor({state: 'hidden'})
  await collapsed.getByRole('button', {name: '展开导航', exact: true}).click()
  await sidebar.waitFor({state: 'visible'})
  await sidebar.getByRole('button', {name: '收起导航', exact: true}).click()
  await sidebar.waitFor({state: 'hidden'})
  await shot(collapsed, '10-sidebar-collapsed')
  const tree = await open({theme: 'light', scenario: 'bound'})
  await tree.getByRole('button', {name: /^终端 \d+/}).click()
  const popover = tree.getByRole('dialog', {name: '会话资源归属'})
  await popover.waitFor()
  await popover.getByText('子会话 · demo-subagent').waitFor()
  await popover.getByText('旧构建终端').waitFor()
  await shot(tree, '11-session-tree')
  const dock = await open({theme: 'dark', scenario: 'bound'})
  await dock.getByRole('button', {name: /^终端 \d+/}).click()
  const dialog = dock.getByRole('dialog', {name: '会话资源归属'})
  await dialog.waitFor()
  await dialog.getByRole('button', {name: /API · 请求校验/}).click()
  await dock.locator('[data-wb-terminal][data-ready="true"]').waitFor()
  await dock.getByText('观察中 · 不接收输入', {exact: true}).waitFor()
  await shot(dock, '12-session-dock-readonly')
  const workspaces = await open()
  await workspaces.getByRole('button', {name: '工作区', exact: true}).click()
  await workspaces.getByRole('heading', {level: 1, name: '工作区'}).waitFor()
  await shot(workspaces, '13-workspaces')
  const agents = await open({theme: 'dark'})
  await agents.getByRole('button', {name: 'Agent', exact: true}).click()
  await agents.getByRole('table').waitFor()
  await shot(agents, '14-agents')
  const blocked = await open()
  await blocked.locator('.wb-page').getByRole('button', {name: '查看面板 API · 请求校验', exact: true}).waitFor()
  await shot(blocked, '15-overview-states')
  const rail = await open({scenario: 'bound', width: 1440})
  const column = rail.getByRole('region', {name: 'Herdr'})
  await column.getByText('项目路径 /demo/workbench').waitFor()
  await column.getByRole('button', {name: /API · 请求校验/}).click()
  await column.locator('[data-wb-terminal][data-ready="true"]').waitFor()
  await column.getByText('观察中 · 不接收输入').waitFor()
  await shot(rail, '16-rightbar-workspace')
  const slim = await open({scenario: 'bound', width: 1440, height: 900})
  const slimColumn = slim.getByRole('region', {name: 'Herdr'})
  await slimColumn.getByText('项目路径 /demo/workbench').waitFor()
  await slimColumn.getByRole('button', {name: /API · 请求校验/}).waitFor()
  await slim.evaluate(() => {
    const shell = document.querySelector('.wb-shell')
    if (!(shell instanceof HTMLElement)) return
    const open = shell.getAttribute('data-secondary-open') === 'true'
    shell.style.gridTemplateColumns = open ? '64px 240px minmax(0,1fr) 220px' : '64px minmax(0,1fr) 220px'
  })
  await slimColumn.screenshot({path: resolve(out, '18-rightbar-narrow.png')})
  saved.push('18-rightbar-narrow.png')
  const shadowMetrics = await slim.evaluate(() => {
    const region = document.querySelector('.wb-rightbar')
    const host = document.createElement('div')
    host.id = 'wb-shadow-rail'
    host.style.cssText = 'position:fixed;top:0;left:0;width:220px;height:640px;z-index:1000;background:#fff'
    document.body.appendChild(host)
    const shadow = host.attachShadow({mode: 'open'})
    const hostile = document.createElement('style')
    hostile.textContent = 'button{font-size:10px !important;font-weight:800 !important;font-family:serif !important;color:red}'
    let css = ''
    for (const sheet of document.styleSheets) {
      try { for (const rule of sheet.cssRules) css += rule.cssText + '\n' } catch { /* cross-origin sheet is not readable */ }
    }
    const style = document.createElement('style')
    style.textContent = css
    shadow.append(hostile, style)
    const frame = document.createElement('div')
    frame.className = 'wb-root'
    frame.dataset.theme = 'light'
    frame.style.cssText = 'width:220px;height:640px'
    const clone = region.cloneNode(true)
    if (clone instanceof HTMLElement) { clone.style.width = '220px'; clone.style.height = '640px'; clone.style.display = 'flex' }
    frame.append(clone)
    shadow.append(frame)
    const button = shadow.querySelector('button.wb-resource-row')
    const detail = shadow.querySelector('small')
    const box = shadow.querySelector('.wb-rightbar-host')
    const buttonStyle = getComputedStyle(button)
    return {
      buttonSize: buttonStyle.fontSize,
      buttonWeight: buttonStyle.fontWeight,
      detailSize: getComputedStyle(detail).fontSize,
      overflow: box.scrollWidth - box.clientWidth,
    }
  })
  assert.equal(shadowMetrics.buttonSize, '13px')
  assert.equal(shadowMetrics.buttonWeight, '500')
  assert.equal(shadowMetrics.detailSize, '11px')
  assert.ok(shadowMetrics.overflow <= 1, 'narrow shadow rail overflows: ' + shadowMetrics.overflow)
  await slim.locator('#wb-shadow-rail').screenshot({path: resolve(out, '19-rightbar-shadow.png')})
  saved.push('19-rightbar-shadow.png')
  await slim.context().close()
  const railEmpty = await open({scenario: 'unlinked', width: 1440})
  const emptyRegion = railEmpty.getByRole('region', {name: 'Herdr'})
  await emptyRegion.getByRole('heading', {name: '此会话还没有工作区'}).waitFor()
  await emptyRegion.getByText('/demo/workbench').waitFor()
  await emptyRegion.locator('button:not([disabled])', {hasText: '为此路径创建并绑定工作区'}).waitFor()
  await shot(railEmpty, '17-rightbar-empty')
  console.log('Saved screenshots:', saved.join(', '))
} finally {
  await browser.close()
  server.kill('SIGTERM')
}

import { chromium } from 'playwright'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'

const source = await readFile(new URL('../../packages/ui/src/styles.css', import.meta.url), 'utf8')
const css = source.replace(/^@(?:import|source|theme)\b.*$/gm, '')
const browser = await chromium.launch({headless: true, ...process.env.WB_BROWSER_PATH ? {executablePath: process.env.WB_BROWSER_PATH} : {}, args: ['--no-sandbox']})
try {
  const page = await browser.newPage({viewport: {width: 900, height: 700}})
  await page.setContent(`<!doctype html><style>button{font-size:10px !important;font-weight:800 !important;font-family:serif !important}</style><div id="host"></div>`)
  await page.evaluate(sheet => {
    const host = document.getElementById('host')
    const shadow = host.attachShadow({mode: 'open'})
    const hostile = document.createElement('style')
    hostile.textContent = 'button{font-size:10px !important;font-weight:800 !important;font-family:serif !important;color:red}'
    const style = document.createElement('style')
    style.id = 'namewta-workbench-styles'
    style.textContent = sheet
    const frame = document.createElement('div')
    frame.className = 'wb-root'
    frame.style.cssText = 'width:220px;height:420px'
    frame.innerHTML = `<div class="wb-rightbar-host"><div class="wb-rightbar-body"><div class="wb-rail-board">
      <p class="wb-rightbar-path"><span class="wb-rail-kicker">Project path</span> /workspace/demo-project</p>
      <div class="wb-rail-workspace"><strong>demo-project</strong></div>
      <section class="wb-rail-section"><h3 class="wb-rail-tab">Tab 1</h3>
        <ul class="wb-rail-group"><li><button class="wb-resource-row" type="button" aria-current="page"><span class="wb-agent-mark">sh</span><span class="wb-resource-copy"><strong>Shell</strong><small>Idle · Shell</small></span><span class="wb-resource-end"><span class="wb-status-mark wb-status-idle">●</span></span></button></li></ul>
      </section></div></div></div>`
    shadow.append(hostile, style, frame)
  }, css)
  const metrics = await page.evaluate(() => {
    const root = document.getElementById('host').shadowRoot
    const button = root.querySelector('button')
    const title = root.querySelector('strong')
    const detail = root.querySelector('small')
    const group = root.querySelector('.wb-rail-group')
    const host = root.querySelector('.wb-rightbar-host')
    const buttonStyle = getComputedStyle(button)
    return {
      buttonSize: buttonStyle.fontSize,
      buttonWeight: buttonStyle.fontWeight,
      titleSize: getComputedStyle(title).fontSize,
      detailSize: getComputedStyle(detail).fontSize,
      detailHeight: detail.getBoundingClientRect().height,
      indent: getComputedStyle(group).paddingLeft,
      border: getComputedStyle(group).borderLeftWidth,
      overflow: host.scrollWidth - host.clientWidth,
    }
  })
  assert.equal(metrics.buttonSize, '13px')
  assert.equal(metrics.buttonWeight, '500')
  assert.equal(metrics.titleSize, '13px')
  assert.equal(metrics.detailSize, '11px')
  assert.ok(metrics.detailHeight > 8, 'status text is visible')
  assert.ok(parseFloat(metrics.indent) >= 6, 'terminal rows are indented')
  assert.ok(parseFloat(metrics.border) >= 1, 'the group keeps a hierarchy rule')
  assert.ok(metrics.overflow <= 1, 'a 220px rail does not overflow sideways')
} finally {
  await browser.close()
}

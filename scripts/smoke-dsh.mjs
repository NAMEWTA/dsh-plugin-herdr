// Exercise the published CLI against the packed plugin in a disposable profile.
// Does not read or modify a developer's DSH_HOME and does not invoke an LLM.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'

const [cliArg, archiveArg, playwrightArg, evidenceArg] = process.argv.slice(2)
assert.ok(cliArg && archiveArg && playwrightArg && evidenceArg,
  'Usage: node scripts/smoke-dsh.mjs <dsh/bin.js> <plugin.tgz> <playwright/index.mjs> <evidence-dir>')
const cli = resolve(cliArg)
const archive = resolve(archiveArg)
const evidence = resolve(evidenceArg)
mkdirSync(evidence, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'herdr-dsh-smoke-'))
const env = { ...process.env, DSH_HOME: home, CI: '1' }
const packageName = '@namewta/dsh-plugin-herdr'
let child, browser, page
let output = ''
let fatal
const capture = chunk => { output = (output + chunk.toString()).slice(-2 * 1024 * 1024) }
function command(args) {
  try {
    return execFileSync(process.execPath, [cli, ...args], { env, cwd: home, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    writeFileSync(join(evidence, 'cli-error.log'), String(error.stdout ?? '') + String(error.stderr ?? '') + String(error))
    throw error
  }
}
async function stopChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return
  const done = new Promise(resolveDone => child.once('exit', resolveDone))
  child.kill('SIGTERM')
  let timer
  try {
    await Promise.race([done, new Promise(resolveDone => { timer = setTimeout(resolveDone, 5000) })])
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL')
      await done
    }
  } finally { clearTimeout(timer) }
}
try {
  const version = command(['--version']).trim()
  const expected = process.env.DSH_SMOKE_VERSION
  assert.ok(['0.2.0-rc.2', '0.2.1-alpha.1', '0.2.1-alpha.2'].includes(expected), 'explicit supported DSH_SMOKE_VERSION required')
  assert.ok(version.includes(expected), `unexpected CLI version: ${version}`)
  writeFileSync(join(evidence, 'version.txt'), version + '\n')
  writeFileSync(join(evidence, 'install.log'), command(['plugin', '--profile', 'web', 'add', archive]))
  const installed = command(['plugin', '--profile', 'web', 'list'])
  writeFileSync(join(evidence, 'installed.txt'), installed)
  assert.ok(installed.includes(packageName), 'plugin not present in isolated profile')

  const server = createServer()
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  const port = server.address().port
  await new Promise(done => server.close(done))
  const url = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', String(port)], { env, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.on('error', error => { fatal = error })
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (fatal) throw fatal
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('DSH exited before HTTP became ready')
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2000) })
      if (response.ok && (await response.text()).includes('<html')) { ready = true; break }
    } catch { /* boot has not bound HTTP yet */ }
    await delay(500)
  }
  assert.ok(ready, 'DSH Web did not become ready')
  const { chromium } = await import(pathToFileURL(resolve(playwrightArg)).href)
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  const errors = []
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.herdr-panel-icon').first().waitFor({ state: 'attached', timeout: 60_000 })
  // Onboarding may cover the shell in a fresh profile; activate the actual slot's button.
  await page.locator('.herdr-panel-icon').first().evaluate(icon => {
    const button = icon.closest('button, [role="button"], [role="tab"]')
    if (!button) throw new Error('Herdr sidebar control not found')
    button.click()
  })
  await page.locator('.herdr-dash-panel').waitFor({ state: 'attached', timeout: 30_000 })
  await page.locator('.herdr-dash-kpis').waitFor({ state: 'attached', timeout: 30_000 })
  await page.screenshot({ path: join(evidence, 'herdr-dashboard.png'), fullPage: true })
  const dashboard = await page.locator('.herdr-dash-panel').innerText()
  writeFileSync(join(evidence, 'dashboard.txt'), dashboard)
  assert.match(dashboard, /v0\.9\.0/, 'dashboard must read the actual running Herdr server')
  writeFileSync(join(evidence, 'page-errors.json'), JSON.stringify(errors, null, 2))
  assert.deepEqual(errors, [], 'unhandled browser exception during activation/dashboard')
  await browser.close()
  browser = null
  await stopChild()
  writeFileSync(join(evidence, 'remove.log'), command(['plugin', '--profile', 'web', 'remove', packageName]))
  const removed = command(['plugin', '--profile', 'web', 'list'])
  writeFileSync(join(evidence, 'removed.txt'), removed)
  assert.ok(!removed.includes(packageName), 'plugin still present after removal')
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ dsh: version, install: true, web: true, dashboard: true, remove: true, pageErrors: errors.length }, null, 2))
  console.log('Published DSH CLI: install/list/Web/dashboard/remove smoke passed')
} finally {
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'last-page.png'), fullPage: true }).catch(() => {})
    writeFileSync(join(evidence, 'last-page.html'), await page.content().catch(() => ''))
  }
  await browser?.close().catch(() => {})
  await stopChild()
  writeFileSync(join(evidence, 'host.log'), output)
  rmSync(home, { recursive: true, force: true })
}

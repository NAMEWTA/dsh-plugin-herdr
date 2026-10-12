// Exercise the published CLI against the packed plugin in a disposable profile.
// Does not read or modify a developer's DSH_HOME and does not invoke an LLM.
import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { pathToFileURL } from 'node:url'
import { readWebStartupUrl, redactLaunchTokens } from './dsh-smoke-utils.mjs'

const [cliArg, archiveArg, playwrightArg, evidenceArg] = process.argv.slice(2)
assert.ok(cliArg && archiveArg && playwrightArg && evidenceArg,
  'Usage: node scripts/smoke-dsh.mjs <dsh/bin.js> <plugin.tgz> <playwright/index.mjs> <evidence-dir>')
const cli = resolve(cliArg)
const archive = resolve(archiveArg)
const evidence = resolve(evidenceArg)
mkdirSync(evidence, { recursive: true })
const home = mkdtempSync(join(tmpdir(), 'herdr-dsh-smoke-'))
const env = { ...process.env, DSH_HOME: home, CI: '1' }
const missingInstall = process.env.HERDR_SMOKE_MISSING === '1'
if (missingInstall) {
  env.HERDR_BIN_PATH = join(home, 'herdr-bin', 'herdr')
  env.HERDR_SESSION = `herdr-install-check-${process.pid}`
  delete env.HERDR_SOCKET_PATH
}
const packageName = '@namewta/dsh-plugin-herdr'
const errors = []
let child, browser, page
let output = ''
let fatal
const capture = chunk => { output = (output + chunk.toString()).slice(-2 * 1024 * 1024) }
function command(args) {
  try {
    return execFileSync(process.execPath, [cli, ...args], { env, cwd: home, encoding: 'utf8', timeout: 180_000, maxBuffer: 8 * 1024 * 1024 })
  } catch (error) {
    writeFileSync(join(evidence, 'cli-error.log'), redactLaunchTokens(String(error.stdout ?? '') + String(error.stderr ?? '') + String(error)))
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
  const origin = `http://127.0.0.1:${port}`
  child = spawn(process.execPath, [cli, 'web', '--no-open', '--port', String(port)], { env, cwd: home, stdio: ['ignore', 'pipe', 'pipe'] })
  child.stdout.on('data', capture)
  child.stderr.on('data', capture)
  child.on('error', error => { fatal = error })
  let launchUrl = null
  let ready = false
  for (let attempt = 0; attempt < 120; attempt++) {
    if (fatal) throw fatal
    if (child.exitCode !== null || child.signalCode !== null) throw new Error('DSH exited before HTTP became ready')
    launchUrl = readWebStartupUrl(output, origin)
    if (launchUrl) {
      try {
        // The token sets a browser cookie via redirect. Node fetch has no cookie jar;
        // do not follow that redirect here or an authenticated server looks unready.
        const response = await fetch(launchUrl, { redirect: 'manual', signal: AbortSignal.timeout(2000) })
        if (response.ok || [302, 303, 307, 308].includes(response.status)) { ready = true; break }
      } catch { /* boot has not bound HTTP yet */ }
    }
    await delay(500)
  }
  assert.ok(ready && launchUrl, 'DSH Web authenticated launch URL did not become ready')
  const launchToken = new URL(launchUrl).searchParams.get('token')
  if (process.env.GITHUB_ACTIONS === 'true' && launchToken) console.log(`::add-mask::${launchToken}`)
  const { chromium } = await import(pathToFileURL(resolve(playwrightArg)).href)
  browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] })
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', error => errors.push(error.message))
  await page.goto(launchUrl, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const icon = page.locator('.herdr-panel-icon').first()
  await icon.waitFor({ state: 'attached', timeout: 60_000 })
  // Both dialogs are part of a real first-run flow, not plugin failures. Wait for
  // each to mount and dismiss it through its public UI. Never inject credentials
  // or use force-click to bypass the modal and hide a broken interaction.
  const notice = page.getByRole('dialog', { name: 'Preview Notice', exact: true })
  await notice.getByRole('button', { name: 'Continue', exact: true }).click({ timeout: 30_000 })
  await notice.waitFor({ state: 'hidden', timeout: 10_000 })
  const credentials = page.getByRole('dialog', { name: 'Add an API key to get started', exact: true })
  await credentials.getByRole('button', { name: 'Configure later', exact: true }).click({ timeout: 30_000 })
  await credentials.waitFor({ state: 'hidden', timeout: 10_000 })
  const sidebarButton = icon.locator('xpath=ancestor::*[self::button or @role="button" or @role="tab"][1]')
  await sidebarButton.click({ timeout: 30_000 })
  await page.locator('.herdr-dash-panel').waitFor({ state: 'visible', timeout: 30_000 })
  await page.locator('.herdr-dash-kpis').waitFor({ state: 'visible', timeout: 30_000 })
  if (!missingInstall) await page.waitForFunction(() => document.querySelector('.herdr-gds-version')?.textContent === 'v0.9.0', null, { timeout: 45_000 })
  const settingsButton = page.getByRole('button', { name: 'Installation & settings', exact: true })
  if (await settingsButton.getAttribute('aria-expanded') !== 'true') await settingsButton.click()
  const setup = page.locator('.herdr-setup').first()
  await setup.locator(`[data-cli-state="${missingInstall ? 'missing' : 'available'}"]`).waitFor({ state: 'visible', timeout: 30_000 })
  assert.match(await setup.innerText(), /npm install --global pnpm@10.28.2/)
  assert.doesNotMatch(await setup.innerText(), /npm install --global herdr/)
  assert.match(await setup.innerText(), /linux \/ x64/)
  await page.context().grantPermissions(['clipboard-read', 'clipboard-write'])
  await setup.getByRole('button', { name: 'Copy command: Official Herdr installer', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), 'curl -fsSL https://herdr.dev/install.sh | sh')
  if (missingInstall) {
    assert.equal(await setup.getByRole('button', { name: 'Start Herdr server', exact: true }).isDisabled(), true)
    await page.screenshot({ path: join(evidence, 'herdr-missing.png'), fullPage: true })
    // Install the already checksum-verified real binary into the configured test location.
    // Never run a remote install script and never touch the developer's installation.
    assert.ok(process.env.RUNNER_TEMP)
    mkdirSync(join(home, 'herdr-bin'), { recursive: true })
    cpSync(join(process.env.RUNNER_TEMP, 'herdr-bin', 'herdr'), env.HERDR_BIN_PATH)
    chmodSync(env.HERDR_BIN_PATH, 0o755)
    await setup.getByRole('button', { name: 'Check environment / test connection', exact: true }).click()
    await setup.locator('[data-cli-state="available"]').waitFor({ state: 'visible', timeout: 30_000 })
    await setup.getByRole('button', { name: 'Start Herdr server', exact: true }).click()
  } else {
    await setup.getByRole('button', { name: 'Check environment / test connection', exact: true }).click()
  }
  await setup.locator('[data-connection="connected"]').waitFor({ state: 'visible', timeout: 45_000 })
  await page.screenshot({ path: join(evidence, 'herdr-environment.png'), fullPage: true })
  // settings.plugins.tab is owned by "Built-in plugins", not the sidebar's "Plugins" page.
  await page.getByRole('button', { name: 'Settings', exact: true }).click()
  const settingsDialog = page.getByRole('dialog')
  await settingsDialog.getByText('Built-in plugins', { exact: true }).click()
  await settingsDialog.getByRole('tab', { name: 'Herdr environment', exact: true }).click()
  await settingsDialog.locator('[data-cli-state="available"]').waitFor({ state: 'visible', timeout: 30_000 })
  await settingsDialog.locator('[data-connection="connected"]').waitFor({ state: 'visible', timeout: 30_000 })
  await page.screenshot({ path: join(evidence, 'herdr-native-settings.png'), fullPage: true })
  await page.keyboard.press('Escape')
  await settingsDialog.waitFor({ state: 'hidden', timeout: 10_000 })
  await page.waitForFunction(() => document.querySelector('.herdr-gds-version')?.textContent === 'v0.9.0', null, { timeout: 45_000 })
  await page.screenshot({ path: join(evidence, 'herdr-dashboard.png'), fullPage: true })
  const dashboard = await page.locator('.herdr-dash-panel').innerText()
  writeFileSync(join(evidence, 'dashboard.txt'), dashboard)
  assert.match(dashboard, /v0\.9\.0/, 'dashboard must read the actual running Herdr server')
  assert.deepEqual(errors, [], 'unhandled browser exception during activation/dashboard')
  await browser.close()
  browser = null
  await stopChild()
  writeFileSync(join(evidence, 'remove.log'), command(['plugin', '--profile', 'web', 'remove', packageName]))
  const removed = command(['plugin', '--profile', 'web', 'list'])
  writeFileSync(join(evidence, 'removed.txt'), removed)
  assert.ok(!removed.includes(packageName), 'plugin still present after removal')
  writeFileSync(join(evidence, 'result.json'), JSON.stringify({ dsh: version, install: true, web: true, dashboard: true, environmentSettings: true, nativeSettings: true, missingInstallRecovery: missingInstall, remove: true, pageErrors: errors.length }, null, 2))
  console.log('Published DSH CLI: install/list/Web/dashboard/remove smoke passed')
} catch (error) {
  writeFileSync(join(evidence, 'failure.log'), redactLaunchTokens(error instanceof Error ? error.stack ?? error.message : String(error)))
  throw error
} finally {
  writeFileSync(join(evidence, 'page-errors.json'), redactLaunchTokens(JSON.stringify(errors, null, 2)))
  if (page && !page.isClosed()) {
    await page.screenshot({ path: join(evidence, 'last-page.png'), fullPage: true }).catch(() => {})
    writeFileSync(join(evidence, 'last-page.html'), redactLaunchTokens(await page.content().catch(() => '')))
  }
  await browser?.close().catch(() => {})
  await stopChild()
  writeFileSync(join(evidence, 'host.log'), redactLaunchTokens(output))
  const diagnostics = join(home, 'profiles', 'web', '.plugin-manager', 'logs')
  if (existsSync(diagnostics)) cpSync(diagnostics, join(evidence, 'plugin-manager-logs'), { recursive: true })
  if (missingInstall && existsSync(env.HERDR_BIN_PATH)) {
    try { execFileSync(env.HERDR_BIN_PATH, ['server', 'stop'], { env, cwd: home, timeout: 10_000, stdio: 'ignore' }) } catch { /* only the uniquely named disposable test server */ }
  }
  rmSync(home, { recursive: true, force: true })
}

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createEnvironmentReader } from '../../src/host/environment/service.ts'
import { resolveTerminalSessionConfig, type Config } from '../../src/host/config.ts'

test('missing configured executable remains visible for diagnosis without executing a fallback', async () => {
  for (const source of ['config', 'environment']) {
    const configured = '/missing directory/herdr'
    const config: Config = {
      timeoutMs: 30000, allowBackground: false, reportState: false,
      events: { enabled: false, maxReconnectMs: 30000 },
      socketPath: '/tmp/not-connected.sock',
      terminalSession: resolveTerminalSessionConfig({ terminalSession: source === 'config' ? { binPath: configured } : {} }),
    }
    let probes = 0
    const report = await createEnvironmentReader(config, {
      platform: 'linux', arch: 'x64',
      env: source === 'environment' ? { HERDR_BIN_PATH: configured } : {},
      findHerdr: () => null, findTool: () => null,
      run: async () => { probes++; return null }, ping: async () => null,
    })()
    assert.equal(report.cli.state, 'missing')
    assert.equal(report.cli.path, configured, 'show the failed override instead of hiding it behind null')
    assert.equal(report.cli.version, null)
    assert.equal(probes, 0, 'a missing configured path must never run a guessed binary')
  }
})

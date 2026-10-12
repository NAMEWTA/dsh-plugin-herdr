import { test } from 'node:test'
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { environmentCommands } from '../../src/core/environment.ts'
import { Config } from '../../src/host/config.ts'
import { findHerdrExecutable, findOnPath } from '../../src/host/environment/executable.ts'
import { createEnvironmentReader, runProbe } from '../../src/host/environment/service.ts'
import { environmentSchema } from '../../src/host/environment/schema.ts'
import { startHerdrServer, type SpawnFn } from '../../src/host/status.ts'
import { HerdrPanelService } from '../../src/host/panel/remote.ts'
import { Context } from '@deepseek-ai/cordis'

const config = () => Config({ socketPath: '/test/herdr.sock', session: 'test-session', timeoutMs: 30000, allowBackground: false, events: { enabled: true, maxReconnectMs: 30000 }, reportState: true })

test('installation commands use the host OS and never invent an npm Herdr package', () => {
  for (const platform of ['linux', 'darwin']) {
    for (const arch of ['x64', 'arm64']) {
      const commands = environmentCommands({ platform, arch })
      assert.match(commands.find(c => c.id === 'official')!.command, /https:\/\/herdr\.dev\/install\.sh/)
      assert.equal(commands.some(c => c.id === 'homebrew'), platform === 'darwin')
      assert.ok(commands.some(c => c.command === 'npm install --global pnpm@10.28.2'))
      assert.equal(commands.some(c => /npm.*(?:\sherdr|@herdr)/.test(c.command)), false)
    }
  }
  assert.deepEqual(environmentCommands({ platform: 'win32', arch: 'x64' }), [{ id: 'wsl', command: 'wsl --install' }])
  assert.deepEqual(environmentCommands({ platform: 'freebsd', arch: 'x64' }), [])
  assert.deepEqual(environmentCommands({ platform: 'linux', arch: 'riscv64' }), [])
})

test('explicit invalid binaries never silently fall back to a different Herdr', () => {
  const options = { env: { PATH: '/bin', HERDR_BIN_PATH: '/custom/herdr' }, platform: 'linux', home: '/home/test', executable: (p: string) => p === '/bin/herdr' }
  assert.equal(findHerdrExecutable(options), null)
  assert.equal(findHerdrExecutable({ ...options, binPath: '/bin/herdr' }), '/bin/herdr')
  assert.equal(findHerdrExecutable({ ...options, env: { PATH: '/bin' } }), '/bin/herdr')
})

test('finds the official local installation without relying on a new shell PATH', () => {
  assert.equal(findHerdrExecutable({ platform: 'linux', env: { PATH: '/bin' }, home: '/home/test', executable: p => p === '/home/test/.local/bin/herdr' }), '/home/test/.local/bin/herdr')
  assert.equal(findHerdrExecutable({ platform: 'darwin', env: { PATH: '/bin' }, home: '/home/test', executable: p => p === '/opt/homebrew/bin/herdr' }), '/opt/homebrew/bin/herdr')
  assert.equal(findOnPath('herdr', { env: { PATH: '.:node_modules/.bin:/usr/bin' }, executable: p => !p.startsWith('/usr/bin') }), null)
})

test('missing CLI and reachable server are reported independently; recheck discovers a new install', async () => {
  let installed = false
  let calls = 0
  const read = createEnvironmentReader(config(), {
    platform: 'linux', arch: 'x64', env: {}, release: 'test', hostname: 'host-not-browser',
    findHerdr: () => installed ? '/bin/herdr' : null,
    findTool: name => name === 'npm' ? '/bin/npm' : null,
    run: async (_bin, args) => { calls++; return args[0] === '--version' ? 'herdr 0.9.0' : 'observe control' },
    ping: async path => { assert.equal(path, '/test/herdr.sock'); return { version: '0.9.0', protocol: 22 } },
  })
  const missing = await read()
  assert.equal(missing.cli.state, 'missing')
  assert.equal(missing.connection.running, true)
  assert.equal(missing.host.hostname, 'host-not-browser')
  assert.equal(missing.packageManagers.pnpm, false)
  assert.equal(calls, 0)
  installed = true
  const present = await read()
  assert.equal(present.cli.state, 'available')
  assert.equal(present.terminal.available, true)
  assert.equal(present.cli.version, '0.9.0')
  assert.equal(calls, 2)
  assert.equal(environmentSchema.safeParse(present).success, true)
})

test('parallel reads share bounded probes and no probe starts a server or terminal', async () => {
  const calls: string[][] = []
  const read = createEnvironmentReader(config(), {
    platform: 'linux', arch: 'x64', findHerdr: () => '/bin/herdr', findTool: () => null,
    run: async (_bin, args) => { calls.push(args); await new Promise(r => setTimeout(r, 10)); return args[0] === '--version' ? 'herdr 0.9.0' : 'observe control' },
    ping: async () => null,
  })
  const first = read()
  const second = read()
  assert.equal(first, second)
  const result = await first
  assert.deepEqual(calls, [['--version'], ['terminal', 'session', '--help']])
  assert.equal(result.connection.running, false)
})

test('Windows blocks native probes and advertises WSL instead of claiming support', async () => {
  const read = createEnvironmentReader(config(), {
    platform: 'win32', arch: 'x64', env: {}, findHerdr: () => '/bin/herdr', findTool: () => null,
    run: async () => { throw new Error('must not execute') }, ping: async () => { throw new Error('must not connect') },
  })
  const result = await read()
  assert.equal(result.supported, false)
  assert.equal(result.cli.state, 'unsupported')
  assert.equal(result.connection.socketPath, null)
})

test('WSL is identified from the host, and a broken CLI is not labelled installed', async () => {
  const result = await createEnvironmentReader(config(), {
    platform: 'linux', arch: 'arm64', release: 'microsoft-standard-WSL2', env: {},
    findHerdr: () => '/broken/herdr', findTool: () => null, run: async () => null, ping: async () => null,
  })()
  assert.equal(result.host.wsl, true)
  assert.equal(result.cli.state, 'unusable')
  assert.equal(result.terminal.available, false)
})

test('the environment Remote exposes a validated, read-only report', async () => {
  const read = createEnvironmentReader(config(), { platform: 'linux', arch: 'x64', findHerdr: () => null, findTool: () => null, ping: async () => null })
  const runtime = { environment: read } as ConstructorParameters<typeof HerdrPanelService>[1]
  const panel = new HerdrPanelService(new Context(), runtime)
  assert.equal((await panel.environment()).cli.state, 'missing')
  assert.equal(environmentSchema.safeParse({ checkedAt: 'bad', command: 'arbitrary command' }).success, false)
  const { TYPERT } = await import('../../lib/typert.host.js')
  const descriptor = TYPERT.invocations.find((d: { method: string }) => d.method === 'environment')!
  assert.deepEqual(descriptor.parameters, [])
  assert.throws(() => descriptor.result.create().parse({ cli: 'wrong' }))
})

test('real temporary executables support paths with spaces; probes do not invoke a shell', async () => {
  const root = mkdtempSync(join(tmpdir(), 'herdr probe '))
  try {
    const bin = join(root, 'herdr')
    writeFileSync(bin, '#!/bin/sh\nprintf "herdr 0.9.0\\n"\n')
    chmodSync(bin, 0o755)
    assert.equal(findHerdrExecutable({ binPath: bin }), bin)
    assert.equal(await runProbe(bin, ['--version']), 'herdr 0.9.0')
    assert.equal(await runProbe(bin + '; echo unsafe', ['--version']), null)
    chmodSync(bin, 0o644)
    assert.equal(findHerdrExecutable({ binPath: bin }), null)
    assert.equal(await runProbe(bin, ['--version']), null)
  } finally { rmSync(root, { recursive: true, force: true }) }
})

test('server start inherits the selected socket/session and deduplicates only the same target', async () => {
  const observed: Array<{ cmd: string; env?: NodeJS.ProcessEnv }> = []
  const seen = new Set<string>()
  function start(id: string) {
    const spawn: SpawnFn = (cmd, _args, opts) => { observed.push({ cmd, env: opts.env }); seen.add(id); return { unref() {}, on() {} } }
    return startHerdrServer(`/tmp/${id}.sock`, { session: id, binPath: '/custom/herdr', spawnFn: spawn, probe: async () => seen.has(id) ? { version: '0.9.0', protocol: 22 } : null })
  }
  await Promise.all([start('one'), start('one'), start('two')])
  assert.equal(observed.length, 2)
  assert.equal(observed[0].cmd, '/custom/herdr')
  assert.equal(observed[0].env?.HERDR_SOCKET_PATH, '/tmp/one.sock')
  assert.equal(observed[1].env?.HERDR_SESSION, 'two')
})

test('explicit environment recheck invalidates a failed terminal capability cache', async () => {
  const { createTerminalRuntime } = await import('../../src/host/terminal-session/runtime.ts')
  let available = false
  const runtime = createTerminalRuntime(config(), {
    probe: async () => ({ available, observe: available, control: available }),
    createManager: () => ({ dispose() {} }),
  })
  assert.equal(await runtime.ensureAvailable(), false)
  available = true
  assert.equal(await runtime.ensureAvailable(), false, 'failure is normally cached')
  runtime.invalidateProbe()
  assert.equal(await runtime.ensureAvailable(), true)
  runtime.dispose()
})

/** Profile-local dashboard; socket state comes from the shared status tracker. */
import { execFile } from 'node:child_process'
import { arch, hostname, platform, release, type as osType } from 'node:os'
import type { Context } from '@deepseek-ai/cordis'
import { aggregateDashboardWorkspaces, buildDashboardSummary, deriveStale, pathBase, shouldProbeNow, type DashboardAgentLike, type DashboardTopologyLike } from '../core/dashboard.ts'
import type { HerdrDashboardHost, HerdrDashboardProcess, HerdrDashboardServerInfo, HerdrDashboardSnapshot } from '../contracts/dashboard.ts'
import { createLogger, createRateLimiter } from './log.ts'
export type * from '../contracts/dashboard.ts'
export interface HerdrDashboardStatusSource {
  connected: boolean
  stale: boolean
  last_error: string | null
  updated_at?: number
  server: HerdrDashboardServerInfo
  topology: DashboardTopologyLike
  agents: ReadonlyArray<DashboardAgentLike>
}
export const collectHostInfo = (): HerdrDashboardHost => ({ hostname: hostname(), platform: platform(), arch: arch(), os_type: osType(), os_release: release(), node_version: process.version })
export type ProcessProbeFn = (signal: AbortSignal) => Promise<HerdrDashboardProcess>
export const parsePgrepOutput = (stdout: string): number[] => [...new Set(stdout.trim().split(/\s+/).filter(value => /^\d+$/.test(value)).map(Number).filter(value => Number.isSafeInteger(value) && value > 0))]
export interface PsSampleLine { ps_pid: number; cpu_percent: number; rss: number; lstart: string }
export function parsePsOutput(stdout: string): PsSampleLine | null {
  const match = stdout.trim().match(/^(\d+)\s+([\d.]+)\s+(\d+)\s+(.+)$/)
  if (!match) return null
  const value = { ps_pid: Number(match[1]), cpu_percent: Number(match[2]), rss: Number(match[3]), lstart: match[4]! }
  return Number.isSafeInteger(value.ps_pid) && Number.isFinite(value.cpu_percent) && Number.isSafeInteger(value.rss) ? value : null
}
function unavailable(sampled_at: number, error: string, pid: number | null = null): HerdrDashboardProcess {
  return { available: false, pid, started_at: null, cpu_percent: null, rss_bytes: null, source: 'posix-pgrep-ps', sampled_at, error }
}
function execText(command: string, args: string[], signal: AbortSignal, timeout: number): Promise<string | null> {
  if (signal.aborted || timeout <= 0) return Promise.resolve(null)
  return new Promise(resolve => {
    execFile(command, args, { signal, timeout, maxBuffer: 64 * 1024, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (error, stdout) => {
      if (!error) resolve(String(stdout))
      else if (error.code === 1) resolve('')
      else resolve(null)
    })
  })
}
/** Never attribute an arbitrary first PID to the selected Herdr server. */
export async function probeHerdrProcess(signal: AbortSignal): Promise<HerdrDashboardProcess> {
  const sampledAt = Date.now()
  if (!['linux', 'darwin'].includes(process.platform)) return unavailable(sampledAt, `process probing unsupported on platform ${process.platform}`)
  const deadline = sampledAt + 1500
  let candidates: number[] = []
  for (const args of [['-f', 'herdr server'], ['-x', 'herdr']]) {
    const text = await execText('pgrep', args, signal, deadline - Date.now())
    if (text === null) return unavailable(sampledAt, 'process probe failed (pgrep unavailable, aborted or timed out)')
    candidates = parsePgrepOutput(text)
    if (candidates.length) break
  }
  if (candidates.length !== 1) return unavailable(sampledAt, candidates.length ? 'multiple Herdr processes; selected server PID cannot be established' : 'herdr server process not found')
  const pid = candidates[0]!
  const text = await execText('ps', ['-p', String(pid), '-o', 'pid=,%cpu=,rss=,lstart='], signal, deadline - Date.now())
  const sample = text === null ? null : parsePsOutput(text)
  if (!sample || sample.ps_pid !== pid) return unavailable(sampledAt, 'ps unavailable, timed out or returned an invalid sample', pid)
  const startedAt = Date.parse(sample.lstart)
  return { available: true, pid, started_at: Number.isNaN(startedAt) ? null : startedAt, cpu_percent: sample.cpu_percent, rss_bytes: sample.rss * 1024, source: 'posix-pgrep-ps', sampled_at: sampledAt, error: null }
}
export interface HerdrDashboardTrackerOptions {
  readStatus: () => HerdrDashboardStatusSource
  pollIntervalMs?: number
  staleThresholdMs?: number
  probeProcess?: ProcessProbeFn
  probeIntervalMs?: number
  collectHost?: () => HerdrDashboardHost
}
export class HerdrDashboardTracker {
  private controller: AbortController | null = null
  private timer?: ReturnType<typeof setInterval>
  private cycle: Promise<void> | null = null
  private dto: HerdrDashboardSnapshot
  private lastSample: HerdrDashboardProcess | null = null
  // When this process last ran the probe. Throttling must follow our own clock,
  // not the sample's sampled_at (which a test or remote host may shape freely).
  private lastProbeAt = 0
  private readonly host: HerdrDashboardHost
  private readonly warn: (message: string) => void
  constructor(ctx: Context, private readonly options: HerdrDashboardTrackerOptions) {
    this.host = (options.collectHost ?? collectHostInfo)()
    const logger = createLogger(ctx, 'dashboard')
    const limited = createRateLimiter(10000)
    this.warn = message => limited('dashboard', () => logger.warn('%s', message))
    this.dto = {
      updated_at: 0, stale: true, last_error: null,
      server: { status: 'unknown', running: false, version: null, protocol: null, socket: null, session: null, checked_at: 0, installation: 'unknown' },
      connection: { connected: false, last_success_at: 0, collectors: { server: false, topology: false, agents: false, host: true, process: false } },
      host: this.host, process: unavailable(0, 'no process sample yet'),
      summary: { workspaces: 0, tabs: 0, panes: 0, agents: 0, agents_by_status: {} }, workspaces: [],
    }
  }
  snapshot(): HerdrDashboardSnapshot {
    return { ...this.dto, stale: this.dto.stale || deriveStale(this.dto.updated_at, Date.now(), this.options.staleThresholdMs ?? 20000) }
  }
  start(): void {
    if (this.controller) return
    this.controller = new AbortController()
    void this.refresh()
    this.timer = setInterval(() => { void this.refresh() }, this.options.pollIntervalMs ?? 2000)
    this.timer.unref?.()
  }
  stop(): void {
    this.controller?.abort()
    this.controller = null
    this.cycle = null
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
  }
  private refresh(): Promise<void> {
    const controller = this.controller
    if (!controller) return Promise.resolve()
    if (this.cycle) return this.cycle
    const active = () => this.controller === controller && !controller.signal.aborted
    const work = (async () => {
      // Sample first, then read the newest socket snapshot. Never create an
      // unobserved probe promise if readStatus throws.
      let sample = this.lastSample
      if (!sample || shouldProbeNow(this.lastProbeAt, Date.now(), this.options.probeIntervalMs ?? 15000)) {
        sample = await (this.options.probeProcess ?? probeHerdrProcess)(controller.signal)
        if (!active()) return
        this.lastProbeAt = Date.now()
        this.lastSample = sample
      }
      const status = this.options.readStatus()
      if (!active()) return
      const workspaces = aggregateDashboardWorkspaces(status.topology, status.agents)
      const updatedAt = status.stale ? this.dto.updated_at : status.updated_at ?? Date.now()
      this.dto = {
        updated_at: updatedAt, stale: status.stale, last_error: status.last_error ?? sample.error,
        server: { ...status.server, socket: pathBase(status.server.socket) }, host: this.host, process: sample,
        connection: { connected: status.connected, last_success_at: updatedAt, collectors: { server: status.server.status !== 'unknown', topology: !status.stale, agents: !status.stale, host: true, process: sample.available } },
        summary: buildDashboardSummary(workspaces, status.agents), workspaces,
      }
    })().catch(error => {
      if (!active()) return
      const message = `dashboard cycle failed: ${error instanceof Error ? error.message : String(error)}`
      this.dto = { ...this.dto, stale: true, last_error: message }
      this.warn(message)
    }).finally(() => { if (this.cycle === work) this.cycle = null })
    this.cycle = work
    return work
  }
}

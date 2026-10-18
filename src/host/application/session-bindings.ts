import {
  getBindingRegistry, ownsMarkedWorkspace, removeOwnedBinding, sessionIdFromTokens,
  sessionToken, type HerdrSessionBinding,
} from '../binding-registry.ts'

export interface BindingClient {
  snapshot(signal?: AbortSignal): Promise<{ panes: Array<{ pane_id: string; workspace_id: string; tokens?: Record<string, string | null> }> }>
  workspaceCreate(request: { label: string; cwd?: string }): Promise<{ workspace_id: string; pane_id?: string }>
  workspaceClose(id: string): Promise<void>
  paneClose(id: string): Promise<void>
  paneRename(id: string, label: string): Promise<void>
  workspaceRename(id: string, label: string): Promise<void>
  reportMetadata(request: { pane_id: string; source: string; agent: string; tokens: Record<string, string>; ttl_ms: null }): Promise<void>
  clearAgentAuthority(request: { pane_id: string; source: string; agent: string }): Promise<void>
}
interface Entry {
  binding: HerdrSessionBinding
  rename: Promise<void>
  labelRevision: number
}
interface SessionBindingsOptions {
  source: string
  fixedPaneId?: string
  warn: (message: string, error?: unknown) => void
}

/** Profile-local ownership and lifetime, independent of Cordis event dispatch. */
export class SessionBindings {
  private readonly entries = new Map<string, Entry>()
  private readonly pending = new Map<string, Promise<HerdrSessionBinding | null>>()
  private readonly revisions = new Map<string, number>()
  private readonly cleanupTasks = new Set<Promise<void>>()
  private readonly lifetime = new AbortController()
  private closed = false

  constructor(private readonly client: BindingClient, private readonly options: SessionBindingsOptions) {}

  get(id: string): HerdrSessionBinding | undefined { return this.entries.get(id)?.binding }

  bind(id: string, label: string, cwd?: string): Promise<HerdrSessionBinding | null> {
    if (this.closed) return Promise.resolve(null)
    const existing = this.entries.get(id)
    if (existing) return Promise.resolve(existing.binding)
    const pending = this.pending.get(id)
    if (pending) return pending
    const revision = this.revisions.get(id) ?? 0
    const task = this.create(id, label, cwd, revision).finally(() => {
      if (this.pending.get(id) === task) this.pending.delete(id)
    })
    this.pending.set(id, task)
    return task
  }

  private async create(id: string, label: string, cwd: string | undefined, revision: number): Promise<HerdrSessionBinding | null> {
    let binding: HerdrSessionBinding | undefined
    try {
      const fixed = this.options.fixedPaneId?.trim()
      if (fixed) binding = { pane_id: fixed, created: false }
      else {
        const snapshot = await this.client.snapshot(this.lifetime.signal)
        if (!this.current(id, revision)) return null
        const existing = snapshot.panes.find(pane => sessionIdFromTokens(pane.tokens) === id)
        if (existing) {
          binding = {
            pane_id: existing.pane_id, workspace_id: existing.workspace_id, created: true,
            workspace_owned: ownsMarkedWorkspace(existing, id),
          }
        } else {
          // Once creation is submitted, wait for its bounded receipt so a late
          // result can be compensated; aborting the receipt would lose its ID.
          const workspace = await this.client.workspaceCreate({ label, cwd })
          if (!workspace.pane_id) {
            await this.client.workspaceClose(workspace.workspace_id)
            throw new Error('workspace.create returned no root pane')
          }
          binding = { pane_id: workspace.pane_id, workspace_id: workspace.workspace_id, created: true, workspace_owned: true }
          if (!this.current(id, revision)) { await this.cleanup(binding); return null }
          await this.client.reportMetadata({ pane_id: binding.pane_id, source: this.options.source, agent: 'dsh', tokens: sessionToken(id, workspace.workspace_id), ttl_ms: null })
        }
      }
      if (!this.current(id, revision)) { await this.cleanup(binding); return null }
      // A replacement standing mount may have claimed this ID while we awaited.
      const owner = getBindingRegistry().get(id)
      if (owner && owner !== this.entries.get(id)?.binding) {
        if (owner.pane_id !== binding.pane_id) await this.cleanup(binding)
        return null
      }
      this.entries.set(id, { binding, rename: Promise.resolve(), labelRevision: 0 })
      getBindingRegistry().set(id, binding)
      void this.rename(id, label)
      return binding
    } catch (error) {
      if (binding) await this.cleanup(binding)
      if (!this.closed) this.options.warn(`session ${id} binding failed`, error)
      return null
    }
  }

  /** Serial, revision-gated renames cannot let an older title win last. */
  rename(id: string, label: string): Promise<void> {
    const entry = this.entries.get(id)
    if (!entry || this.closed) return Promise.resolve()
    const revision = ++entry.labelRevision
    entry.rename = entry.rename.catch(() => {}).then(async () => {
      if (this.closed || this.entries.get(id) !== entry || revision !== entry.labelRevision) return
      if (entry.binding.workspace_owned && entry.binding.workspace_id) await this.client.workspaceRename(entry.binding.workspace_id, label)
      if (this.closed || this.entries.get(id) !== entry || revision !== entry.labelRevision) return
      await this.client.paneRename(entry.binding.pane_id, label)
    }).catch(error => this.options.warn(`session ${id} rename failed`, error))
    return entry.rename
  }

  async unbind(id: string): Promise<void> {
    const revision = (this.revisions.get(id) ?? 0) + 1
    this.revisions.set(id, revision)
    const entry = this.entries.get(id)
    this.entries.delete(id)
    if (entry) {
      const owner = getBindingRegistry().get(id)
      if (!owner || owner === entry.binding) {
        removeOwnedBinding(id, entry.binding)
        await entry.rename
        await this.cleanup(entry.binding)
      }
    }
    // A pending create consumes the revision change and cleans its late result.
    await this.pending.get(id)
    if (this.revisions.get(id) === revision && !this.pending.has(id) && !this.entries.has(id)) this.revisions.delete(id)
  }

  async dispose(): Promise<void> {
    if (this.closed) return
    this.closed = true
    this.lifetime.abort()
    await Promise.allSettled([...this.entries.keys()].map(id => this.unbind(id)))
    await Promise.allSettled([...this.pending.values()])
    await Promise.allSettled([...this.cleanupTasks])
    this.revisions.clear()
  }

  private current(id: string, revision: number): boolean {
    return !this.closed && (this.revisions.get(id) ?? 0) === revision
  }
  private cleanup(binding: HerdrSessionBinding): Promise<void> {
    // Never close resources another live mount now owns.
    if ([...getBindingRegistry().values()].some(owner => owner !== binding && (owner.pane_id === binding.pane_id || (owner.workspace_id && owner.workspace_id === binding.workspace_id)))) return Promise.resolve()
    const task = (async () => {
      if (!binding.created) await this.client.clearAgentAuthority({ pane_id: binding.pane_id, source: this.options.source, agent: 'dsh' })
      else if (binding.workspace_owned && binding.workspace_id) {
        try { await this.client.workspaceClose(binding.workspace_id) }
        catch (error) {
          this.options.warn('workspace cleanup failed; attempting owned pane only', error)
          await this.client.paneClose(binding.pane_id)
        }
      } else await this.client.paneClose(binding.pane_id)
    })().catch(error => this.options.warn('session resource cleanup failed', error))
    this.cleanupTasks.add(task)
    void task.finally(() => this.cleanupTasks.delete(task))
    return task
  }
}

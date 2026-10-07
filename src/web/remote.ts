// Client-side access to the Herdr Host Remote namespace.
// The namespace is installed by ctx.remote.$mount(); components read it through
// this holder so data code can be tested without a browser.

import type { HerdrRemote } from './herdr-remote.js'

export type { HerdrRemote }

let remote: HerdrRemote | null = null

export function setHerdrRemote(next: HerdrRemote | null): void {
  remote = next
}

export function getHerdrRemote(): HerdrRemote {
  if (!remote) throw new Error('herdr remote is not mounted')
  return remote
}

export async function remoteJson<T>(call: Promise<unknown>): Promise<T> {
  return await call as T
}

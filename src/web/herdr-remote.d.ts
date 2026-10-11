// Compile-time projection of the same schemas used by the gateway codecs.
import type { PanelMethod, PanelRequest, PanelResult } from '../contracts/panel-schemas.ts'

export type HerdrRemote = {
  [M in PanelMethod]: M extends 'events'
    ? (request?: PanelRequest<M>) => AsyncIterable<PanelResult<M>>
    : undefined extends PanelRequest<M>
      ? (request?: PanelRequest<M>) => Promise<PanelResult<M>>
      : (request: PanelRequest<M>) => Promise<PanelResult<M>>
}

import { WorkbenchError } from '@workbench/contracts'
import type { EnvironmentReport, HerdrSnapshot, PaneInspection, ResourceRef } from '../contracts/index.ts'
import { sameResource } from './selectors.ts'

/** A POSIX literal, not an executable command runner. Never interpolate unquoted values. */
export function shellQuote(value:string):string {
  if (!value || /[\u0000-\u001f\u007f]/.test(value)) throw new WorkbenchError('INVALID_REQUEST')
  return "'" + value.replace(/'/g, "'\\''") + "'"
}

export function inspectorCommands(report:EnvironmentReport, ref:ResourceRef):PaneInspection['commands'] {
  if (!report.connected || !report.verified || !report.supported || report.error ||
      report.installation!=='installed' || !report.binary?.startsWith('/') ||
      !/\b0\.9\.3\b/.test(report.version??'') || report.session!==ref.session || ref.kind!=='pane' ||
      !/^[a-zA-Z0-9][a-zA-Z0-9:_.-]*$/.test(ref.id)) return []
  try {
    // An explicit session flag overrides HERDR_SOCKET_PATH. Never combine them.
    // The Workbench always resolves a full socket, so do not guess an implicit default endpoint.
    if (!report.socketPath.startsWith('/')) return []
    const prefix=`HERDR_SOCKET_PATH=${shellQuote(report.socketPath)} ${shellQuote(report.binary)}`
    const pane=shellQuote(ref.id)
    return [
      {id:'snapshot',command:`${prefix} api snapshot`},
      {id:'pane',command:`${prefix} pane get ${pane}`},
      {id:'layout',command:`${prefix} pane layout --pane ${pane}`},
      {id:'process',command:`${prefix} pane process-info --pane ${pane}`},
      {id:'output',command:`${prefix} pane read ${pane} --source visible --lines 80 --format text`},
      {id:'agent',command:`${prefix} agent get ${pane}`},
    ]
  } catch { return [] }
}

/** Build metadata from one authoritative snapshot. CWD is never fabricated from the workspace. */
export function inspectPane(snapshot:HerdrSnapshot, report:EnvironmentReport, ref:ResourceRef):PaneInspection {
  if (ref.kind!=='pane') throw new WorkbenchError('INVALID_REQUEST')
  if (snapshot.stale || snapshot.connection!=='online' || !report.connected) throw new WorkbenchError('STALE_SNAPSHOT')
  if (snapshot.connectionId!==ref.connectionId || snapshot.session!==ref.session || snapshot.epoch!==ref.epoch || report.session!==ref.session) throw new WorkbenchError('RESOURCE_CHANGED')
  const pane=snapshot.panes.find(p=>sameResource(p.ref,ref))
  const workspace=pane&&snapshot.workspaces.find(w=>w.ref.id===pane.workspaceId)
  const tab=pane&&snapshot.tabs.find(t=>t.ref.id===pane.tabId&&t.workspaceId===pane.workspaceId)
  if (!pane || !workspace || !tab) throw new WorkbenchError('RESOURCE_CHANGED')
  return {sampledAt:snapshot.sampledAt,pane,workspace,tab,socketPath:report.socketPath,session:report.session,binary:report.binary,
    commands:snapshot.version==='0.9.3'&&snapshot.protocol===22?inspectorCommands(report,ref):[]}
}

import type { HerdrSnapshot, Pane, ResourceRef } from '../contracts/index.ts'
export const resourceKey = (ref: ResourceRef): string => JSON.stringify([ref.connectionId,ref.session,ref.epoch,ref.kind,ref.id,ref.instance])
export const sameResource = (a:ResourceRef,b:ResourceRef):boolean => resourceKey(a)===resourceKey(b)
export const stateKey = (pane:Pane):string => resourceKey(pane.ref)+':'+pane.stateSequence
export function attention(snapshot:HerdrSnapshot, seen:ReadonlySet<string>):Pane[] {
  return snapshot.panes.filter(p=>p.agent && (p.state==='blocked'||p.state==='done'&&!seen.has(stateKey(p))))
    .sort((a,b)=>(a.state==='blocked'?0:1)-(b.state==='blocked'?0:1)||a.label.localeCompare(b.label))
}
export function summary(snapshot:HerdrSnapshot) {
  const agents=snapshot.panes.filter(p=>p.agent)
  return {workspaces:snapshot.workspaces.length,panes:snapshot.panes.length,agents:agents.length,
    working:agents.filter(p=>p.state==='working').length,blocked:agents.filter(p=>p.state==='blocked').length,
    done:agents.filter(p=>p.state==='done').length,unknown:agents.filter(p=>p.state==='unknown').length}
}
export function filterPanes(panes:readonly Pane[],search:string,status:string,workspace?:string):Pane[] {
  const needle=search.trim().toLocaleLowerCase()
  return panes.filter(p=>(!workspace||p.workspaceId===workspace)&&(status==='all'||p.state===status)&&
    (!needle||[p.label,p.ref.id,p.agent??'',p.cwd??'',p.workspaceId].join(' ').toLocaleLowerCase().includes(needle)))
}

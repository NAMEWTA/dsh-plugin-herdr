import { getHerdrRemote } from './remote.ts'

/** 查询本会话绑定 pane；未绑定或 Remote 未挂载返回 null。 */
export async function fetchSelfPaneId(sessionId: string): Promise<string | null> {
  try {
    const result = await getHerdrRemote().sessionPane({ agent: sessionId }) as { pane_id?: string | null }
    return result.pane_id ?? null
  } catch {
    return null
  }
}

/** 反查 pane 所属会话；无归属或查询失败返回 null。 */
export async function fetchPaneSession(paneId: string): Promise<string | null> {
  try {
    const result = await getHerdrRemote().paneSession({ pane: paneId }) as { session_id?: string | null }
    return result.session_id ?? null
  } catch {
    return null
  }
}

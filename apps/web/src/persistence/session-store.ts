/**
 * R4-06 会话恢复：刷新页面后自动回到上次所在房间。
 *
 * - 房间码存 sessionStorage（关标签页即清，刷新保留）；
 * - 玩家位置由 R4-01 的 sessionToken 从服务端恢复（session_resumed 消息），
 *   这里只负责把「上次房间码 / 上次位置」在本地落一份，供首次进入时提示恢复。
 *
 * 全部纯函数 + 可注入 storage，node 环境可测。
 */

export const SESSION_ROOM_KEY = 'balabala.session.roomCode'
export const SESSION_POS_KEY = 'balabala.session.lastPos'
export const SESSION_TOKEN_KEY = 'balabala.sessionToken'

export interface SavedPosition {
  x: number
  z: number
  rotation: number
  at: string
}

function defaultSession(): Storage | null {
  if (typeof sessionStorage === 'undefined') return null
  try {
    return sessionStorage
  } catch {
    return null
  }
}

/** 记住当前房间码（进入房间时调用）。 */
export function saveRoomCode(code: string, storage?: Storage | null): void {
  const s = storage ?? defaultSession()
  if (!s) return
  try { s.setItem(SESSION_ROOM_KEY, code) } catch { /* noop */ }
}

/** 读取上次房间码（刷新后恢复用）；无则 null。 */
export function loadRoomCode(storage?: Storage | null): string | null {
  const s = storage ?? defaultSession()
  if (!s) return null
  try {
    const v = s.getItem(SESSION_ROOM_KEY)
    return v || null
  } catch {
    return null
  }
}

export function clearRoomCode(storage?: Storage | null): void {
  const s = storage ?? defaultSession()
  try { s?.removeItem(SESSION_ROOM_KEY) } catch { /* noop */ }
}

/** 记住上次位置（节流写入，不要每帧调）。 */
export function savePosition(pos: SavedPosition, storage?: Storage | null): void {
  const s = storage ?? defaultSession()
  if (!s) return
  try { s.setItem(SESSION_POS_KEY, JSON.stringify(pos)) } catch { /* noop */ }
}

export function loadPosition(storage?: Storage | null): SavedPosition | null {
  const s = storage ?? defaultSession()
  if (!s) return null
  try {
    const raw = s.getItem(SESSION_POS_KEY)
    if (!raw) return null
    const p = JSON.parse(raw) as Partial<SavedPosition>
    if (typeof p.x !== 'number' || typeof p.z !== 'number') return null
    return { x: p.x, z: p.z, rotation: typeof p.rotation === 'number' ? p.rotation : 0, at: p.at ?? '' }
  } catch {
    return null
  }
}

/** 持久化 R4-01 会话 token（重连时带回服务端恢复位置/对局）。 */
export function saveSessionToken(token: string, storage?: Storage | null): void {
  const s = storage ?? defaultSession()
  try { s?.setItem(SESSION_TOKEN_KEY, token) } catch { /* noop */ }
}
export function loadSessionToken(storage?: Storage | null): string | null {
  const s = storage ?? defaultSession()
  if (!s) return null
  try { return s.getItem(SESSION_TOKEN_KEY) } catch { return null }
}

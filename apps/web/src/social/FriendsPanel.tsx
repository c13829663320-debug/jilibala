// ===== Round4 R4-07: 好友列表面板 =====
// 功能：在线状态 / 邀请进房 / 删除好友 / 接收好友请求。
// 品牌色：纯黑底 + 明黄 #FFD600 + 青绿 #4fb3a5。
// 注：云端无 GPU，UI 仅做组件实现，需真机确认布局与交互。
import { useCallback, useEffect, useState } from 'react'
import type { Friend, FriendRequest } from '@balabala/shared'
import { friendsApi } from './friends-store'

export interface FriendsPanelProps {
  userId: string
  /** 当前所在房间码（邀请进房时带上）；为空时禁用邀请按钮。 */
  currentRoomCode?: string
  /** 收到 friend_invite / friend_online 等 WS 事件时触发刷新。 */
  wsEvent?: { type: string; at: number } | null
  onOpenPrivateChat?: (friend: Friend) => void
}

export function FriendsPanel({ userId, currentRoomCode, wsEvent, onOpenPrivateChat }: FriendsPanelProps) {
  const [friends, setFriends] = useState<Friend[]>([])
  const [requests, setRequests] = useState<FriendRequest[]>([])
  const [error, setError] = useState<string>('')

  const refresh = useCallback(async () => {
    try {
      const [f, r] = await Promise.all([friendsApi.list(userId), friendsApi.requests(userId)])
      setFriends(f.friends)
      setRequests(r.requests)
      setError('')
    } catch (e) {
      setError((e as Error).message)
    }
  }, [userId])

  useEffect(() => { refresh() }, [refresh, wsEvent?.at])

  const handleAccept = async (requestId: string) => {
    try { await friendsApi.accept(requestId, userId); await refresh() }
    catch (e) { setError((e as Error).message) }
  }
  const handleReject = async (requestId: string) => {
    try { await friendsApi.reject(requestId, userId); await refresh() }
    catch (e) { setError((e as Error).message) }
  }
  const handleRemove = async (friendId: string) => {
    if (!confirm('删除该好友？')) return
    try { await friendsApi.remove(userId, friendId); await refresh() }
    catch (e) { setError((e as Error).message) }
  }
  const handleInvite = async (friend: Friend) => {
    if (!currentRoomCode) { setError('你当前不在社交房间中'); return }
    try { await friendsApi.invite(userId, friend.userId, currentRoomCode) }
    catch (e) { setError((e as Error).message) }
  }

  return (
    <aside className="balabala-friends-panel" style={styles.panel}>
      <h3 style={styles.title}>好友 {friends.length}</h3>
      {error && <div style={styles.error}>{error}</div>}

      {requests.length > 0 && (
        <div style={styles.section}>
          <div style={styles.sectionTitle}>待处理请求 {requests.length}</div>
          {requests.map((r) => (
            <div key={r.requestId} style={styles.requestRow}>
              <span style={styles.name}>{r.fromNickname}</span>
              <button style={styles.acceptBtn} onClick={() => handleAccept(r.requestId)}>接受</button>
              <button style={styles.rejectBtn} onClick={() => handleReject(r.requestId)}>拒绝</button>
            </div>
          ))}
        </div>
      )}

      <div style={styles.section}>
        {friends.length === 0 && <div style={styles.empty}>还没有好友，去广场认识一下吧</div>}
        {friends.map((f) => (
          <div key={f.userId} style={styles.row}>
            <span style={{ ...styles.dot, background: f.status === 'online' ? '#4fb3a5' : '#555' }} />
            <span style={styles.name}>{f.nickname}</span>
            <span style={styles.status}>
              {f.status === 'online' ? (f.roomCode ? `在 ${f.roomCode}` : '在线') : '离线'}
            </span>
            <button style={styles.iconBtn} onClick={() => onOpenPrivateChat?.(f)}>私聊</button>
            <button
              style={{ ...styles.iconBtn, opacity: currentRoomCode ? 1 : 0.4 }}
              onClick={() => handleInvite(f)}
              title={currentRoomCode ? `邀请到 ${currentRoomCode}` : '不在房间中'}
            >邀请</button>
            <button style={styles.dangerBtn} onClick={() => handleRemove(f.userId)}>删除</button>
          </div>
        ))}
      </div>
    </aside>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#000',
    color: '#EDEDF0',
    border: '1px solid rgba(255,255,255,.1)',
    borderRadius: 12,
    padding: 12,
    width: 280,
    fontSize: 13,
  },
  title: { margin: '0 0 8px', fontSize: 14, color: '#FFD600' },
  error: { color: '#ff6b6b', marginBottom: 8 },
  section: { marginTop: 8 },
  sectionTitle: { color: '#4fb3a5', marginBottom: 4 },
  empty: { color: 'rgba(237,237,240,.4)', padding: 8 },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,.05)' },
  requestRow: { display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0' },
  dot: { width: 8, height: 8, borderRadius: 4, display: 'inline-block' },
  name: { flex: 1 },
  status: { color: 'rgba(237,237,240,.5)', fontSize: 11 },
  iconBtn: { background: 'transparent', border: '1px solid #4fb3a5', color: '#4fb3a5', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  acceptBtn: { background: '#4fb3a5', border: 'none', color: '#000', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  rejectBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,.3)', color: '#EDEDF0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  dangerBtn: { background: 'transparent', border: '1px solid rgba(255,107,107,.5)', color: '#ff6b6b', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
}

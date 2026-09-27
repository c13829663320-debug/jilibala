// ===== R5: 通知中心 =====
// 聚合：好友请求 + 组队邀请（含离线补发）+ 系统通知（好友上下线等）。
// 已读/未读状态持久化 localStorage；红点角标显示未读数。
import { useEffect, useMemo, useState } from 'react'
import type { FriendRequest, PartyInvite } from '@balabala/shared'

export interface SystemNotification {
  id: string
  text: string
  at: number
}

export interface NotificationCenterProps {
  friendRequests: FriendRequest[]
  partyInvites: PartyInvite[]
  system: SystemNotification[]
  onAcceptRequest?: (req: FriendRequest) => void
  onRejectRequest?: (req: FriendRequest) => void
  onAcceptPartyInvite?: (invite: PartyInvite) => void
  onDeclinePartyInvite?: (invite: PartyInvite) => void
}

const READ_KEY = 'balabala_notifications_read_v1'

function loadRead(): Set<string> {
  try {
    const raw = localStorage.getItem(READ_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}

export function NotificationCenter(props: NotificationCenterProps) {
  const { friendRequests, partyInvites, system } = props
  const [open, setOpen] = useState(false)
  const [readIds, setReadIds] = useState<Set<string>>(loadRead)

  const allIds = useMemo(() => {
    const s = new Set<string>()
    friendRequests.forEach((r) => s.add(`req:${r.requestId}`))
    partyInvites.forEach((i) => s.add(`inv:${i.inviteId}`))
    system.forEach((n) => s.add(`sys:${n.id}`))
    return s
  }, [friendRequests, partyInvites, system])

  const unread = useMemo(() => {
    let n = 0
    for (const id of allIds) if (!readIds.has(id)) n++
    return n
  }, [allIds, readIds])

  // 打开时全部标记已读
  useEffect(() => {
    if (!open) return
    setReadIds((prev) => {
      const next = new Set(prev)
      for (const id of allIds) next.add(id)
      try { localStorage.setItem(READ_KEY, JSON.stringify([...next])) } catch { /* noop */ }
      return next
    })
  }, [open, allIds])

  return (
    <div style={styles.wrap}>
      <button style={styles.bell} onClick={() => setOpen((o) => !o)} title="通知中心">
        🔔
        {unread > 0 && <span style={styles.badge}>{unread > 99 ? '99+' : unread}</span>}
      </button>

      {open && (
        <div style={styles.panel}>
          <div style={styles.header}>通知中心</div>

          {partyInvites.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>组队邀请 {partyInvites.length}</div>
              {partyInvites.map((inv) => (
                <div key={inv.inviteId} style={styles.row}>
                  <span style={styles.text}>{inv.fromNickname} 邀你组队{inv.message ? `：${inv.message}` : ''}</span>
                  <button style={styles.primaryBtn} onClick={() => props.onAcceptPartyInvite?.(inv)}>加入</button>
                  <button style={styles.ghostBtn} onClick={() => props.onDeclinePartyInvite?.(inv)}>忽略</button>
                </div>
              ))}
            </div>
          )}

          {friendRequests.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>好友请求 {friendRequests.length}</div>
              {friendRequests.map((r) => (
                <div key={r.requestId} style={styles.row}>
                  <span style={styles.text}>{r.fromNickname} 请求加好友</span>
                  <button style={styles.primaryBtn} onClick={() => props.onAcceptRequest?.(r)}>接受</button>
                  <button style={styles.ghostBtn} onClick={() => props.onRejectRequest?.(r)}>拒绝</button>
                </div>
              ))}
            </div>
          )}

          {system.length > 0 && (
            <div style={styles.section}>
              <div style={styles.sectionTitle}>系统通知</div>
              {system.map((n) => (
                <div key={n.id} style={styles.row}>
                  <span style={styles.text}>{n.text}</span>
                </div>
              ))}
            </div>
          )}

          {friendRequests.length === 0 && partyInvites.length === 0 && system.length === 0 && (
            <div style={styles.empty}>暂无通知</div>
          )}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-block' },
  bell: { background: 'transparent', border: 'none', fontSize: 18, cursor: 'pointer', position: 'relative' },
  badge: {
    position: 'absolute', top: -4, right: -6, background: '#ff6b6b', color: '#fff',
    borderRadius: 999, fontSize: 10, padding: '0 5px', minWidth: 16, textAlign: 'center',
  },
  panel: {
    position: 'absolute', right: 0, top: 28, width: 280, maxHeight: 360, overflowY: 'auto',
    background: '#000', color: '#EDEDF0', border: '1px solid rgba(255,255,255,.12)',
    borderRadius: 12, padding: 10, fontSize: 12, zIndex: 50,
  },
  header: { color: '#FFD600', fontWeight: 600, marginBottom: 6 },
  section: { marginTop: 6 },
  sectionTitle: { color: '#4fb3a5', marginBottom: 2 },
  row: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0' },
  text: { flex: 1 },
  empty: { color: 'rgba(237,237,240,.4)', padding: 8, textAlign: 'center' },
  primaryBtn: { background: '#4fb3a5', border: 'none', color: '#000', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
  ghostBtn: { background: 'transparent', border: '1px solid rgba(255,255,255,.3)', color: '#EDEDF0', borderRadius: 6, padding: '2px 8px', cursor: 'pointer', fontSize: 11 },
}

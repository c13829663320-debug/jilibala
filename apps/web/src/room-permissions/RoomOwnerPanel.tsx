// R4-02: 房主控制面板——踢人 / 转移房主 / 锁房间
import { useState } from 'react'
import { Crown, UserX, ArrowRightLeft, Lock, Unlock, Loader2 } from 'lucide-react'

export interface RoomPlayer {
  userId: string
  nickname: string
  isOwner?: boolean
}

export default function RoomOwnerPanel({ roomCode, currentUserId, players, onKicked }: {
  roomCode: string
  currentUserId: string
  players: RoomPlayer[]
  onKicked?: (targetUserId: string, reason: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState('')
  const [lockState, setLockState] = useState(false)
  const [msg, setMsg] = useState('')

  const otherPlayers = players.filter((p) => p.userId !== currentUserId)

  const callApi = async (path: string, body: Record<string, unknown>): Promise<boolean> => {
    try {
      const res = await fetch(`/api/rooms/${encodeURIComponent(roomCode)}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, callerId: currentUserId }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as { error?: string }
        setMsg(err.error ?? '操作失败')
        return false
      }
      return true
    } catch {
      setMsg('网络错误')
      return false
    }
  }

  const handleKick = async (targetUserId: string, nickname: string) => {
    setBusy(`kick:${targetUserId}`)
    setMsg('')
    const ok = await callApi('/kick', { targetUserId, reason: `被房主移出（${nickname}）` })
    if (ok) {
      setMsg(`已踢出 ${nickname}`)
      onKicked?.(targetUserId, `你被房主移出了房间`)
    }
    setBusy('')
  }

  const handleTransfer = async (targetUserId: string, nickname: string) => {
    if (!window.confirm(`确定将房主转移给 ${nickname}？转移后你将不再是房主。`)) return
    setBusy(`transfer:${targetUserId}`)
    setMsg('')
    const ok = await callApi('/transfer-owner', { targetUserId })
    if (ok) setMsg(`房主已转移给 ${nickname}`)
    setBusy('')
  }

  const handleLock = async () => {
    setBusy('lock')
    setMsg('')
    const next = !lockState
    const ok = await callApi('/lock', { locked: next })
    if (ok) {
      setLockState(next)
      setMsg(next ? '房间已锁定' : '房间已解锁')
    }
    setBusy('')
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        style={{
          position: 'fixed', bottom: 80, right: 16, zIndex: 100,
          background: '#FFD600', color: '#000', border: 'none',
          borderRadius: 24, padding: '10px 16px', fontSize: 13,
          cursor: 'pointer', fontWeight: 700, boxShadow: '0 2px 8px rgba(0,0,0,0.4)',
        }}
      >
        <Crown size={14} style={{ verticalAlign: '-2px', marginRight: 4 }} />
        房主面板
      </button>
    )
  }

  return (
    <div style={{
      position: 'fixed', bottom: 80, right: 16, zIndex: 100,
      background: '#1a1a1a', border: '1px solid #333', borderRadius: 12,
      padding: 16, width: 260, color: '#fff',
      boxShadow: '0 4px 20px rgba(0,0,0,0.5)',
    }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <b style={{ fontSize: 14 }}><Crown size={14} color="#FFD600" /> 房主控制面板</b>
        <button onClick={() => setOpen(false)} style={{ background: 'none', border: 'none', color: '#888', cursor: 'pointer', fontSize: 16 }}>×</button>
      </div>

      {/* 锁房开关 */}
      <button
        onClick={handleLock}
        disabled={busy === 'lock'}
        style={{
          width: '100%', marginBottom: 12, padding: '8px 12px',
          background: lockState ? '#ff6b6b' : '#333', color: '#fff',
          border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 13,
        }}
      >
        {busy === 'lock' ? <Loader2 size={13} className="animate-spin" /> : lockState ? <Unlock size={13} /> : <Lock size={13} />}
        {' '}{lockState ? '解锁房间' : '锁定房间'}
      </button>

      {/* 玩家列表 */}
      <div style={{ fontSize: 12, color: '#888', marginBottom: 6 }}>
        在线玩家（{otherPlayers.length} 人可操作）
      </div>
      <div style={{ maxHeight: 180, overflowY: 'auto' }}>
        {otherPlayers.length === 0 && (
          <div style={{ color: '#666', fontSize: 12, padding: '8px 0' }}>暂无其他玩家</div>
        )}
        {otherPlayers.map((p) => (
          <div key={p.userId} style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '6px 0', borderBottom: '1px solid #222',
          }}>
            <span style={{ fontSize: 13 }}>{p.nickname}</span>
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                onClick={() => handleKick(p.userId, p.nickname)}
                disabled={busy.startsWith('kick')}
                title="踢出房间"
                style={{
                  background: '#ff444422', border: '1px solid #ff4444', color: '#ff4444',
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11,
                }}
              >
                {busy === `kick:${p.userId}` ? <Loader2 size={11} className="animate-spin" /> : <UserX size={11} />}
              </button>
              <button
                onClick={() => handleTransfer(p.userId, p.nickname)}
                disabled={busy.startsWith('transfer')}
                title="转移房主"
                style={{
                  background: '#FFD60022', border: '1px solid #FFD600', color: '#FFD600',
                  borderRadius: 6, padding: '3px 8px', cursor: 'pointer', fontSize: 11,
                }}
              >
                {busy === `transfer:${p.userId}` ? <Loader2 size={11} className="animate-spin" /> : <ArrowRightLeft size={11} />}
              </button>
            </div>
          </div>
        ))}
      </div>

      {msg && <div style={{ marginTop: 8, fontSize: 12, color: '#4fb3a5' }}>{msg}</div>}
    </div>
  )
}

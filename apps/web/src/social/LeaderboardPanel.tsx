// ===== R4-08: 全服/场景段位排行榜面板 =====
// Tab 切换 全服 / 法庭 / 狼人杀 / 酒吧，显示前 20 名，高亮当前玩家排名。
// 数据来自 GET /api/leaderboard?scope=&limit=&userId=。
import { useCallback, useEffect, useState } from 'react'
import type { LeaderboardEntry, LeaderboardScope } from '@balabala/shared'
import { apiGetJson } from '../lib/api-client'

const SCOPES: Array<{ id: LeaderboardScope; label: string; emoji: string }> = [
  { id: 'global', label: '全服', emoji: '🏆' },
  { id: 'court', label: '法庭', emoji: '⚖️' },
  { id: 'werewolf', label: '狼人杀', emoji: '🐺' },
  { id: 'bar', label: '酒吧', emoji: '🍺' },
]

const TIER_COLOR: Record<LeaderboardEntry['tier'], string> = {
  rookie: '#9e9e9e',
  bronze: '#cd7f32',
  silver: '#c0c0c0',
  gold: '#FFD600',
  platinum: '#4fb3a5',
}

interface Props {
  /** 当前玩家 userId，用于高亮其名次（不在前 20 时底部单独显示）。 */
  currentUserId?: string
  /** 关闭按钮回调（可选）。 */
  onClose?: () => void
}

interface LeaderboardResponse {
  scope: LeaderboardScope
  entries: LeaderboardEntry[]
  me?: { rank: number; entry?: LeaderboardEntry }
}

export default function LeaderboardPanel({ currentUserId, onClose }: Props) {
  const [scope, setScope] = useState<LeaderboardScope>('global')
  const [data, setData] = useState<LeaderboardResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async (s: LeaderboardScope) => {
    setLoading(true)
    setError(null)
    try {
      const q = new URLSearchParams({ scope: s, limit: '20' })
      if (currentUserId) q.set('userId', currentUserId)
      const res = await apiGetJson<LeaderboardResponse>(`/api/leaderboard?${q.toString()}`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败')
    } finally {
      setLoading(false)
    }
  }, [currentUserId])

  useEffect(() => {
    void load(scope)
  }, [scope, load])

  return (
    <div style={styles.panel}>
      <div style={styles.header}>
        <span style={styles.title}>🏆 排行榜</span>
        {onClose && (
          <button style={styles.closeBtn} onClick={onClose} aria-label="关闭">×</button>
        )}
      </div>
      <div style={styles.tabs}>
        {SCOPES.map((s) => (
          <button
            key={s.id}
            onClick={() => setScope(s.id)}
            style={{
              ...styles.tab,
              ...(scope === s.id ? stylesTabActive : {}),
            }}
          >
            <span style={styles.tabEmoji}>{s.emoji}</span>
            {s.label}
          </button>
        ))}
      </div>

      {loading && <div style={styles.state}>加载中…</div>}
      {error && <div style={styles.stateErr}>{error}</div>}
      {data && data.entries.length === 0 && !loading && (
        <div style={styles.state}>暂无数据，快去玩一局上榜吧！</div>
      )}

      <ol style={styles.list}>
        {data?.entries.map((e) => {
          const isMe = e.userId === currentUserId
          return (
            <li key={e.userId} style={{ ...styles.row, ...(isMe ? stylesRowMe : {}) }}>
              <span style={{ ...styles.rank, color: e.rank <= 3 ? '#FFD600' : '#888' }}>
                {e.rank}
              </span>
              <span style={styles.avatar}>{e.nickname.slice(0, 1)}</span>
              <span style={styles.nick}>{e.nickname}</span>
              <span style={{ ...styles.tier, color: TIER_COLOR[e.tier] }}>{e.tier}</span>
              <span style={styles.score}>{e.score} 分</span>
            </li>
          )
        })}
      </ol>

      {data?.me && data.entries.every((e) => e.userId !== currentUserId) && (
        <div style={styles.meFooter}>
          我的排名：第 <b style={{ color: '#FFD600' }}>{data.me.rank}</b> 名
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  panel: {
    background: '#000',
    border: '1px solid #FFD600',
    borderRadius: 12,
    color: '#fff',
    width: 320,
    maxHeight: 480,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '10px 14px',
    borderBottom: '1px solid #333',
  },
  title: { color: '#FFD600', fontWeight: 700, fontSize: 15 },
  closeBtn: {
    background: 'transparent',
    border: 'none',
    color: '#888',
    fontSize: 20,
    cursor: 'pointer',
  },
  tabs: { display: 'flex', padding: '8px 10px', gap: 6 },
  tab: {
    flex: 1,
    background: '#111',
    border: '1px solid #333',
    color: '#aaa',
    borderRadius: 8,
    padding: '6px 0',
    fontSize: 12,
    cursor: 'pointer',
  },
  tabEmoji: { marginRight: 4 },
  state: { padding: 20, textAlign: 'center', color: '#888', fontSize: 13 },
  stateErr: { padding: 20, textAlign: 'center', color: '#ff6b6b', fontSize: 13 },
  list: { listStyle: 'none', margin: 0, padding: '0 8px 8px', overflowY: 'auto' },
  row: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 8px',
    borderRadius: 6,
  },
  rank: { width: 22, fontWeight: 700, fontSize: 13 },
  avatar: {
    width: 24,
    height: 24,
    borderRadius: '50%',
    background: '#4fb3a5',
    color: '#000',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 12,
    fontWeight: 700,
  },
  nick: { flex: 1, fontSize: 13, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
  tier: { fontSize: 11, width: 56 },
  score: { fontSize: 12, color: '#FFD600' },
  meFooter: {
    padding: '8px 14px',
    borderTop: '1px solid #333',
    fontSize: 12,
    color: '#ccc',
  },
}

const stylesTabActive: React.CSSProperties = {
  background: '#FFD600',
  color: '#000',
  borderColor: '#FFD600',
  fontWeight: 700,
}

const stylesRowMe: React.CSSProperties = {
  background: 'rgba(255,214,0,0.12)',
  outline: '1px solid #FFD600',
}

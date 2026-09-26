// ===== R4-08: 广场顶部活动公告横幅 =====
// 明黄底黑字，可横向滚动；点击跳转对应主题房间（调用 onJoinRoom）。
// 数据来自 GET /api/announcements。
import { useEffect, useState } from 'react'
import type { Announcement } from '@balabala/shared'
import { apiGetJson } from '../lib/api-client'

interface Props {
  /** 点击公告跳转加入房间 */
  onJoinRoom?: (roomCode: string) => void
  /** 拉取间隔 ms（默认 60s） */
  pollMs?: number
}

export default function AnnouncementBanner({ onJoinRoom, pollMs = 60_000 }: Props) {
  const [items, setItems] = useState<Announcement[]>([])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        const res = await apiGetJson<{ announcements: Announcement[] }>('/api/announcements')
        if (!cancelled) setItems(res.announcements ?? [])
      } catch {
        /* 静默：横幅拉取失败不影响主流程 */
      }
    }
    void load()
    const t = setInterval(load, pollMs)
    return () => {
      cancelled = true
      clearInterval(t)
    }
  }, [pollMs])

  if (items.length === 0) return null

  return (
    <div style={styles.bar} role="region" aria-label="活动公告">
      <span style={styles.badge}>📣 活动</span>
      <div style={styles.scroller}>
        {items.map((a) => (
          <button
            key={a.id}
            style={styles.item}
            onClick={() => a.roomCode && onJoinRoom?.(a.roomCode)}
            title={a.description}
          >
            <b style={styles.title}>{a.title}</b>
            <span style={styles.desc}>{a.description}</span>
            {a.tags.map((t) => (
              <span key={t} style={styles.tag}>{t}</span>
            ))}
            {a.roomCode && <span style={styles.join}>进入 →</span>}
          </button>
        ))}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    background: '#FFD600', // 明黄底
    color: '#000', // 黑字
    padding: '6px 12px',
    fontSize: 13,
    borderBottom: '1px solid #000',
  },
  badge: { fontWeight: 800, flexShrink: 0 },
  scroller: {
    display: 'flex',
    gap: 16,
    overflowX: 'auto',
    flex: 1,
    scrollbarWidth: 'thin',
  },
  item: {
    background: 'transparent',
    border: 'none',
    color: '#000',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    fontSize: 13,
    padding: '2px 0',
  },
  title: {},
  desc: { opacity: 0.75 },
  tag: {
    background: '#000',
    color: '#FFD600',
    borderRadius: 4,
    padding: '0 6px',
    fontSize: 11,
  },
  join: { marginLeft: 4, fontWeight: 700 },
}

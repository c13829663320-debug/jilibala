// 话题票选择：4 张卡，点选后才解锁上台。
import type { CSSProperties } from 'react'
import type { TopicOption } from './types'

export default function TopicPicker({
  topics,
  onPick,
  disabled,
}: {
  topics: TopicOption[]
  onPick: (topic: TopicOption) => void
  disabled?: boolean
}) {
  return (
    <div>
      <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)', marginBottom: 8, letterSpacing: 1 }}>
        选一张今晚的话题票
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {topics.map((t) => (
          <button
            key={t.id}
            disabled={disabled}
            onClick={() => onPick(t)}
            style={{
              ...card,
              cursor: disabled ? 'not-allowed' : 'pointer',
              opacity: disabled ? 0.5 : 1,
            }}
          >
            <div style={{ fontSize: 24 }}>{t.icon}</div>
            <div style={{ fontSize: 14, fontWeight: 800, color: '#FFD600' }}>{t.label}</div>
            <div style={{ fontSize: 10, color: 'rgba(237,237,240,0.5)', marginTop: 4, lineHeight: 1.4 }}>
              {t.subtopics.slice(0, 3).join(' · ')}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

const card: CSSProperties = {
  padding: '12px 10px',
  border: '1px solid rgba(255,214,0,0.25)',
  borderRadius: 12,
  background: 'linear-gradient(160deg, rgba(255,214,0,0.08), rgba(255,255,255,0.02))',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 4,
  transition: 'all 0.18s ease',
}

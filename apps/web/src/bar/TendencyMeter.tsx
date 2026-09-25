// AI 对手防御倾向仪表：上回合结束时揭示。揭示瞬间有淡入。
import type { StanceTendency } from './types'
import { TENDENCY_META } from './types'

export default function TendencyMeter({ tendency }: { tendency: StanceTendency | null }) {
  if (!tendency) {
    return (
      <div style={wrap}>
        <span style={{ fontSize: 11, color: 'rgba(237,237,240,0.4)' }}>对方倾向：尚未露出马脚…</span>
      </div>
    )
  }
  const meta = TENDENCY_META[tendency]
  return (
    <div style={{ ...wrap, borderColor: 'rgba(79,179,165,0.5)' }}>
      <span style={{ fontSize: 13 }}>{meta.emoji}</span>
      <span style={{ fontSize: 12, color: '#4fb3a5', fontWeight: 700 }}>对方倾向：{meta.label}</span>
      <span style={{ fontSize: 10, color: 'rgba(237,237,240,0.45)' }}>{meta.hint}</span>
    </div>
  )
}

const wrap: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '5px 10px',
  borderRadius: 999,
  border: '1px dashed rgba(255,255,255,0.15)',
  background: 'rgba(79,179,165,0.06)',
  animation: 'bar-fadein 0.4s ease',
}

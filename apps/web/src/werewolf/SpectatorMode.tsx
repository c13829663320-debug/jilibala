import { Ghost } from 'lucide-react'

/** Round2：出局后幽灵观战顶栏——可看全场、不能发言，不再干等。 */
export default function SpectatorMode({ day }: { day: number }) {
  return (
    <div style={{
      position: 'absolute', top: 52, left: '50%', transform: 'translateX(-50%)',
      zIndex: 30, display: 'flex', alignItems: 'center', gap: 8,
      padding: '6px 16px', borderRadius: 20,
      background: 'rgba(79,179,165,0.15)', border: '1px solid #4fb3a5',
      color: '#4fb3a5', fontSize: 13, fontWeight: 600, backdropFilter: 'blur(8px)',
    }}>
      <Ghost size={15} />
      你已出局 · 幽灵观战中（第 {day} 天）— 可看全场，不可发言，结束自动进复盘
    </div>
  )
}

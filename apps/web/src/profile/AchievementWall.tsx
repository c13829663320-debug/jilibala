// 成就徽章墙
import { ACHIEVEMENTS, type PlayerProfile } from './playerProfile'

const YELLOW = '#FFD600'

export default function AchievementWall({ profile }: { profile: PlayerProfile }) {
  const unlocked = new Set(profile.achievements)
  return (
    <div>
      <div style={{ fontSize: 12, color: '#9a9c92', marginBottom: 10 }}>
        已解锁 <b style={{ color: YELLOW }}>{unlocked.size}</b> / {ACHIEVEMENTS.length}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
        {ACHIEVEMENTS.map((a) => {
          const has = unlocked.has(a.id)
          return (
            <div key={a.id} style={{
              display: 'flex', alignItems: 'center', gap: 10, padding: 10, borderRadius: 12,
              background: has ? 'rgba(255,214,0,0.08)' : '#0d0d0d',
              border: has ? '1px solid rgba(255,214,0,0.4)' : '1px solid #222',
              opacity: has ? 1 : 0.55,
            }}>
              <span style={{ fontSize: 22, filter: has ? 'none' : 'grayscale(1)' }}>{a.icon}</span>
              <div>
                <div style={{ fontSize: 13, fontWeight: 700, color: has ? YELLOW : '#9a9c92' }}>{a.name}</div>
                <div style={{ fontSize: 11, color: '#9a9c92' }}>{a.desc}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// 玩家档案主卡：头像 + 昵称 + 等级 + XP 进度条 + 段位称号
import { Shield } from 'lucide-react'
import { getTierTitle, xpForLevel, type PlayerProfile } from './playerProfile'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

export default function PlayerProfileCard({ profile }: { profile: PlayerProfile }) {
  const tier = getTierTitle(profile.level)
  const need = xpForLevel(profile.level)
  const pct = profile.level >= 100 ? 100 : Math.min(100, Math.round((profile.xp / need) * 100))
  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid rgba(255,214,0,0.25)', borderRadius: 16,
      padding: 20, display: 'flex', gap: 16, alignItems: 'center',
    }}>
      <div style={{
        width: 64, height: 64, borderRadius: '50%', flexShrink: 0,
        background: `linear-gradient(135deg, ${YELLOW}, ${TEAL})`,
        display: 'grid', placeItems: 'center', fontSize: 28, fontWeight: 900, color: '#000',
      }}>
        {(profile.nickname || '我').trim().slice(0, 1).toUpperCase()}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <b style={{ fontSize: 20, color: '#f4f2ec' }}>{profile.nickname}</b>
          <span style={{
            background: YELLOW, color: '#000', fontSize: 12, fontWeight: 800,
            padding: '2px 8px', borderRadius: 999,
          }}>Lv.{profile.level}</span>
          <span style={{
            display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12,
            color: TEAL, fontWeight: 700,
          }}><Shield size={12} /> {tier}</span>
        </div>
        {/* XP 进度条 */}
        <div style={{ marginTop: 10 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9a9c92', marginBottom: 4 }}>
            <span>{profile.level >= 100 ? '已满级' : `${profile.xp} / ${need} XP`}</span>
            <span>累计 {profile.totalXp} XP</span>
          </div>
          <div style={{ height: 8, borderRadius: 999, background: '#1e1e1e', overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, background: `linear-gradient(90deg, ${TEAL}, ${YELLOW})`, transition: 'width .5s' }} />
          </div>
        </div>
      </div>
    </div>
  )
}

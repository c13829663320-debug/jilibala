// 每日挑战：当日随机场景 + 目标，完成奖励额外 XP
import { Target, CheckCircle2 } from 'lucide-react'
import { SCENE_LABEL, type PlayerProfile } from './playerProfile'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

export default function DailyChallengeCard({ profile }: { profile: PlayerProfile }) {
  const dc = profile.dailyChallenge
  if (!dc) return null
  const pct = dc.completed ? 100 : Math.min(100, Math.round((dc.progress / dc.target) * 100))
  return (
    <div style={{
      background: '#0d0d0d', border: '1px solid rgba(79,179,165,0.3)', borderRadius: 16,
      padding: 16, display: 'flex', alignItems: 'center', gap: 14,
    }}>
      <div style={{
        width: 44, height: 44, borderRadius: 12, flexShrink: 0,
        background: dc.completed ? 'rgba(255,214,0,0.15)' : 'rgba(79,179,165,0.12)',
        display: 'grid', placeItems: 'center', color: dc.completed ? YELLOW : TEAL,
      }}>
        {dc.completed ? <CheckCircle2 size={22} /> : <Target size={22} />}
      </div>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: '#f4f2ec' }}>
          每日挑战 · {SCENE_LABEL[dc.scene]}
        </div>
        <div style={{ fontSize: 12, color: '#9a9c92', marginTop: 2 }}>
          {dc.completed
            ? '今日已完成！奖励 +30 XP 已到账 🎉'
            : `在「${SCENE_LABEL[dc.scene]}」完成 ${dc.target} 局 · 进度 ${dc.progress}/${dc.target} · 奖励 +30 XP`}
        </div>
        <div style={{ height: 6, borderRadius: 999, background: '#1e1e1e', overflow: 'hidden', marginTop: 8 }}>
          <div style={{ height: '100%', width: `${pct}%`, background: dc.completed ? YELLOW : TEAL, transition: 'width .4s' }} />
        </div>
      </div>
    </div>
  )
}

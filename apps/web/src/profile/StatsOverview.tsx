// 战绩总览：总场次 / 胜率 / 最爱场景
import { SCENE_LABEL, type PlayerProfile } from './playerProfile'

const TEAL = '#4fb3a5'

export default function StatsOverview({ profile }: { profile: PlayerProfile }) {
  const { totalGames, wins, losses } = profile.stats
  const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0
  const fav = profile.stats.favoriteScene
  const items = [
    { label: '总场次', value: String(totalGames) },
    { label: '胜 / 负', value: `${wins} / ${losses}` },
    { label: '胜率', value: `${winRate}%` },
    { label: '最爱场景', value: fav ? SCENE_LABEL[fav] : '——' },
  ]
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10,
    }}>
      {items.map((it) => (
        <div key={it.label} style={{
          background: '#0d0d0d', border: '1px solid #222', borderRadius: 12,
          padding: '12px 10px', textAlign: 'center',
        }}>
          <div style={{ fontSize: 20, fontWeight: 900, color: '#f4f2ec', fontVariantNumeric: 'tabular-nums' }}>{it.value}</div>
          <div style={{ fontSize: 11, color: TEAL, marginTop: 2 }}>{it.label}</div>
        </div>
      ))}
    </div>
  )
}

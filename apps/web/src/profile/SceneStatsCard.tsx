// 6 场景各自战绩卡片：场次 / 胜场 / 最高分
import { SCENE_LABEL, type PlayerProfile, type SceneId } from './playerProfile'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

const SCENE_IDS: SceneId[] = ['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library']
const SCENE_EMOJI: Record<SceneId, string> = {
  court: '⚖️', talkshow: '🎤', werewolf: '🐺', bar: '🍸', gym: '💪', library: '📚',
}

export default function SceneStatsGrid({ profile }: { profile: PlayerProfile }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 10 }}>
      {SCENE_IDS.map((s) => {
        const st = profile.stats.perScene[s]
        const wr = st.played > 0 ? Math.round((st.wins / st.played) * 100) : 0
        return (
          <div key={s} style={{
            background: '#0d0d0d', border: '1px solid #222', borderRadius: 12, padding: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 18 }}>{SCENE_EMOJI[s]}</span>
              <b style={{ fontSize: 13, color: '#f4f2ec' }}>{SCENE_LABEL[s]}</b>
            </div>
            <div style={{ display: 'flex', gap: 12, fontSize: 12, color: '#9a9c92' }}>
              <span>场次 <b style={{ color: '#f4f2ec' }}>{st.played}</b></span>
              <span>胜 <b style={{ color: TEAL }}>{st.wins}</b></span>
              <span>胜率 <b style={{ color: YELLOW }}>{wr}%</b></span>
            </div>
            <div style={{ fontSize: 12, color: '#9a9c92', marginTop: 6 }}>
              最高分 <b style={{ color: YELLOW }}>{st.bestScore || '——'}</b>
            </div>
          </div>
        )
      })}
    </div>
  )
}

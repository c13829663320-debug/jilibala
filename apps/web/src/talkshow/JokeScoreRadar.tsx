// 三维度评分条：Punchline(0-40) / Pacing(0-30) / Resonance(0-30)。
import type { JokeDimensionScores } from './types'

const DIMS: Array<{ key: keyof JokeDimensionScores; label: string; max: number; color: string }> = [
  { key: 'punchline', label: 'Punchline 包袱', max: 40, color: '#FFD600' },
  { key: 'pacing', label: 'Pacing 节奏', max: 30, color: '#4fb3a5' },
  { key: 'resonance', label: 'Resonance 共鸣', max: 30, color: '#ff9d5c' },
]

export default function JokeScoreRadar({ scores, total }: { scores: JokeDimensionScores; total: number }) {
  return (
    <div style={{ padding: 12, background: 'rgba(255,214,0,0.05)', border: '1px solid rgba(255,214,0,0.3)', borderRadius: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8 }}>
        <span style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)' }}>三维度评分</span>
        <span style={{ fontSize: 22, fontWeight: 900, color: '#FFD600' }}>{total}<span style={{ fontSize: 12, color: 'rgba(237,237,240,0.4)' }}>/100</span></span>
      </div>
      {DIMS.map((d) => {
        const v = scores[d.key]
        const pct = Math.max(0, Math.min(100, (v / d.max) * 100))
        return (
          <div key={d.key} style={{ marginBottom: 6 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, marginBottom: 2 }}>
              <span style={{ color: 'rgba(237,237,240,0.75)' }}>{d.label}</span>
              <span style={{ color: d.color, fontWeight: 700 }}>{v}<span style={{ opacity: 0.5 }}>/{d.max}</span></span>
            </div>
            <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ width: `${pct}%`, height: '100%', background: d.color, transition: 'width 1s cubic-bezier(0.22,1,0.36,1)' }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

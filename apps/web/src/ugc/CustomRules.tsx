// ============================================================================
// CustomRules —— 自定义小游戏规则（表单式：回合数/胜利条件/人数）
// ============================================================================
import { useState } from 'react'
import { defaultRules, normalizeRules, validateRules, type UgcGameRules, type WinCondition } from './ugcRules'

export interface CustomRulesProps {
  onApply: (rules: UgcGameRules) => void
}

const WIN_LABEL: Record<WinCondition, string> = {
  'most-points': '积分最高者胜',
  'first-to-finish': '最先到达终点胜',
  'survive': '坚持到最后者胜',
}

export default function CustomRules({ onApply }: CustomRulesProps) {
  const [rounds, setRounds] = useState(defaultRules().rounds)
  const [winCondition, setWin] = useState<WinCondition>('most-points')
  const [minP, setMinP] = useState(defaultRules().minPlayers)
  const [maxP, setMaxP] = useState(defaultRules().maxPlayers)

  const apply = () => {
    const normalized = normalizeRules({ rounds, winCondition, minPlayers: minP, maxPlayers: maxP })
    const errs = validateRules(normalized)
    if (errs.length > 0) return
    onApply(normalized)
  }

  return (
    <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16, color: '#eee', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>🎮 小游戏规则</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888' }}>回合数：{rounds}</div>
        <input type="range" min={1} max={20} value={rounds}
          onChange={(e) => setRounds(Number(e.target.value))} style={{ width: '100%' }} />
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>胜利条件</div>
        {(Object.keys(WIN_LABEL) as WinCondition[]).map((w) => (
          <label key={w} style={{ display: 'block', fontSize: 13, marginBottom: 4, cursor: 'pointer' }}>
            <input type="radio" name="win" checked={winCondition === w} onChange={() => setWin(w)} style={{ marginRight: 6 }} />
            {WIN_LABEL[w]}
          </label>
        ))}
      </div>

      <div style={{ marginBottom: 12, display: 'flex', gap: 12 }}>
        <label style={{ fontSize: 13 }}>最少人数
          <input type="number" min={1} max={8} value={minP} onChange={(e) => setMinP(Number(e.target.value))}
            style={{ width: 56, marginLeft: 6, background: '#0a0a0a', color: '#eee', border: '1px solid #333', borderRadius: 4, padding: 4 }} />
        </label>
        <label style={{ fontSize: 13 }}>最多人数
          <input type="number" min={1} max={8} value={maxP} onChange={(e) => setMaxP(Number(e.target.value))}
            style={{ width: 56, marginLeft: 6, background: '#0a0a0a', color: '#eee', border: '1px solid #333', borderRadius: 4, padding: 4 }} />
        </label>
      </div>

      <button onClick={apply} style={{
        width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
        background: '#4fb3a5', color: '#0a0a0a', fontWeight: 700, cursor: 'pointer',
      }}>应用规则</button>
    </div>
  )
}

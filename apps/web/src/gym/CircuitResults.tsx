// ===== M14：三关结算 · 总分 + 段位 + 打卡 =====
import { useEffect, useRef, useState } from 'react'
import { CIRCUIT_TIER_META, CIRCUIT_STATIONS, type CircuitTier, type R5StreakState, type StationResult } from '@balabala/shared'
import { submitGameResult } from '../profile'
import PlayAgainBar from '../gameplay/PlayAgainBar'
import { recordResult } from '../gameplay/streak'

interface Props {
  results: StationResult[]
  total: number
  tier: CircuitTier
  checking: boolean
  checked: boolean
  onCheckin: () => void
  onExit: () => void
  /** R5 再来一局：重开三关电路。 */
  onReplay?: () => void
}

const STATION_NAME = Object.fromEntries(CIRCUIT_STATIONS.map((s) => [s.kind, s.title])) as Record<string, string>

export default function CircuitResults({ results, total, tier, checking, checked, onCheckin, onExit, onReplay }: Props) {
  const meta = CIRCUIT_TIER_META[tier]
  // 全局档案上报一次：金/爆杆段位视为获胜，总分作为 bestScore。
  const won = tier === 'gold' || tier === 'explosive'
  const reportedRef = useRef(false)
  const [streak, setStreak] = useState<R5StreakState>({ current: 0, best: 0, lastPlayedAt: null })
  useEffect(() => {
    if (reportedRef.current) return
    reportedRef.current = true
    submitGameResult('gym', { won, score: total })
    // R5 核心循环：记录健身房连胜。
    setStreak(recordResult('gym', won).outcome.streak)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  return (
    <div className="cc-center">
      <div className="cc-station-label">三关完成</div>
      <div className="cc-tier">{meta.emoji} {meta.label}</div>
      <div style={{ fontSize: 52, fontWeight: 900, color: '#ffd600', fontVariantNumeric: 'tabular-nums' }}>{total}</div>
      <div style={{ color: 'rgba(237,237,240,0.55)', fontSize: 13, marginBottom: 18 }}>总分（反应 + 节奏 + 力量）</div>

      {results.map((r) => (
        <div key={r.kind} className="cc-result-row">
          <span>{STATION_NAME[r.kind]}</span>
          <span style={{ fontWeight: 800, color: '#ffd600' }}>{r.score}</span>
        </div>
      ))}

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button className="cc-btn" disabled={checking || checked} onClick={onCheckin}>
          {checked ? '✓ 已打卡' : checking ? '打卡中…' : '完成打卡'}
        </button>
        <button className="cc-btn--ghost cc-btn" onClick={onExit}>返回健身房</button>
      </div>
      {checked && <div style={{ marginTop: 10, fontSize: 12, color: '#4fb3a5' }}>连续天数已累计，教练金句已记录。</div>}

      {/* R5 统一再来一局条：连胜钩子 + 高光（总分） */}
      {onReplay && (
        <PlayAgainBar
          streak={streak}
          highlight={`三关总分 ${total} · ${meta.label}`}
          onPlayAgain={onReplay}
          playAgainLabel="再来一组"
        />
      )}
    </div>
  )
}

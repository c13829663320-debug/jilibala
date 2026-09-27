// ============================================================================
// R5 统一「再来一局」条：连胜钩子 + 高光一句话 + 再来一局主按钮。
// 各玩法结算面板底部统一使用此条，保证留存手感一致。
// ============================================================================
import { Flame, RotateCcw, Zap } from 'lucide-react'
import type { R5StreakState } from '@balabala/shared'
import { streakHint } from './streak'

const YELLOW = '#FFD600'
const TEAL = '#4fb3a5'

export default function PlayAgainBar({
  streak,
  highlight,
  onPlayAgain,
  playAgainLabel = '再来一局',
}: {
  /** 本局结算后的连胜快照。 */
  streak: R5StreakState
  /** 即时高光一句话（可选）。 */
  highlight?: string
  onPlayAgain: () => void
  playAgainLabel?: string
}) {
  const hot = streak.current >= 2
  return (
    <div
      style={{
        marginTop: 18,
        padding: '14px 16px',
        borderRadius: 14,
        background: 'rgba(255,214,0,0.06)',
        border: '1px solid rgba(255,214,0,0.25)',
      }}
    >
      {highlight && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: TEAL, marginBottom: 8 }}>
          <Zap size={13} />
          <span>{highlight}</span>
        </div>
      )}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, fontSize: 13, color: 'rgba(237,237,240,0.75)' }}>
        {hot && <Flame size={14} color={YELLOW} />}
        <span>{streakHint(streak)}</span>
      </div>
      <button
        type="button"
        onClick={onPlayAgain}
        style={{
          width: '100%',
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 8,
          padding: '13px 0',
          borderRadius: 10,
          border: 'none',
          cursor: 'pointer',
          fontSize: 15,
          fontWeight: 800,
          background: YELLOW,
          color: '#000',
        }}
      >
        <RotateCcw size={16} />
        {playAgainLabel}
      </button>
    </div>
  )
}

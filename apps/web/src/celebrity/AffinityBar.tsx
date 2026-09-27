// ===== R5: 好感度进度条 =====
import { ACQUAINTANCE_LEVEL_LABEL, type AcquaintanceLevel } from '@balabala/shared'

const LEVEL_COLOR: Record<AcquaintanceLevel, string> = {
  stranger: '#8a8a8a',
  acquainted: '#4fb3a5',
  friend: '#5b8cff',
  confidant: '#c07bff',
}

export interface AffinityBarProps {
  /** 好感度 0–100。 */
  affection: number
  level: AcquaintanceLevel
  /** 紧凑模式（图鉴/小卡片）。 */
  compact?: boolean
}

export function AffinityBar({ affection, level, compact = false }: AffinityBarProps) {
  const pct = Math.max(0, Math.min(100, Math.round(affection)))
  const color = LEVEL_COLOR[level]
  return (
    <div style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: compact ? 11 : 12, marginBottom: 4 }}>
        <span style={{ color, fontWeight: 600 }}>{ACQUAINTANCE_LEVEL_LABEL[level]}</span>
        <span style={{ color: 'rgba(255,255,255,0.6)' }}>{pct}/100</span>
      </div>
      <div
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        style={{
          height: compact ? 6 : 8,
          borderRadius: 999,
          background: 'rgba(255,255,255,0.12)',
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            width: `${pct}%`,
            height: '100%',
            borderRadius: 999,
            background: color,
            transition: 'width .4s ease',
          }}
        />
      </div>
    </div>
  )
}

export default AffinityBar

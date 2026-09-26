// 攻击角度选择卡：3 张卡，点选后输入框才解锁。选中有翻转高亮动画。
import type { CSSProperties } from 'react'
import type { ArgumentAngle } from './types'
import { ANGLE_META } from './types'

const ORDER: ArgumentAngle[] = ['data', 'emotion', 'logic']

export default function AngleChooser({
  selected,
  onSelect,
  disabled,
}: {
  selected: ArgumentAngle | null
  onSelect: (angle: ArgumentAngle) => void
  disabled?: boolean
}) {
  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 12, color: 'rgba(237,237,240,0.55)', marginBottom: 6, letterSpacing: 1 }}>
        本回合选一个攻击角度（猜对方倾向）
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        {ORDER.map((angle) => {
          const meta = ANGLE_META[angle]
          const active = selected === angle
          return (
            <button
              key={angle}
              disabled={disabled}
              onClick={() => onSelect(angle)}
              style={{
                ...card,
                borderColor: active ? '#FFD600' : 'rgba(255,255,255,0.12)',
                background: active
                  ? 'linear-gradient(160deg, rgba(255,214,0,0.22), rgba(255,214,0,0.05))'
                  : 'rgba(255,255,255,0.03)',
                boxShadow: active ? '0 0 14px rgba(255,214,0,0.35)' : 'none',
                transform: active ? 'translateY(-2px)' : 'none',
                cursor: disabled ? 'not-allowed' : 'pointer',
                opacity: disabled ? 0.5 : 1,
              }}
            >
              <div style={{ fontSize: 22 }}>{meta.emoji}</div>
              <div style={{ fontSize: 13, fontWeight: 700, color: active ? '#FFD600' : '#EDEDF0' }}>
                {meta.title}
              </div>
              <div style={{ fontSize: 10, color: 'rgba(237,237,240,0.45)', marginTop: 2 }}>{meta.sub}</div>
            </button>
          )
        })}
      </div>
    </div>
  )
}

const card: CSSProperties = {
  flex: 1,
  padding: '10px 6px',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  gap: 2,
  transition: 'all 0.18s ease',
}

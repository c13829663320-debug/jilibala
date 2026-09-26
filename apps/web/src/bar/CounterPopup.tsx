// 克制/被克飘字：回合结算时从强度条上方浮起。
import { useEffect, useState } from 'react'
import type { AngleEffectiveness } from './types'
import { EFFECTIVENESS_META } from './types'

export interface PopupData {
  effectiveness: AngleEffectiveness
  /** 每次触发换 key，重新播放动画。 */
  key: number
}

export default function CounterPopup({ popup }: { popup: PopupData | null }) {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!popup) return
    setVisible(true)
    const t = window.setTimeout(() => setVisible(false), 1400)
    return () => window.clearTimeout(t)
  }, [popup])

  if (!popup || !visible) return null
  const meta = EFFECTIVENESS_META[popup.effectiveness]
  return (
    <div
      key={popup.key}
      style={{
        position: 'absolute',
        left: '50%',
        top: 0,
        transform: 'translateX(-50%)',
        padding: '6px 16px',
        borderRadius: 999,
        background: 'rgba(0,0,0,0.85)',
        border: `1px solid ${meta.color}`,
        color: meta.color,
        fontSize: 16,
        fontWeight: 800,
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
        animation: 'bar-floatup 1.4s ease forwards',
        textShadow: `0 0 12px ${meta.color}`,
        zIndex: 20,
      }}
    >
      {meta.label} 角度 +{meta.delta}
    </div>
  )
}

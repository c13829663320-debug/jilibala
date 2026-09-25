// 观众音浪柱形动画：reaction 映射整体高度，柱体随机抖动。
import { useEffect, useMemo, useState } from 'react'
import type { Reaction } from './types'
import { REACTION_META } from './types'

const BARS = 14

export default function AudienceWave({ reaction, active }: { reaction: Reaction; active: boolean }) {
  const meta = REACTION_META[reaction]
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => setTick((x) => x + 1), 180)
    return () => window.clearInterval(t)
  }, [active])

  const heights = useMemo(() => {
    // 以 wave 强度为基准，加一点伪随机抖动（随 tick 变化）。
    const base = meta.wave
    return Array.from({ length: BARS }, (_, i) => {
      const wobble = Math.abs(Math.sin(i * 1.7 + tick * 0.9)) * 0.35
      return Math.max(0.06, Math.min(1, base + wobble * base))
    })
  }, [meta.wave, tick])

  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height: 56, padding: '4px 2px' }}>
      {heights.map((h, i) => (
        <div
          key={i}
          style={{
            flex: 1,
            height: `${h * 100}%`,
            background: meta.color,
            borderRadius: 2,
            opacity: 0.55 + h * 0.45,
            transition: 'height 0.18s ease',
          }}
        />
      ))}
    </div>
  )
}

// 60 秒倒计时圆环，最后 10 秒变红。到时自动 onTimeout。
import { useEffect, useRef, useState } from 'react'

const TOTAL = 60
const WARN_AT = 10

export default function JokeTimer({
  onTimeout,
  resetKey,
}: {
  /** 倒计时归零时触发（父组件可自动提交）。 */
  onTimeout?: () => void
  /** 每段段子换一个 key，重新开始 60s。 */
  resetKey: string | number
}) {
  const [left, setLeft] = useState(TOTAL)
  const firedRef = useRef(false)

  useEffect(() => {
    setLeft(TOTAL)
    firedRef.current = false
  }, [resetKey])

  useEffect(() => {
    const t = window.setInterval(() => {
      setLeft((v) => {
        if (v <= 1) {
          window.clearInterval(t)
          if (!firedRef.current) {
            firedRef.current = true
            onTimeout?.()
          }
          return 0
        }
        return v - 1
      })
    }, 1000)
    return () => window.clearInterval(t)
  }, [resetKey, onTimeout])

  const danger = left <= WARN_AT
  const R = 16
  const C = 2 * Math.PI * R
  const ratio = left / TOTAL
  const color = danger ? '#ff4d4f' : '#FFD600'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <svg width={40} height={40} viewBox="0 0 40 40">
        <circle cx={20} cy={20} r={R} fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth={3} />
        <circle
          cx={20} cy={20} r={R} fill="none"
          stroke={color} strokeWidth={3} strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - ratio)}
          transform="rotate(-90 20 20)"
          style={{ transition: 'stroke-dashoffset 1s linear, stroke 0.3s' }}
        />
        <text x={20} y={24} textAnchor="middle" fontSize={12} fontWeight={800} fill={color}>
          {left}
        </text>
      </svg>
      <span style={{ fontSize: 11, color: danger ? '#ff4d4f' : 'rgba(237,237,240,0.5)' }}>
        {danger ? '时间快到了！' : '限时 60 秒'}
      </span>
    </div>
  )
}

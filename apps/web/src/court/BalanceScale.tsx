// BalanceScale：顶部天平条（黑底 + 明黄原告 + 青绿被告），滑动动画 + 最近 delta 飘字。
import { useEffect, useState } from 'react'

export type Balance = { plaintiff: number; defendant: number }

const CARD_COLOR = '#FFD600'
const DEF_COLOR = '#4fb3a5'

export default function BalanceScale({
  balance,
  lastDelta,
  reason,
  playerSide,
}: {
  balance: Balance
  lastDelta: number
  reason: string
  playerSide?: 'plaintiff' | 'defendant'
}) {
  const [float, setFloat] = useState<{ delta: number; key: number } | null>(null)

  useEffect(() => {
    if (!lastDelta) return
    setFloat({ delta: lastDelta, key: Date.now() })
    const t = window.setTimeout(() => setFloat(null), 1400)
    return () => window.clearTimeout(t)
  }, [lastDelta, balance.plaintiff])

  const deltaToPlayer = playerSide === 'defendant' ? -lastDelta : lastDelta

  return (
    <div className="balance-scale" aria-label="庭审天平">
      <div className="balance-scale__row">
        <span className="balance-scale__side" style={{ color: CARD_COLOR }}>原告 {balance.plaintiff}</span>
        <div className="balance-scale__track">
          <div
            className="balance-scale__fill"
            style={{ width: `${balance.plaintiff}%`, background: `linear-gradient(90deg, ${CARD_COLOR} 0%, ${CARD_COLOR} ${balance.plaintiff}%, ${DEF_COLOR} ${balance.plaintiff}%, ${DEF_COLOR} 100%)` }}
          />
          <div className="balance-scale__pivot" style={{ left: `${balance.plaintiff}%` }} />
        </div>
        <span className="balance-scale__side" style={{ color: DEF_COLOR }}>{balance.defendant} 被告</span>
      </div>
      {float && (
        <div key={float.key} className={`balance-scale__float ${deltaToPlayer >= 0 ? 'is-up' : 'is-down'}`}>
          {deltaToPlayer >= 0 ? `+${deltaToPlayer}` : `${deltaToPlayer}`} · {reason}
        </div>
      )}
    </div>
  )
}

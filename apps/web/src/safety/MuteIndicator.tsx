// ===== R5 发布域：MuteIndicator —— 被禁言时的倒计时浮标 =====
// 订阅 moderation-bus：收到 mute_status(muted=true) 后显示剩余禁言秒数；到期自动消失。
import { useEffect, useState } from 'react'
import { subscribeModeration, type MuteState } from './moderation-bus'

function secondsLeft(mutedUntil?: number): number {
  if (!mutedUntil) return 0
  return Math.max(0, Math.ceil((mutedUntil - Date.now()) / 1000))
}

export function MuteIndicator() {
  const [mute, setMute] = useState<MuteState>({ muted: false })
  const [left, setLeft] = useState(0)

  useEffect(() => subscribeModeration((s) => setMute(s.mute)), [])

  useEffect(() => {
    if (!mute.muted) {
      setLeft(0)
      return
    }
    setLeft(secondsLeft(mute.mutedUntil))
    const t = window.setInterval(() => {
      const s = secondsLeft(mute.mutedUntil)
      setLeft(s)
      if (s <= 0) setMute((m) => ({ ...m, muted: false }))
    }, 1000)
    return () => window.clearInterval(t)
  }, [mute.muted, mute.mutedUntil])

  if (!mute.muted || left <= 0) return null
  const reasonText = mute.reason === 'profanity' ? '因多次发送违规内容' : '因违规行为'
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        top: 64,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'rgba(120,30,30,0.95)',
        color: '#fff',
        border: '1px solid rgba(255,120,120,0.5)',
        borderRadius: 10,
        padding: '10px 16px',
        fontSize: 13,
        lineHeight: 1.4,
        boxShadow: '0 4px 18px rgba(0,0,0,0.4)',
        pointerEvents: 'none',
        maxWidth: '80vw',
        textAlign: 'center',
      }}
    >
      🔇 {reasonText}已被禁言，剩余 {left} 秒，期间无法发言/喊话
    </div>
  )
}

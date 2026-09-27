// ===== R5 发布域：ModerationToast —— 命中敏感词时的轻提示 =====
// 订阅 moderation-bus：本地发送命中 / 服务端过滤后，弹出「内容包含敏感词已替换」。
// 自包含、自消失；不依赖外部 CSS。
import { useEffect, useState } from 'react'
import { subscribeModeration } from './moderation-bus'

const TOAST_DURATION_MS = 3200

export function ModerationToast() {
  const [visible, setVisible] = useState(false)
  const [lastAt, setLastAt] = useState(0)

  useEffect(() => {
    return subscribeModeration((s) => {
      if (s.lastHitAt && s.lastHitAt !== lastAt) {
        setLastAt(s.lastHitAt)
        setVisible(true)
      }
    })
  }, [lastAt])

  useEffect(() => {
    if (!visible) return
    const t = window.setTimeout(() => setVisible(false), TOAST_DURATION_MS)
    return () => window.clearTimeout(t)
  }, [visible, lastAt])

  if (!visible) return null
  return (
    <div
      role="status"
      style={{
        position: 'fixed',
        bottom: 88,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        background: 'rgba(20,20,20,0.92)',
        color: '#ffd54a',
        border: '1px solid rgba(255,213,74,0.4)',
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
      ⚠️ 内容包含敏感词，已自动替换为 ***
    </div>
  )
}

// ===== EmoteWheel：表情动作轮盘 UI =====
// 一个按钮，点击展开圆形轮盘，7 个动作（wave/nod/shake/point/clap/laugh/surprised）。
// 选中后回调 onSelect(emote)，由 Plaza3D 通过 useEmote 发 WS。
// 样式：半透明深色背景，青色 #4fb3a5 高亮，与广场现有 UI 一致。
import { useState, useRef, useCallback } from 'react'
import type { EmoteType } from '@balabala/shared'

const EMOTES: Array<{ emote: EmoteType; emoji: string; label: string }> = [
  { emote: 'wave', emoji: '👋', label: '挥手' },
  { emote: 'nod', emoji: '👍', label: '点头' },
  { emote: 'shake', emoji: '👎', label: '摇头' },
  { emote: 'point', emoji: '👉', label: '指向' },
  { emote: 'clap', emoji: '👏', label: '鼓掌' },
  { emote: 'laugh', emoji: '😄', label: '大笑' },
  { emote: 'surprised', emoji: '😮', label: '惊讶' },
]

const RADIUS = 62 // 按钮环绕半径 px

interface EmoteWheelProps {
  onSelect: (emote: EmoteType) => void
}

export function EmoteWheel({ onSelect }: EmoteWheelProps) {
  const [open, setOpen] = useState(false)
  const [cooldown, setCooldown] = useState(false)
  const closeTimer = useRef<number | null>(null)

  const handlePick = useCallback((emote: EmoteType) => {
    onSelect(emote)
    setOpen(false)
    // 冷却 300ms 与服务端节流一致
    setCooldown(true)
    if (closeTimer.current) window.clearTimeout(closeTimer.current)
    closeTimer.current = window.setTimeout(() => setCooldown(false), 300)
  }, [onSelect])

  return (
    <div style={{ position: 'relative', width: 56, height: 56 }}>
      {/* 主按钮 */}
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={cooldown}
        title="表情动作"
        style={{
          width: 56, height: 56, borderRadius: '50%',
          border: '1px solid #4fb3a5',
          background: open ? 'rgba(79,179,165,0.25)' : 'rgba(20,18,10,0.8)',
          color: '#4fb3a5', fontSize: 24, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'background 0.15s',
          opacity: cooldown ? 0.5 : 1,
        }}
      >
        {open ? '✕' : '😊'}
      </button>

      {/* 轮盘 */}
      {open && (
        <>
          {/* 半透明遮罩，点击空白关闭 */}
          <div
            onClick={() => setOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
          />
          <div style={{ position: 'absolute', left: '50%', top: '50%', zIndex: 41 }}>
            {EMOTES.map((item, i) => {
              const angle = (i / EMOTES.length) * Math.PI * 2 - Math.PI / 2
              const x = Math.cos(angle) * RADIUS
              const y = Math.sin(angle) * RADIUS
              return (
                <button
                  key={item.emote}
                  onClick={() => handlePick(item.emote)}
                  title={item.label}
                  style={{
                    position: 'absolute',
                    left: x - 24, top: y - 24,
                    width: 48, height: 48, borderRadius: '50%',
                    border: '1px solid #4fb3a5',
                    background: 'rgba(15,15,15,0.9)',
                    fontSize: 22, cursor: 'pointer',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    boxShadow: '0 2px 8px rgba(0,0,0,0.5)',
                  }}
                >
                  {item.emoji}
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

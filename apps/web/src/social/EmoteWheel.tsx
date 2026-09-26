// ===== R4-08: Emote 动作轮盘（15 种） =====
// - 数字键 1-8 触发常用 emote
// - 点击轮盘按钮展开环形轮盘，再点选其一发送
// - 选中后通过 onEmote 回调通知上层（useEmote.sendEmote），本地动画由状态机驱动
import { useCallback, useEffect, useRef, useState } from 'react'
import type { EmoteType } from '@balabala/shared'

interface Props {
  onEmote: (emote: EmoteType) => void
}

/** 全部 15 种 emote（按环形轮盘顺序）。前 8 个绑定数字键 1-8。 */
const ALL_EMOTES: Array<{ emote: EmoteType; emoji: string; label: string }> = [
  { emote: 'wave', emoji: '👋', label: '挥手' },
  { emote: 'nod', emoji: '🙂', label: '点头' },
  { emote: 'shake', emoji: '🤝', label: '摇头' },
  { emote: 'point', emoji: '👉', label: '指向' },
  { emote: 'clap', emoji: '👏', label: '鼓掌' },
  { emote: 'laugh', emoji: '😂', label: '大笑' },
  { emote: 'surprised', emoji: '😲', label: '惊讶' },
  { emote: 'heart', emoji: '💛', label: '比心' },
  { emote: 'dance', emoji: '💃', label: '跳舞' },
  { emote: 'bow', emoji: '🙇', label: '鞠躬' },
  { emote: 'cheer', emoji: '📣', label: '欢呼' },
  { emote: 'cry', emoji: '😭', label: '哭泣' },
  { emote: 'angry', emoji: '😠', label: '生气' },
  { emote: 'think', emoji: '🤔', label: '思考' },
  { emote: 'salute', emoji: '🫡', label: '敬礼' },
]

const QUICK = ALL_EMOTES.slice(0, 8)

export default function EmoteWheel({ onEmote }: Props) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  const trigger = useCallback((emote: EmoteType) => {
    onEmote(emote)
    setOpen(false)
  }, [onEmote])

  // 数字键 1-8 快捷触发
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const target = e.target as HTMLElement
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return
      const n = parseInt(e.key, 10)
      if (n >= 1 && n <= QUICK.length && QUICK[n - 1]) {
        trigger(QUICK[n - 1].emote)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [trigger])

  // 点击外部关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  return (
    <div ref={containerRef} style={styles.wrap}>
      {open && (
        <div style={styles.ring}>
          {ALL_EMOTES.map((item, i) => {
            const angle = (i / ALL_EMOTES.length) * Math.PI * 2 - Math.PI / 2
            const r = 64
            const x = Math.cos(angle) * r
            const y = Math.sin(angle) * r
            return (
              <button
                key={item.emote}
                title={`${item.label}${i < 8 ? `（按 ${i + 1}）` : ''}`}
                onClick={() => trigger(item.emote)}
                style={{
                  ...styles.slice,
                  transform: `translate(${x}px, ${y}px)`,
                }}
              >
                <span style={styles.sliceEmoji}>{item.emoji}</span>
              </button>
            )
          })}
        </div>
      )}
      <button
        onClick={() => setOpen((v) => !v)}
        style={{ ...styles.trigger, ...(open ? stylesTriggerOpen : {}) }}
        aria-label="打开表情轮盘"
      >
        😊
      </button>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', display: 'inline-block' },
  trigger: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    border: '1px solid #FFD600',
    background: '#000',
    color: '#FFD600',
    fontSize: 22,
    cursor: 'pointer',
  },
  ring: {
    position: 'absolute',
    bottom: 52,
    left: '50%',
    width: 0,
    height: 0,
    zIndex: 50,
  },
  slice: {
    position: 'absolute',
    width: 38,
    height: 38,
    marginLeft: -19,
    marginTop: -19,
    borderRadius: '50%',
    border: '1px solid #4fb3a5',
    background: 'rgba(0,0,0,0.9)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sliceEmoji: { fontSize: 18 },
}

const stylesTriggerOpen: React.CSSProperties = {
  background: '#FFD600',
  color: '#000',
}

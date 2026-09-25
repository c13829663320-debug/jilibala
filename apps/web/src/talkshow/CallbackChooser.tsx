// 提交后弹出的「下一招」三选卡：顺着话题 / Call back 第N段 / 换个话题。
import type { CSSProperties } from 'react'

export type NextMove =
  | { kind: 'continue' }
  | { kind: 'callback'; index: number; preview: string }
  | { kind: 'switch_topic'; topicId?: string }

export default function CallbackChooser({
  callbackOptions,
  onPick,
  disabled,
}: {
  /** 已讲过的段子（可被回调）。 */
  callbackOptions: Array<{ index: number; preview: string }>
  onPick: (move: NextMove) => void
  disabled?: boolean
}) {
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: '#FFD600', marginBottom: 6, letterSpacing: 1 }}>下一招？</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <button style={row} disabled={disabled} onClick={() => onPick({ kind: 'continue' })}>
          ✍️ 顺着这个话题继续
        </button>
        {callbackOptions.map((c) => (
          <button
            key={c.index}
            style={{ ...row, borderColor: 'rgba(79,179,165,0.5)' }}
            disabled={disabled}
            onClick={() => onPick({ kind: 'callback', index: c.index, preview: c.preview })}
          >
            🔁 Call back 第 {c.index + 1} 段
            <span style={{ fontSize: 10, color: 'rgba(237,237,240,0.5)', marginLeft: 6 }}>“{c.preview}”</span>
          </button>
        ))}
        <button style={{ ...row, borderColor: 'rgba(255,122,89,0.4)' }} disabled={disabled} onClick={() => onPick({ kind: 'switch_topic' })}>
          🎭 换个话题
        </button>
      </div>
    </div>
  )
}

const row: CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  padding: '10px 12px',
  background: 'rgba(255,255,255,0.04)',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 8,
  color: '#EDEDF0',
  fontSize: 13,
  fontWeight: 600,
  cursor: 'pointer',
  textAlign: 'left',
}

// ============================================================================
// CustomPropEditor —— 简单道具编辑器：基础形状 + 颜色 + 缩放 + 命名 → 用户道具
// ============================================================================
import { useState } from 'react'
import type { UGCPropDraft } from '@balabala/shared'

export interface CustomPropEditorProps {
  /** 保存为用户道具后回调。 */
  onSave: (prop: UGCPropDraft) => void
}

const SHAPES = ['box', 'cylinder', 'cone', 'sphere', 'torus'] as const
const COLORS = ['#FFD600', '#4fb3a5', '#ff6b6b', '#8b7bd8', '#ffffff']

export default function CustomPropEditor({ onSave }: CustomPropEditorProps) {
  const [shape, setShape] = useState<(typeof SHAPES)[number]>('box')
  const [color, setColor] = useState(COLORS[0])
  const [scale, setScale] = useState(1)
  const [label, setLabel] = useState('')

  const save = () => {
    onSave({
      kind: shape,
      label: label.trim() || `${shape}-${Math.round(scale * 100)}`,
      color,
      scale,
      position: [0, 0.5, 0],
    })
    setLabel('')
  }

  return (
    <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 12, padding: 16, color: '#eee', maxWidth: 420, margin: '0 auto' }}>
      <div style={{ fontWeight: 700, marginBottom: 10 }}>🧱 自定义道具</div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>基础形状</div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {SHAPES.map((s) => (
            <button key={s} onClick={() => setShape(s)} style={{
              padding: '4px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12,
              border: shape === s ? '1px solid #FFD600' : '1px solid #333',
              background: shape === s ? '#2a2a14' : 'transparent', color: '#ccc',
            }}>{s}</button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>颜色</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {COLORS.map((c) => (
            <button key={c} onClick={() => setColor(c)} style={{
              width: 26, height: 26, borderRadius: 6, cursor: 'pointer', background: c,
              border: color === c ? '2px solid #fff' : '2px solid transparent',
            }} aria-label={c} />
          ))}
        </div>
      </div>

      <div style={{ marginBottom: 10 }}>
        <div style={{ fontSize: 12, color: '#888', marginBottom: 4 }}>缩放：{scale.toFixed(1)}x</div>
        <input type="range" min={0.3} max={3} step={0.1} value={scale}
          onChange={(e) => setScale(Number(e.target.value))} style={{ width: '100%' }} />
      </div>

      <input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="给道具起个名"
        style={{ width: '100%', boxSizing: 'border-box', padding: 8, borderRadius: 6, background: '#0a0a0a', color: '#eee', border: '1px solid #333' }}
      />

      <button onClick={save} style={{
        marginTop: 12, width: '100%', padding: '9px 0', borderRadius: 8, border: 'none',
        background: '#FFD600', color: '#141414', fontWeight: 700, cursor: 'pointer',
      }}>保存为我的道具</button>
    </div>
  )
}

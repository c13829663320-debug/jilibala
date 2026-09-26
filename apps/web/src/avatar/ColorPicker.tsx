// ===== ColorPicker：配色选择器 UI =====
// 预设色板 + 自定义 HSL（色相/饱和度/亮度）滑块，输出 #rrggbb。
// 纯 DOM，与 R3F 解耦；深色主题、青色高亮，与广场 UI 一致。
import { useMemo, useState } from 'react'
import { hslToHex } from './outfit-system'

/** 预设色板（常用服装色） */
const PRESET_SWATCHES: string[] = [
  '#e8e8e8', '#c96f4a', '#4fb3a5', '#3b6ea5', '#33415c',
  '#8c2f39', '#6b3a2a', '#3a6b4a', '#7a4a6b', '#2b2b2b',
  '#d9a441', '#9fd8e8',
]

interface ColorPickerProps {
  /** 当前颜色 #rrggbb */
  color: string
  onChange: (color: string) => void
}

/** 从 #rrggbb 反推近似 HSL（仅供滑块回显；误差可接受） */
function hexToHsl(hex: string): { h: number; s: number; l: number } {
  const m = hex.replace('#', '')
  if (m.length !== 6) return { h: 200, s: 40, l: 70 }
  const r = parseInt(m.slice(0, 2), 16) / 255
  const g = parseInt(m.slice(2, 4), 16) / 255
  const b = parseInt(m.slice(4, 6), 16) / 255
  const max = Math.max(r, g, b), min = Math.min(r, g, b)
  const l = (max + min) / 2
  const d = max - min
  let h = 0
  let s = 0
  if (d > 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0))
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
  }
  return { h, s: s * 100, l: l * 100 }
}

export function ColorPicker({ color, onChange }: ColorPickerProps) {
  const initial = useMemo(() => hexToHsl(color), [color])
  const [h, setH] = useState(initial.h)
  const [s, setS] = useState(initial.s)
  const [l, setL] = useState(initial.l)

  const preview = hslToHex(h, s, l)

  const slider = (label: string, value: number, min: number, max: number, onChangeVal: (v: number) => void) => (
    <label style={{ display: 'block', fontSize: 12, color: '#bbb', marginBottom: 6 }}>
      {label}
      <input
        type="range" min={min} max={max} value={value}
        onChange={(e) => onChangeVal(Number(e.target.value))}
        style={{ width: '100%', accentColor: '#4fb3a5' }}
      />
    </label>
  )

  return (
    <div style={{ background: 'rgba(20,18,10,0.6)', borderRadius: 10, padding: 12 }}>
      {/* 预设色板 */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 6, marginBottom: 10 }}>
        {PRESET_SWATCHES.map((sw) => (
          <button
            key={sw}
            title={sw}
            onClick={() => {
              const c = hexToHsl(sw)
              setH(c.h); setS(c.s); setL(c.l)
              onChange(sw)
            }}
            style={{
              height: 26, borderRadius: 6, cursor: 'pointer',
              background: sw,
              border: color.toLowerCase() === sw ? '2px solid #4fb3a5' : '1px solid rgba(255,255,255,0.15)',
            }}
          />
        ))}
      </div>
      {/* HSL 自定义 */}
      {slider('色相', Math.round(h), 0, 360, (v) => { setH(v); onChange(hslToHex(v, s, l)) })}
      {slider('饱和度', Math.round(s), 0, 100, (v) => { setS(v); onChange(hslToHex(h, v, l)) })}
      {slider('亮度', Math.round(l), 0, 100, (v) => { setL(v); onChange(hslToHex(h, s, v)) })}
      {/* 预览 */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 }}>
        <div style={{ width: 28, height: 28, borderRadius: 6, background: preview, border: '1px solid rgba(255,255,255,0.2)' }} />
        <code style={{ color: '#4fb3a5', fontSize: 12 }}>{preview}</code>
      </div>
    </div>
  )
}

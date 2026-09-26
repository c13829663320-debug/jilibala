/**
 * 开放世界 · 场景选择菜单（DOM 覆盖层）
 * ------------------------------------------------------------------
 * 按钮打开后列出 6 大场景，点击直接传送到对应建筑入口前。
 */
import { useState } from 'react'
import { BUILDINGS } from './config'

interface SceneSelectProps {
  onTeleport: (x: number, z: number) => void
}

export default function SceneSelect({ onTeleport }: SceneSelectProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button className="plaza-scene-btn" onClick={() => setOpen((v) => !v)}>
        {open ? '关闭' : '场景'}
      </button>
      {open && (
        <div className="plaza-scene-panel">
          <div className="plaza-scene-title">选择场景</div>
          {BUILDINGS.map((b) => (
            <button
              key={b.id}
              className="plaza-scene-item"
              onClick={() => {
                onTeleport(b.entranceX, b.entranceZ)
                setOpen(false)
              }}
            >
              <span>{b.emoji}</span> {b.name}
            </button>
          ))}
        </div>
      )}
    </>
  )
}

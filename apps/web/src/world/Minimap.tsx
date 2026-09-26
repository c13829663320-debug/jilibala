/**
 * 开放世界 · 圆形小地图（DOM 覆盖层，在 Canvas 外）
 * ------------------------------------------------------------------
 * - 右上角圆形地图，显示玩家箭头（每帧直接改 DOM transform，不触发 React 重渲染）
 * - 6 大建筑图标，点击传送到对应建筑入口前
 * - 可展开/收起
 */
import { useEffect, useRef, useState } from 'react'
import type { WorldRuntime } from './types'
import { BUILDINGS, WORLD_HALF } from './config'

interface MinimapProps {
  world: WorldRuntime
  /** 传送到世界坐标 (x,z) */
  onTeleport: (x: number, z: number) => void
}

const MAP_SIZE = 150 // px
const R = MAP_SIZE / 2

/** 世界坐标 → 小地图坐标（px，相对左上角） */
function toMap(x: number, z: number) {
  const px = R + (x / WORLD_HALF) * (R - 10)
  const py = R + (z / WORLD_HALF) * (R - 10)
  return { px, py }
}

export default function Minimap({ world, onTeleport }: MinimapProps) {
  const arrowRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(true)

  // 每帧读玩家位置，直接更新箭头 DOM（不走 state，避免 60fps 重渲染）
  useEffect(() => {
    let raf = 0
    const tick = () => {
      const el = arrowRef.current
      if (el) {
        const { x, z, rotation } = world.player
        const { px, py } = toMap(x, z)
        el.style.transform = `translate(${px - 6}px, ${py - 6}px) rotate(${rotation}rad)`
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [world])

  return (
    <div className="plaza-minimap">
      <button className="plaza-minimap-toggle" onClick={() => setOpen((v) => !v)}>
        {open ? '−' : '地图'}
      </button>
      {open && (
        <div className="plaza-minimap-circle" style={{ width: MAP_SIZE, height: MAP_SIZE }}>
          {/* 中心广场标记 */}
          <div className="plaza-minimap-center" style={{ left: R - 4, top: R - 4 }} />
          {/* 建筑图标 */}
          {BUILDINGS.map((b) => {
            const { px, py } = toMap(b.x, b.z)
            return (
              <button
                key={b.id}
                className="plaza-minimap-dot"
                title={`传送到 ${b.name}`}
                onClick={() => onTeleport(b.entranceX, b.entranceZ)}
                style={{ left: px - 9, top: py - 9 }}
              >
                {b.emoji}
              </button>
            )
          })}
          {/* 玩家箭头（每帧更新 transform） */}
          <div ref={arrowRef} className="plaza-minimap-player">▲</div>
        </div>
      )}
    </div>
  )
}

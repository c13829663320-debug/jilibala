/**
 * 开放世界 · 移动端控件（DOM 覆盖层，仅触屏设备显示）
 * ------------------------------------------------------------------
 * - 左下虚拟摇杆：触摸拖动 → 写 world.input.strafe/forward
 * - 右下按钮：跳跃 / 交互 / 奔跑切换
 * - 右半屏透明层：触摸拖动 → 写 world.camera.yaw/pitch（环视）
 */
import { useRef, useState } from 'react'
import type { WorldRuntime } from './types'

interface MobileControlsProps {
  world: WorldRuntime
}

/** 是否触屏设备 */
export function isTouchDevice(): boolean {
  if (typeof window === 'undefined') return false
  return 'ontouchstart' in window || navigator.maxTouchPoints > 0
}

export default function MobileControls({ world }: MobileControlsProps) {
  const [runOn, setRunOn] = useState(false)
  const joyRef = useRef<HTMLDivElement>(null)
  const knobRef = useRef<HTMLDivElement>(null)
  const joyTouchId = useRef<number | null>(null)
  const lookLast = useRef<{ x: number; y: number } | null>(null)

  // ---- 虚拟摇杆 ----
  const handleJoyStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0]
    joyTouchId.current = t.identifier
    handleJoyMove(e)
  }
  const handleJoyMove = (e: React.TouchEvent) => {
    const joy = joyRef.current
    if (!joy) return
    const rect = joy.getBoundingClientRect()
    const cx = rect.left + rect.width / 2
    const cy = rect.top + rect.height / 2
    for (let i = 0; i < e.changedTouches.length; i++) {
      const t = e.changedTouches[i]
      if (t.identifier !== joyTouchId.current) continue
      let dx = t.clientX - cx
      let dy = t.clientY - cy
      const max = rect.width / 2
      const len = Math.hypot(dx, dy)
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max }
      if (knobRef.current) {
        knobRef.current.style.transform = `translate(${dx}px, ${dy}px)`
      }
      // 屏幕上推(dy<0) = 前进(forward+)；右推(dx>0) = 右移(strafe+)
      world.input.strafe = dx / max
      world.input.forward = -dy / max
    }
  }
  const handleJoyEnd = () => {
    joyTouchId.current = null
    world.input.strafe = 0
    world.input.forward = 0
    if (knobRef.current) knobRef.current.style.transform = 'translate(0px, 0px)'
  }

  // ---- 右半屏环视 ----
  const handleLookStart = (e: React.TouchEvent) => {
    const t = e.changedTouches[0]
    lookLast.current = { x: t.clientX, y: t.clientY }
  }
  const handleLookMove = (e: React.TouchEvent) => {
    if (!lookLast.current) return
    const t = e.changedTouches[0]
    const dx = t.clientX - lookLast.current.x
    const dy = t.clientY - lookLast.current.y
    lookLast.current = { x: t.clientX, y: t.clientY }
    world.camera.yaw -= dx * 0.006
    world.camera.pitch = Math.max(0.08, Math.min(1.25, world.camera.pitch + dy * 0.005))
  }
  const handleLookEnd = () => { lookLast.current = null }

  return (
    <>
      {/* 右半屏环视层（透明，吃掉右半屏触摸） */}
      <div
        className="plaza-look-layer"
        onTouchStart={handleLookStart}
        onTouchMove={handleLookMove}
        onTouchEnd={handleLookEnd}
      />

      {/* 左下摇杆 */}
      <div
        ref={joyRef}
        className="plaza-joystick"
        onTouchStart={handleJoyStart}
        onTouchMove={handleJoyMove}
        onTouchEnd={handleJoyEnd}
        onTouchCancel={handleJoyEnd}
      >
        <div ref={knobRef} className="plaza-joystick-knob" />
      </div>

      {/* 右下按钮组 */}
      <div className="plaza-m-buttons">
        <button
          className="plaza-m-btn"
          onTouchStart={(e) => { e.preventDefault(); world.input.interactQueued = true }}
        >
          交互
        </button>
        <button
          className="plaza-m-btn"
          onTouchStart={(e) => { e.preventDefault(); setRunOn((v) => { world.input.run = !v; return !v }) }}
          style={runOn ? { background: '#FFD600', color: '#000' } : undefined}
        >
          奔跑
        </button>
        <button
          className="plaza-m-btn plaza-m-jump"
          onTouchStart={(e) => { e.preventDefault(); world.input.jumpQueued = true }}
        >
          跳
        </button>
      </div>
    </>
  )
}

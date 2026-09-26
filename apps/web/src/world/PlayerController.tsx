/**
 * 开放世界 · 第三人称玩家控制器
 * ------------------------------------------------------------------
 * - 读取全局键盘（WASD / 方向键 / Shift / Space / E），写入 world.input
 * - useFrame 里：相对相机方向算出移动向量 → 重力/跳跃 → 分轴碰撞滑动 →
 *   更新 world.player，并把化身 mesh 摆到对应位置
 * - 位置变化时节流回调 onSync（给 WS 多人同步用）
 * - 卸载时清理 window 事件监听
 */
import { useEffect, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { Collider, WorldRuntime } from './types'
import {
  GRAVITY, JUMP_VELOCITY, PLAYER_RADIUS, RUN_SPEED, WALK_SPEED, WORLD_HALF,
} from './config'
import { moveWithCollision } from './collision'

interface PlayerControllerProps {
  world: WorldRuntime
  colliders: Collider[]
  /** 节流后的位置同步回调（WS send move） */
  onSync: (x: number, z: number, rotation: number) => void
}

const MOVE_KEYS = new Set(['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'])

/** 根据当前按下的键集合，重算 forward/strafe 轴 */
function recomputeMove(keys: Set<string>, input: WorldRuntime['input']) {
  let f = 0
  let s = 0
  if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1
  if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1
  if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1
  if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1
  input.forward = f
  input.strafe = s
}

export default function PlayerController({ world, colliders, onSync }: PlayerControllerProps) {
  const groupRef = useRef<THREE.Group>(null)
  const lastSyncRef = useRef(0)
  const lastSyncPos = useRef({ x: world.player.x, z: world.player.z })
  const keysRef = useRef<Set<string>>(new Set())

  // 全局键盘监听（桌面端）；移动端走 MobileControls 的虚拟摇杆
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      // 避免在输入框里触发移动
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return
      if (MOVE_KEYS.has(e.code)) {
        keysRef.current.add(e.code)
        recomputeMove(keysRef.current, world.input)
      }
      if (e.code === 'Space') e.preventDefault() // 阻止页面滚动
      if (e.code === 'Space') world.input.jumpQueued = true
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') world.input.run = true
      if (e.code === 'KeyE') world.input.interactQueued = true
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (MOVE_KEYS.has(e.code)) {
        keysRef.current.delete(e.code)
        recomputeMove(keysRef.current, world.input)
      }
      if (e.code === 'ShiftLeft' || e.code === 'ShiftRight') world.input.run = false
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [world])

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05) // 防止切后台后大步长穿透
    const p = world.player
    const input = world.input
    const cam = world.camera

    // ---- 1. 相对相机方向计算移动向量 ----
    const fwd = input.forward
    const str = input.strafe
    // 相机前方（屏幕 W 方向）水平投影
    const fX = -Math.sin(cam.yaw)
    const fZ = -Math.cos(cam.yaw)
    // 屏幕右方向
    const rX = Math.cos(cam.yaw)
    const rZ = -Math.sin(cam.yaw)
    let dx = fwd * fX + str * rX
    let dz = fwd * fZ + str * rZ
    const mag = Math.hypot(dx, dz)
    if (mag > 1e-4) {
      dx /= mag
      dz /= mag
    }
    const speed = input.run ? RUN_SPEED : WALK_SPEED
    const moveX = dx * speed * dt
    const moveZ = dz * speed * dt

    // ---- 2. 水平移动 + 碰撞滑动 ----
    const res = moveWithCollision(p.x, p.z, moveX, moveZ, PLAYER_RADIUS, colliders, WORLD_HALF)
    p.x = res.x
    p.z = res.z

    // ---- 3. 朝向：移动时面向移动方向，平滑转向 ----
    if (mag > 1e-4) {
      const targetRot = Math.atan2(dx, dz)
      // 最短角插值
      let diff = targetRot - p.rotation
      while (diff > Math.PI) diff -= Math.PI * 2
      while (diff < -Math.PI) diff += Math.PI * 2
      p.rotation += diff * Math.min(dt * 12, 1)
    }

    // ---- 4. 跳跃 / 重力 ----
    if (input.jumpQueued && p.onGround) {
      p.velocityY = JUMP_VELOCITY
      p.onGround = false
    }
    input.jumpQueued = false
    if (!p.onGround) {
      p.velocityY += GRAVITY * dt
      p.y += p.velocityY * dt
      if (p.y <= 0) {
        p.y = 0
        p.velocityY = 0
        p.onGround = true
      }
    }

    // ---- 5. 摆化身 mesh ----
    const g = groupRef.current
    if (g) {
      g.position.set(p.x, p.y, p.z)
      g.rotation.y = p.rotation
    }

    // ---- 6. 节流 WS 位置同步（100ms 或位移 >0.5） ----
    const now = performance.now()
    const moved = Math.hypot(p.x - lastSyncPos.current.x, p.z - lastSyncPos.current.z)
    if (now - lastSyncRef.current > 100 || moved > 0.5) {
      lastSyncRef.current = now
      lastSyncPos.current = { x: p.x, z: p.z }
      onSync(p.x, p.z, p.rotation)
    }
  })

  // 本地玩家化身：明黄胶囊 + 简单头（中性占位，后续可换 GLB）
  return (
    <group ref={groupRef}>
      {/* 身体胶囊 */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.28, 0.6, 8, 16]} />
        <meshStandardMaterial color="#FFD600" roughness={0.45} metalness={0.1} />
      </mesh>
      {/* 头 */}
      <mesh position={[0, 1.25, 0]} castShadow>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshStandardMaterial color="#ffe27a" roughness={0.5} metalness={0.05} />
      </mesh>
      {/* 朝向指示：一个小鼻子/前指向 +Z */}
      <mesh position={[0, 1.25, 0.2]}>
        <boxGeometry args={[0.06, 0.06, 0.12]} />
        <meshStandardMaterial color="#0a0a0a" />
      </mesh>
    </group>
  )
}

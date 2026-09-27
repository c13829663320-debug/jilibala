/**
 * 开放世界 · 室内玩家控制器
 * ------------------------------------------------------------------
 * 简化版玩家控制器，用于建筑内部场景。
 * 与广场 PlayerController 的区别：
 *   - 碰撞体使用室内 AABB 列表（墙/家具）
 *   - 无跳跃（室内天花板低）
 *   - 移动速度稍慢
 *   - 相机固定跟随，不允许穿墙
 */
import { useRef, useEffect } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { InteriorCollider } from './InteriorShell'

const WALK_SPEED = 4.5
const PLAYER_RADIUS = 0.4

interface InteriorPlayerProps {
  /** 玩家可变位置对象（外部持有，用于收集品检测/出口检测） */
  playerPos: { x: number; y: number; z: number }
  /** 室内碰撞体列表 */
  colliders: InteriorCollider[]
  /** 房间半宽（边界 clamp） */
  halfWidth: number
  /** 房间半深（边界 clamp） */
  halfDepth: number
  /** 出生点 */
  spawn?: { x: number; z: number }
}

/** 点与 AABB 的碰撞检测 + 推回 */
function resolveAABB(px: number, pz: number, r: number, box: { minX: number; maxX: number; minZ: number; maxZ: number }) {
  // 扩展 box by radius
  const minX = box.minX - r, maxX = box.maxX + r
  const minZ = box.minZ - r, maxZ = box.maxZ + r
  if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
    // 计算四个方向的穿透深度，取最小推回
    const dLeft = px - minX
    const dRight = maxX - px
    const dDown = pz - minZ
    const dUp = maxZ - pz
    const m = Math.min(dLeft, dRight, dDown, dUp)
    if (m === dLeft) return { x: minX, z: pz }
    if (m === dRight) return { x: maxX, z: pz }
    if (m === dDown) return { x: px, z: minZ }
    return { x: px, z: maxZ }
  }
  return null
}

export default function InteriorPlayer({ playerPos, colliders, halfWidth, halfDepth, spawn }: InteriorPlayerProps) {
  const { camera } = useThree()
  const keys = useRef({ forward: 0, strafe: 0 })
  const yaw = useRef(Math.PI) // 面朝 -Z（出口方向）
  const velocity = useRef({ x: 0, z: 0 })

  // 初始化位置
  useEffect(() => {
    playerPos.x = spawn?.x ?? 0
    playerPos.y = 0
    playerPos.z = spawn?.z ?? halfDepth - 2
  }, [playerPos, spawn, halfDepth])

  // 键盘输入
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'w' || e.key === 'ArrowUp') keys.current.forward = 1
      if (e.key === 's' || e.key === 'ArrowDown') keys.current.forward = -1
      if (e.key === 'a' || e.key === 'ArrowLeft') keys.current.strafe = -1
      if (e.key === 'd' || e.key === 'ArrowRight') keys.current.strafe = 1
      // Q/E 旋转
      if (e.key === 'q') yaw.current += 0.05
      if (e.key === 'e') yaw.current -= 0.05
    }
    const up = (e: KeyboardEvent) => {
      if (['w', 'ArrowUp', 's', 'ArrowDown'].includes(e.key)) keys.current.forward = 0
      if (['a', 'ArrowLeft', 'd', 'ArrowRight'].includes(e.key)) keys.current.strafe = 0
    }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
    }
  }, [])

  useFrame((_, delta) => {
    const dt = Math.min(delta, 0.05)
    // 移动方向（基于 yaw）
    const sin = Math.sin(yaw.current)
    const cos = Math.cos(yaw.current)
    let mx = (keys.current.forward * sin + keys.current.strafe * cos) * WALK_SPEED * dt
    let mz = (keys.current.forward * cos - keys.current.strafe * sin) * WALK_SPEED * dt

    let nx = playerPos.x + mx
    let nz = playerPos.z + mz

    // 边界 clamp
    nx = Math.max(-halfWidth + PLAYER_RADIUS, Math.min(halfWidth - PLAYER_RADIUS, nx))
    nz = Math.max(-halfDepth + PLAYER_RADIUS, Math.min(halfDepth + 0.5, nz)) // 允许走到门口

    // 碰撞推回
    for (const c of colliders) {
      const resolved = resolveAABB(nx, nz, PLAYER_RADIUS, c.box)
      if (resolved) { nx = resolved.x; nz = resolved.z }
    }

    playerPos.x = nx
    playerPos.z = nz

    // 相机跟随（第三人称，在玩家身后上方）
    const camDist = 6
    const camHeight = 4
    camera.position.set(
      nx - sin * camDist,
      camHeight,
      nz - cos * camDist,
    )
    camera.lookAt(nx, 1.2, nz)
  })

  // 玩家化身（简单胶囊体，带主题色）
  return (
    <group position={[playerPos.x, 0, playerPos.z]}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <capsuleGeometry args={[0.3, 0.8, 4, 8]} />
        <meshStandardMaterial color={BRAND_PLAYER} roughness={0.5} />
      </mesh>
    </group>
  )
}

const BRAND_PLAYER = '#FFD600'

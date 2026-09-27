/**
 * 开放世界 · 建筑室内 3D 场景基类
 * ------------------------------------------------------------------
 * 每座建筑的室内场景遵循此组件模式：
 *   1. <InteriorShell> 提供统一的房间外壳（地板/墙/天花板/出口门/光照/雾）
 *   2. 各建筑在 children 中放置专属家具与装饰
 *   3. 收集品通过 <CollectibleLayer> 注入
 *   4. 玩家在室内可 WASD 移动，碰撞由 interior colliders 控制
 *   5. 走近出口门触发 onExit 返回广场
 *
 * 各建筑分片只需：
 *   - 创建 apps/web/src/world/interior/<BuildingId>Interior.tsx
 *   - 用 <InteriorShell> 包裹，传入 buildingId / theme / width / depth / onExit
 *   - 在 children 里摆专属家具
 *   - 导出组件供 Plaza3D / App 路由调用
 */
import { useRef, useMemo, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { BRAND, BUILDING_THEME, INTERIOR_LIGHTING, FOG, MATERIAL } from '../art-spec'
import { collectiblesForScene, type CollectibleDef } from '../collectibles'
import { CollectibleLayer } from '../CollectibleMesh'

// ---------- 室内碰撞体（纯数据，可单测） ----------
export interface InteriorCollider {
  kind: 'aabb'
  box: { minX: number; maxX: number; minZ: number; maxZ: number }
}

/** 生成房间四壁 + 外墙的碰撞体（留出门口缺口） */
export function buildInteriorColliders(
  width: number,
  depth: number,
  wallThickness = 0.4,
  doorWidth = 2.0,
): InteriorCollider[] {
  const hw = width / 2
  const hd = depth / 2
  const wt = wallThickness
  const dw = doorWidth / 2
  return [
    // 后墙（-Z，无门）
    { kind: 'aabb', box: { minX: -hw, maxX: hw, minZ: -hd - wt, maxZ: -hd } },
    // 前墙左段（+Z，门左侧）
    { kind: 'aabb', box: { minX: -hw, maxX: -dw, minZ: hd, maxZ: hd + wt } },
    // 前墙右段（+Z，门右侧）
    { kind: 'aabb', box: { minX: dw, maxX: hw, minZ: hd, maxZ: hd + wt } },
    // 左墙
    { kind: 'aabb', box: { minX: -hw - wt, maxX: -hw, minZ: -hd, maxZ: hd } },
    // 右墙
    { kind: 'aabb', box: { minX: hw, maxX: hw + wt, minZ: -hd, maxZ: hd } },
  ]
}

// ---------- 室内外壳组件 ----------
interface InteriorShellProps {
  /** 建筑 id（court/talkshow/werewolf/bar/gym/library） */
  buildingId: string
  /** 房间内部宽（X 方向） */
  width: number
  /** 房间内部深（Z 方向） */
  depth: number
  /** 房间高度 */
  height?: number
  /** 退出回调（走近出口门触发） */
  onExit: () => void
  /** 玩家位置 ref（用于出口检测 + 收集品拾取） */
  playerPos: { x: number; y: number; z: number }
  /** 已收集品 id 集合 */
  collectedSet: Set<string>
  /** 拾取回调 */
  onCollect: (id: string) => void
  children?: ReactNode
}

export function InteriorShell({
  buildingId,
  width,
  depth,
  height = 5,
  onExit,
  playerPos,
  collectedSet,
  onCollect,
  children,
}: InteriorShellProps) {
  const theme = BUILDING_THEME[buildingId] ?? BUILDING_THEME.court
  const items: CollectibleDef[] = useMemo(() => collectiblesForScene(buildingId), [buildingId])
  const doorPulse = useRef(0)

  // 出口检测：玩家在 +Z 墙门口附近且 z > depth/2 - 1
  useFrame((state) => {
    doorPulse.current = state.clock.elapsedTime
    if (playerPos.z > depth / 2 - 0.8 && Math.abs(playerPos.x) < 1.5) {
      onExit()
    }
  })

  const hw = width / 2
  const hd = depth / 2

  return (
    <>
      {/* 雾效（室内短雾） */}
      <fog attach="fog" args={[FOG.color, FOG.interiorNear, FOG.interiorFar]} />

      {/* 光照 */}
      <ambientLight intensity={INTERIOR_LIGHTING.ambientIntensity} />
      <hemisphereLight
        args={[INTERIOR_LIGHTING.hemisphereSky, INTERIOR_LIGHTING.hemisphereGround, INTERIOR_LIGHTING.hemisphereIntensity]}
      />
      {/* 主顶灯 */}
      <pointLight
        position={[0, height - 0.5, 0]}
        color={INTERIOR_LIGHTING.ceilingColor}
        intensity={INTERIOR_LIGHTING.ceilingIntensity}
        distance={width * 1.5}
        decay={2}
      />
      {/* 品牌黄氛围灯（墙角） */}
      <pointLight
        position={[-hw + 1, height - 1, -hd + 1]}
        color={INTERIOR_LIGHTING.accentColor}
        intensity={INTERIOR_LIGHTING.accentIntensity}
        distance={8}
        decay={2}
      />
      <pointLight
        position={[hw - 1, height - 1, -hd + 1]}
        color={theme.primary}
        intensity={INTERIOR_LIGHTING.accentIntensity * 0.7}
        distance={8}
        decay={2}
      />

      {/* 地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>

      {/* 天花板 */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, height, 0]}>
        <planeGeometry args={[width, depth]} />
        <meshStandardMaterial color={BRAND.bgMid} roughness={0.9} />
      </mesh>

      {/* 后墙 */}
      <mesh position={[0, height / 2, -hd]} receiveShadow>
        <boxGeometry args={[width, height, 0.4]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>

      {/* 前墙（带门洞，分左右两段） */}
      <mesh position={[-hw / 2 - 0.5, height / 2, hd]}>
        <boxGeometry args={[hw - 1, height, 0.4]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      <mesh position={[hw / 2 + 0.5, height / 2, hd]}>
        <boxGeometry args={[hw - 1, height, 0.4]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      {/* 门洞上方横梁 */}
      <mesh position={[0, height - 0.6, hd]}>
        <boxGeometry args={[2, 1.2, 0.4]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>

      {/* 左墙 */}
      <mesh position={[-hw, height / 2, 0]}>
        <boxGeometry args={[0.4, height, depth]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      {/* 右墙 */}
      <mesh position={[hw, height / 2, 0]}>
        <boxGeometry args={[0.4, height, depth]} />
        <meshStandardMaterial color={theme.secondary} roughness={MATERIAL.defaultRoughness} />
      </mesh>

      {/* 出口门（发光，指示返回广场） */}
      <group position={[0, 1.2, hd + 0.05]}>
        <mesh>
          <boxGeometry args={[1.8, 2.4, 0.1]} />
          <meshStandardMaterial
            color="#0a0a0a"
            emissive={BRAND.yellow}
            emissiveIntensity={0.3 + Math.sin(doorPulse.current * 3) * 0.1}
          />
        </mesh>
        {/* 出口指示牌 */}
        <mesh position={[0, 1.8, 0.1]}>
          <planeGeometry args={[1.2, 0.4]} />
          <meshBasicMaterial color={BRAND.yellow} />
        </mesh>
      </group>

      {/* 主题色装饰条（墙脚） */}
      <mesh position={[0, 0.1, -hd + 0.1]}>
        <boxGeometry args={[width - 1, 0.2, 0.1]} />
        <meshStandardMaterial color={theme.primary} emissive={theme.primary} emissiveIntensity={0.2} />
      </mesh>

      {/* 建筑专属内容 */}
      {children}

      {/* 收集品层 */}
      <CollectibleLayer
        items={items}
        collectedSet={collectedSet}
        onCollect={onCollect}
        playerPos={playerPos}
      />
    </>
  )
}

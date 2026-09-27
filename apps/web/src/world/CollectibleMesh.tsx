/**
 * 开放世界 · 3D 收集品渲染组件
 * ------------------------------------------------------------------
 * 在广场或室内渲染一个旋转发光的水晶/徽章。走近自动拾取。
 * 用 meshStandardMaterial + emissive 实现发光效果，低耗。
 */
import { useRef, useMemo } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import { RARITY_COLOR, type CollectibleDef } from './collectibles'

interface CollectibleMeshProps {
  def: CollectibleDef
  collected: boolean
  onCollect: (id: string) => void
  /** 玩家位置 ref（用于近距离检测） */
  playerPos: { x: number; y: number; z: number }
}

/** 单个收集品的 3D 表现：八面体水晶 + 光晕 + 旋转动画 */
export function CollectibleMesh({ def, collected, onCollect, playerPos }: CollectibleMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null)
  const glowRef = useRef<THREE.Mesh>(null)
  const color = RARITY_COLOR[def.rarity]

  // 旋转 + 浮动动画
  useFrame((state) => {
    if (!meshRef.current) return
    const t = state.clock.elapsedTime
    meshRef.current.rotation.y = t * 1.5
    meshRef.current.position.y = def.y + Math.sin(t * 2 + def.x) * 0.15
    if (glowRef.current) {
      const s = 1 + Math.sin(t * 3) * 0.1
      glowRef.current.scale.setScalar(s)
    }
    // 近距离拾取检测
    const dx = playerPos.x - def.x
    const dy = playerPos.y - def.y
    const dz = playerPos.z - def.z
    if (dx * dx + dy * dy + dz * dz < 4.0) {
      onCollect(def.id)
    }
  })

  if (collected) return null

  const geometry = useMemo(() => {
    if (def.rarity === 'hidden') return new THREE.OctahedronGeometry(0.45, 0)
    if (def.rarity === 'rare') return new THREE.IcosahedronGeometry(0.35, 0)
    return new THREE.TetrahedronGeometry(0.3, 0)
  }, [def.rarity])

  return (
    <group position={[def.x, def.y, def.z]}>
      {/* 水晶本体 */}
      <mesh ref={meshRef} geometry={geometry} castShadow>
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={0.6}
          roughness={0.2}
          metalness={0.3}
        />
      </mesh>
      {/* 光晕（半透明球体） */}
      <mesh ref={glowRef}>
        <sphereGeometry args={[0.6, 12, 12]} />
        <meshBasicMaterial color={color} transparent opacity={0.15} />
      </mesh>
      {/* 底部光柱 */}
      <mesh position={[0, -def.y + 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.3, 0.5, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.3} side={THREE.DoubleSide} />
      </mesh>
    </group>
  )
}

/** 批量渲染收集品（同场景内所有未收集品） */
export function CollectibleLayer({
  items,
  collectedSet,
  onCollect,
  playerPos,
}: {
  items: CollectibleDef[]
  collectedSet: Set<string>
  onCollect: (id: string) => void
  playerPos: { x: number; y: number; z: number }
}) {
  return (
    <>
      {items.map((def) => (
        <CollectibleMesh
          key={def.id}
          def={def}
          collected={collectedSet.has(def.id)}
          onCollect={onCollect}
          playerPos={playerPos}
        />
      ))}
    </>
  )
}

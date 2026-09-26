/**
 * LodAvatar — 带距离 LOD 的化身组件（分片3）。
 *
 * 每帧根据相机到化身的水平距离，按 avatar-lod.ts 的四级决策切换：
 *   LOD0 近   → 高模 GLB（modelUrl，如名人 GLB）或高细分程序化体，开阴影
 *   LOD1 中   → 中细分程序化体，开阴影
 *   LOD2 远   → 低细分胶囊体，关阴影
 *   Culled 极远 → 完全不渲染（distance cull）
 *
 * 动画更新按抽帧策略（LOD0 每帧 / LOD1 每2帧 / LOD2 每4帧），
 * 动画评估耗时经 AnimTimer 采样，可挂到开发面板。
 *
 * 接入点：Plaza3D 的远端玩家（WorldScene.tsx）、CharacterGallery3D 的展台。
 */
import { useMemo, useRef, useState } from 'react'
import { useFrame } from '@react-three/fiber'
import { useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { pickLod, horizontalDistance, DEFAULT_LOD_CONFIG, type LodConfig, type LodDecision, type LodLevel } from './avatar-lod'
import { AnimTimer } from '../performance/avatar-perf-metrics'

export interface LodAvatarProps {
  /** 世界坐标（脚底 y=0）。 */
  position: [number, number, number]
  /** 绕 Y 朝向（弧度）。 */
  rotation?: number
  /** 程序化体颜色。 */
  color?: string
  /** LOD0 高模 GLB 路径（如 /models/celebrities/li-bai.glb）；缺省时 LOD0 也用高细分程序化体。 */
  modelUrl?: string
  /** 覆盖默认 LOD 距离阈值。 */
  lodConfig?: Partial<LodConfig>
  /** 调试：把当前 LOD 上报给开发面板。 */
  onLodChange?: (level: LodLevel) => void
}

/** 高模 GLB（LOD0）：克隆并开阴影。 */
function HighPolyModel({ url, castShadow }: { url: string; castShadow: boolean }) {
  const { scene } = useGLTF(url)
  const cloned = useMemo(() => {
    const s = scene.clone(true)
    s.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.isMesh) m.castShadow = castShadow
    })
    return s
  }, [scene, castShadow])
  return <primitive object={cloned} />
}

/** 程序化身体（按 LOD 调细分）。 */
function ProceduralBody({ level, color, castShadow }: { level: LodLevel; color: string; castShadow: boolean }) {
  const bodySegs = level === 'LOD0' ? [12, 24] : level === 'LOD1' ? [6, 12] : [4, 8]
  const headSegs = level === 'LOD0' ? 24 : level === 'LOD1' ? 12 : 8
  return (
    <group>
      {/* 身体胶囊 */}
      <mesh position={[0, 0.55, 0]} castShadow={castShadow}>
        <capsuleGeometry args={[0.25, 0.6, bodySegs[0], bodySegs[1]]} />
        <meshStandardMaterial color={color} roughness={0.5} metalness={0.1} />
      </mesh>
      {/* 头部 */}
      <mesh position={[0, 1.1, 0]} castShadow={castShadow}>
        <sphereGeometry args={[0.22, headSegs, headSegs]} />
        <meshStandardMaterial color={color} roughness={0.5} />
      </mesh>
    </group>
  )
}

export function LodAvatar({
  position,
  rotation = 0,
  color = '#4fb3a5',
  modelUrl,
  lodConfig,
  onLodChange,
}: LodAvatarProps) {
  const groupRef = useRef<THREE.Group>(null)
  const [level, setLevel] = useState<LodLevel>('LOD0')
  const levelRef = useRef<LodLevel>('LOD0')
  const frameRef = useRef(0)
  const timerRef = useRef(new AnimTimer())
  const tmpVec = new THREE.Vector3()
  const config = useMemo<LodConfig>(
    () => ({ ...DEFAULT_LOD_CONFIG, ...lodConfig }),
    [lodConfig],
  )

  useFrame(({ camera }) => {
    const root = groupRef.current
    if (!root) return
    frameRef.current++

    // 用化身的世界坐标测距（便于父节点做位置跟随/lerp），而非局部 position prop。
    const worldPos = root.getWorldPosition(tmpVec)
    const dist = horizontalDistance(camera.position.x, camera.position.z, worldPos.x, worldPos.z)
    const decision: LodDecision = pickLod(dist, config)

    // 仅在层级变化时 setState（避免每帧重渲染）
    if (decision.level !== levelRef.current) {
      levelRef.current = decision.level
      setLevel(decision.level)
      onLodChange?.(decision.level)
    }

    // Culled：直接隐藏整个 group（distance cull；three.js 自身 frustum cull 另算）
    root.visible = decision.visible

    // 动画抽帧：LOD0 每帧、LOD1 每2帧、LOD2 每4帧做一次轻量呼吸浮动
    if (!decision.visible) return
    const shouldAnimate = frameRef.current % decision.animationEveryNFrames === 0
    if (shouldAnimate) {
      timerRef.current.begin()
      const t = performance.now() / 1000
      root.position.y = Math.sin(t * 1.6) * 0.01
      root.rotation.y = rotation
      timerRef.current.end()
    }
  })

  // Culled：不产出任何 mesh（distance cull 的硬跳过）
  if (level === 'Culled') return null

  const castShadow = level !== 'LOD2'
  return (
    <group ref={groupRef} position={position} rotation={[0, rotation, 0]}>
      {level === 'LOD0' && modelUrl ? (
        <HighPolyModel url={modelUrl} castShadow={castShadow} />
      ) : (
        <ProceduralBody level={level} color={color} castShadow={castShadow} />
      )}
    </group>
  )
}

export default LodAvatar

/**
 * 开放世界 · 主场景
 * ------------------------------------------------------------------
 * 负责把地面/道路/中央广场/6 大建筑/自然植被/边界山/远端玩家 全部摆出来。
 * manifest 加载成功 → 用 useGLTF 懒加载真实模型；失败/缺失 → 程序化几何体占位。
 * 重复物（树/石/灯）用 instancedMesh 复用，不为每个实例存文件。
 */
import { useMemo, useRef, type MutableRefObject } from 'react'
import { useFrame } from '@react-three/fiber'
import { Billboard, Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import type { BuildingConfig, RemotePlayer, WorldManifest, WorldRuntime } from './types'
import { BUILDINGS, FOUNTAIN, WORLD_HALF } from './config'
import { getCelebrity, hashColor } from '../identity'

// ---------------------------------------------------------------------------
// 确定性伪随机（让植被布局每次加载一致，不随渲染抖动）
// ---------------------------------------------------------------------------
function mulberry32(seed: number) {
  return () => {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// 单个 GLTF 建筑（manifest 命中时渲染）
// ---------------------------------------------------------------------------
function GltfBuilding({ path, building }: { path: string; building: BuildingConfig }) {
  const { scene } = useGLTF(path)
  // 克隆并开启阴影
  const cloned = useMemo(() => {
    const s = scene.clone()
    s.traverse((child) => {
      const m = child as THREE.Mesh
      if (m.isMesh) {
        m.castShadow = true
        m.receiveShadow = true
      }
    })
    return s
  }, [scene])
  return (
    <group position={[building.x, 0, building.z]} rotation={[0, building.rotation, 0]}>
      <primitive object={cloned} />
    </group>
  )
}

// ---------------------------------------------------------------------------
// 占位建筑（manifest 缺失时的程序化几何体兜底）
// ---------------------------------------------------------------------------
function BuildingPlaceholder({ building }: { building: BuildingConfig }) {
  const w = building.width
  const d = building.depth
  const h = 6 + w * 0.2
  return (
    <group position={[building.x, 0, building.z]} rotation={[0, building.rotation, 0]}>
      {/* 主体盒子 */}
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <meshStandardMaterial color={building.color} roughness={0.7} metalness={0.1} />
      </mesh>
      {/* 屋顶（锥形） */}
      <mesh position={[0, h + 1, 0]} castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.65, 2.2, 4]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.8} />
      </mesh>
      {/* 入口门（正面 +Z 方向，朝向世界中心一侧） */}
      <mesh position={[0, 1.2, d / 2 + 0.05]}>
        <boxGeometry args={[1.6, 2.4, 0.1]} />
        <meshStandardMaterial color="#0a0a0a" emissive="#FFD600" emissiveIntensity={0.25} />
      </mesh>
      {/* 悬浮名牌 */}
      <Billboard position={[0, h + 3.2, 0]}>
        <Text fontSize={1.1} color="#FFD600" anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor="#000000" raycast={() => null}>
          {building.emoji} {building.name}
        </Text>
      </Billboard>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 中央喷泉
// ---------------------------------------------------------------------------
function Fountain() {
  return (
    <group position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
      {/* 水池基座 */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <cylinderGeometry args={[FOUNTAIN.r + 0.6, FOUNTAIN.r + 0.8, 0.4, 32]} />
        <meshStandardMaterial color="#2a2d33" roughness={0.8} />
      </mesh>
      {/* 水面 */}
      <mesh position={[0, 0.42, 0]}>
        <cylinderGeometry args={[FOUNTAIN.r, FOUNTAIN.r, 0.1, 32]} />
        <meshStandardMaterial color="#4fb3a5" transparent opacity={0.6} roughness={0.2} metalness={0.3} />
      </mesh>
      {/* 中心雕像柱 */}
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.7, 2.6, 12]} />
        <meshStandardMaterial color="#c9c4b8" roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.2, 0]} castShadow>
        <sphereGeometry args={[0.55, 16, 16]} />
        <meshStandardMaterial color="#FFD600" roughness={0.3} metalness={0.4} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 自然植被（instanced）：树 / 岩石 / 路灯
// ---------------------------------------------------------------------------
function scatterPoints(count: number): Array<{ x: number; z: number; s: number; rot: number }> {
  const rand = mulberry32(42)
  const pts: Array<{ x: number; z: number; s: number; rot: number }> = []
  let guard = 0
  while (pts.length < count && guard < count * 20) {
    guard++
    const ang = rand() * Math.PI * 2
    const rad = 18 + rand() * 100 // 半径 18~118
    const x = Math.cos(ang) * rad
    const z = Math.sin(ang) * rad
    // 避开建筑 footprint（粗判：距任一建筑中心 > 10）
    let near = false
    for (const b of BUILDINGS) {
      if (Math.hypot(x - b.x, z - b.z) < 12) { near = true; break }
    }
    if (near) continue
    pts.push({ x, z, s: 0.7 + rand() * 0.7, rot: rand() * Math.PI * 2 })
  }
  return pts
}

/**
 * 自然植被（instanced）：树（树干+树冠）、岩石、路灯。
 * 用 instancedMesh 一次性画几百个实例，draw call 极少。
 */
function Nature() {
  const trunkRef = useRef<THREE.InstancedMesh>(null)
  const leafRef = useRef<THREE.InstancedMesh>(null)
  const rockRef = useRef<THREE.InstancedMesh>(null)
  const lampRef = useRef<THREE.InstancedMesh>(null)

  const treePts = useMemo(() => scatterPoints(70), [])
  const rockPts = useMemo(() => scatterPoints(30), [])
  const lampPts = useMemo(() => {
    const arr: Array<{ x: number; z: number }> = []
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2
      arr.push({ x: Math.cos(ang) * 70, z: Math.sin(ang) * 70 })
    }
    return arr
  }, [])

  // 一次性写入所有 instance matrix
  useFrame(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const eul = new THREE.Euler()
    const v = new THREE.Vector3()
    const sc = new THREE.Vector3()

    if (trunkRef.current && leafRef.current) {
      treePts.forEach((p, i) => {
        eul.set(0, p.rot, 0); q.setFromEuler(eul)
        v.set(p.x, 0.6 * p.s, p.z); sc.setScalar(p.s)
        m.compose(v, q, sc); trunkRef.current!.setMatrixAt(i, m)
        v.set(p.x, (1.2 + 1.1) * p.s, p.z)
        m.compose(v, q, sc); leafRef.current!.setMatrixAt(i, m)
      })
      trunkRef.current.instanceMatrix.needsUpdate = true
      leafRef.current.instanceMatrix.needsUpdate = true
    }
    if (rockRef.current) {
      rockPts.forEach((p, i) => {
        eul.set(0, p.rot, 0); q.setFromEuler(eul)
        v.set(p.x, 0.25 * p.s, p.z); sc.setScalar(p.s)
        m.compose(v, q, sc); rockRef.current!.setMatrixAt(i, m)
      })
      rockRef.current.instanceMatrix.needsUpdate = true
    }
    if (lampRef.current) {
      lampPts.forEach((p, i) => {
        eul.set(0, 0, 0); q.setFromEuler(eul)
        v.set(p.x, 1.6, p.z); sc.setScalar(1)
        m.compose(v, q, sc); lampRef.current!.setMatrixAt(i, m)
      })
      lampRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      <instancedMesh ref={trunkRef} args={[undefined, undefined, treePts.length]} castShadow>
        <cylinderGeometry args={[0.18, 0.25, 1.2, 6]} />
        <meshStandardMaterial color="#5a4632" roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={leafRef} args={[undefined, undefined, treePts.length]} castShadow>
        <coneGeometry args={[0.9, 2.2, 8]} />
        <meshStandardMaterial color="#3f7a5a" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={rockRef} args={[undefined, undefined, rockPts.length]} castShadow>
        <dodecahedronGeometry args={[0.6, 0]} />
        <meshStandardMaterial color="#3a3d42" roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={lampRef} args={[undefined, undefined, lampPts.length]}>
        <cylinderGeometry args={[0.08, 0.1, 3.2, 6]} />
        <meshStandardMaterial color="#2a2d33" emissive="#FFD600" emissiveIntensity={0.4} />
      </instancedMesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 远端玩家化身
// ---------------------------------------------------------------------------
function RemoteAvatar({ userId, playersRef }: {
  userId: string
  playersRef: MutableRefObject<Map<string, RemotePlayer>>
}) {
  const groupRef = useRef<THREE.Group>(null)
  const player = playersRef.current.get(userId)

  let displayName = '玩家'
  let avatarColor = hashColor(userId)
  if (player) {
    displayName = player.nickname
    if (player.avatarType === 'celebrity' && player.avatarRef) {
      const celeb = getCelebrity(player.avatarRef)
      if (celeb) displayName = celeb.name
    }
    avatarColor = player.avatarType === 'capsule' ? hashColor(player.userId) : '#4fb3a5'
  }

  useFrame(() => {
    const p = playersRef.current.get(userId)
    if (!p || !groupRef.current) return
    const g = groupRef.current
    g.position.x = THREE.MathUtils.lerp(g.position.x, p.targetX, 0.12)
    g.position.z = THREE.MathUtils.lerp(g.position.z, p.targetZ, 0.12)
    g.rotation.y = p.rotation
  })

  if (!player) return null
  return (
    <group ref={groupRef} position={[player.x, 0, player.z]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.26, 0.6, 8, 16]} />
        <meshStandardMaterial color={avatarColor} roughness={0.4} metalness={0.1} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={avatarColor} roughness={0.5} />
      </mesh>
      <Billboard position={[0, 1.7, 0]}>
        <Text fontSize={0.28} color="#FFFFFF" anchorX="center" anchorY="middle" outlineWidth={0.015} outlineColor="#000000" raycast={() => null}>
          {displayName}
        </Text>
      </Billboard>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 主场景
// ---------------------------------------------------------------------------
interface WorldSceneProps {
  world: WorldRuntime
  manifest: WorldManifest | null
  playersRef: MutableRefObject<Map<string, RemotePlayer>>
  remoteUserIds: string[]
}

export default function WorldScene({ world, manifest, playersRef, remoteUserIds }: WorldSceneProps) {
  // 在 manifest 里按 assetId 找建筑资产
  const assetFor = (building: BuildingConfig) =>
    manifest?.assets.find((a) => a.id === building.assetId) ?? undefined

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <fog attach="fog" args={['#0a0a0a', 40, 180]} />

      {/* 光照：环境光 + 半球光 + 平行光（带阴影） */}
      <ambientLight intensity={0.5} />
      <hemisphereLight args={['#3a3f4a', '#0a0a0a', 0.5]} />
      <directionalLight
        position={[40, 60, 30]}
        intensity={1.6}
        castShadow
        shadow-mapSize={[2048, 2048]}
        shadow-camera-left={-80}
        shadow-camera-right={80}
        shadow-camera-top={80}
        shadow-camera-bottom={-80}
      />

      {/* 地面 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[WORLD_HALF * 2, WORLD_HALF * 2]} />
        <meshStandardMaterial color="#14161a" roughness={1} />
      </mesh>

      {/* 中央广场圆形地台 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <circleGeometry args={[16, 48]} />
        <meshStandardMaterial color="#1e2126" roughness={0.9} />
      </mesh>

      {/* 环形道路（半径 70，宽 6） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[67, 73, 64]} />
        <meshStandardMaterial color="#23262c" roughness={0.95} />
      </mesh>

      {/* 中央喷泉 */}
      <Fountain />

      {/* 6 大建筑 */}
      {BUILDINGS.map((b) => {
        const asset = assetFor(b)
        return asset ? (
          <GltfBuilding key={b.id} path={`/models/world/${asset.path}`} building={b} />
        ) : (
          <BuildingPlaceholder key={b.id} building={b} />
        )
      })}

      {/* 自然植被（树/石/灯） */}
      <Nature />

      {/* 边界山（一圈大锥，视觉上封闭世界） */}
      <BoundaryMountains />

      {/* 远端玩家 */}
      {remoteUserIds.map((uid) => (
        <RemoteAvatar key={uid} userId={uid} playersRef={playersRef} />
      ))}
    </>
  )
}

/** 外围一圈大山，视觉边界 */
function BoundaryMountains() {
  const rand = useMemo(() => mulberry32(7), [])
  const mountains = useMemo(() => {
    const arr: Array<{ x: number; z: number; s: number }> = []
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2
      const r = WORLD_HALF + 8 + rand() * 10
      arr.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r, s: 8 + rand() * 12 })
    }
    return arr
  }, [rand])
  return (
    <group>
      {mountains.map((m, i) => (
        <mesh key={i} position={[m.x, m.s / 2 - 1, m.z]}>
          <coneGeometry args={[m.s * 0.7, m.s, 5]} />
          <meshStandardMaterial color="#1a1d22" roughness={1} />
        </mesh>
      ))}
    </group>
  )
}

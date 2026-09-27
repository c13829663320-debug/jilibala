/**
 * 开放世界 · 主场景（中央广场）
 * ------------------------------------------------------------------
 * 负责把地面/道路/中央广场/6 大建筑/自然植被/边界山/远端玩家 全部摆出来。
 * manifest 加载成功 → 用 useGLTF 懒加载真实模型；失败/缺失 → 程序化几何体占位。
 * 重复物（树/石/灯/山）用 instancedMesh 复用，不为每个实例存 draw call。
 *
 * 美术规范统一引用 art-spec.ts：BRAND / PLAZA_LIGHTING / FOG / SKY_GRADIENT /
 * MATERIAL / PERF_BUDGET，不在此文件硬编码颜色或光照参数。
 */
import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { Billboard, Text, useGLTF, Html } from '@react-three/drei'
import * as THREE from 'three'
import type { BuildingConfig, RemotePlayer, WorldManifest, WorldRuntime } from './types'
import { BUILDINGS, FOUNTAIN, WORLD_HALF } from './config'
import {
  BRAND, PLAZA_LIGHTING, FOG, SKY_GRADIENT, MATERIAL, PERF_BUDGET,
} from './art-spec'
import { collectiblesForScene, collectItem, loadCollected } from './collectibles'
import { CollectibleLayer } from './CollectibleMesh'
import { RemoteAvatar } from '../avatar/RemoteAvatar'
import PickupableProps from './PickupableProps'

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
// 程序化渐变天空盒（零贴图：大球 BackSide + ShaderMaterial 按高度插值）
// ---------------------------------------------------------------------------
function SkyDome() {
  const material = useMemo(() => {
    return new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms: {
        uTop: { value: new THREE.Color(SKY_GRADIENT.top) },
        uMid: { value: new THREE.Color(SKY_GRADIENT.mid) },
        uHorizon: { value: new THREE.Color(SKY_GRADIENT.horizon) },
        uBottom: { value: new THREE.Color(SKY_GRADIENT.bottom) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop;
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uBottom;
        varying vec3 vDir;
        void main() {
          float h = vDir.y;
          vec3 col;
          if (h >= 0.0) {
            col = mix(uHorizon, uMid, smoothstep(0.02, 0.28, h));
            col = mix(col, uTop, smoothstep(0.28, 0.75, h));
          } else {
            col = mix(uHorizon, uBottom, smoothstep(0.0, -0.35, h));
          }
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    })
  }, [])
  return (
    <mesh material={material} renderOrder={-10} frustumCulled={false}>
      <sphereGeometry args={[260, 24, 16]} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// 程序化地砖纹理（256px canvas，重复平铺，零外部图片）
// ---------------------------------------------------------------------------
function makePlazaTileTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas')
  c.width = c.height = 256
  const ctx = c.getContext('2d')!
  // 底色（面板色）
  ctx.fillStyle = BRAND.panel
  ctx.fillRect(0, 0, 256, 256)
  // 四块砖，砖缝用次级深色
  ctx.strokeStyle = BRAND.bgMid
  ctx.lineWidth = 3
  ctx.strokeRect(0, 0, 128, 128)
  ctx.strokeRect(128, 0, 128, 128)
  ctx.strokeRect(0, 128, 128, 128)
  ctx.strokeRect(128, 128, 128, 128)
  // 每块砖里加一点明暗变化，模拟石材
  const rand = mulberry32(11)
  for (let i = 0; i < 400; i++) {
    const x = rand() * 256
    const y = rand() * 256
    const a = 0.04 + rand() * 0.05
    ctx.fillStyle = rand() > 0.5 ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`
    ctx.fillRect(x, y, 2, 2)
  }
  const tex = new THREE.CanvasTexture(c)
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping
  tex.anisotropy = 2
  tex.colorSpace = THREE.SRGBColorSpace
  return tex
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
        <meshStandardMaterial color={building.color} roughness={MATERIAL.defaultRoughness} metalness={MATERIAL.defaultMetalness} />
      </mesh>
      {/* 屋顶（锥形） */}
      <mesh position={[0, h + 1, 0]} castShadow>
        <coneGeometry args={[Math.max(w, d) * 0.65, 2.2, 4]} />
        <meshStandardMaterial color={BRAND.bgMid} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      {/* 入口门（正面 +Z 方向，朝向世界中心一侧）—— 品牌黄发光指示 */}
      <mesh position={[0, 1.2, d / 2 + 0.05]}>
        <boxGeometry args={[1.6, 2.4, 0.1]} />
        <meshStandardMaterial color={BRAND.bgDark} emissive={BRAND.yellow} emissiveIntensity={MATERIAL.emissiveIntensity * 2} />
      </mesh>
      {/* 悬浮名牌 */}
      <Billboard position={[0, h + 3.2, 0]}>
        <Text fontSize={1.1} color={BRAND.yellow} anchorX="center" anchorY="middle" outlineWidth={0.04} outlineColor={BRAND.bgDark} raycast={() => null}>
          {building.emoji} {building.name}
        </Text>
      </Billboard>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 中央喷泉（水面波纹动画 + 周围地砖装饰）
// ---------------------------------------------------------------------------
function Fountain() {
  const waterRef = useRef<THREE.Mesh>(null)
  const waterMatRef = useRef<THREE.MeshStandardMaterial>(null)

  useFrame((state) => {
    const t = state.clock.elapsedTime
    // 水面轻微呼吸：opacity 在 0.5~0.7 间脉动，scale 微胀
    if (waterMatRef.current) {
      waterMatRef.current.opacity = 0.55 + Math.sin(t * 2.2) * 0.1
    }
    if (waterRef.current) {
      const s = 1 + Math.sin(t * 1.5) * 0.02
      waterRef.current.scale.set(s, 1, s)
    }
  })

  return (
    <group position={[FOUNTAIN.x, 0, FOUNTAIN.z]}>
      {/* 水池基座 */}
      <mesh position={[0, 0.2, 0]} receiveShadow>
        <cylinderGeometry args={[FOUNTAIN.r + 0.6, FOUNTAIN.r + 0.8, 0.4, 32]} />
        <meshStandardMaterial color={BRAND.bgMid} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      {/* 水面（波纹动画） */}
      <mesh ref={waterRef} position={[0, 0.42, 0]}>
        <cylinderGeometry args={[FOUNTAIN.r, FOUNTAIN.r, 0.1, 32]} />
        <meshStandardMaterial
          ref={waterMatRef}
          color={BUILDING_THEME_TEAL}
          transparent
          opacity={0.6}
          roughness={0.2}
          metalness={0.3}
        />
      </mesh>
      {/* 中心雕像柱 */}
      <mesh position={[0, 1.6, 0]} castShadow>
        <cylinderGeometry args={[0.5, 0.7, 2.6, 12]} />
        <meshStandardMaterial color={BRAND.text} roughness={0.6} />
      </mesh>
      <mesh position={[0, 3.2, 0]} castShadow>
        <sphereGeometry args={[0.55, 16, 16]} />
        <meshStandardMaterial color={BRAND.yellow} roughness={0.3} metalness={0.4} />
      </mesh>
    </group>
  )
}
// 喷泉水面色引用健身房主题青（与原视觉一致），避免硬编码
const BUILDING_THEME_TEAL = '#4fb3a5'

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

  // 一次性写入所有 instance matrix（refs 挂载后写一次，不用每帧重写）
  useEffect(() => {
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
  }, [treePts, rockPts, lampPts])

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
        <meshStandardMaterial color={BRAND.bgMid} roughness={0.95} />
      </instancedMesh>
      <instancedMesh ref={lampRef} args={[undefined, undefined, lampPts.length]}>
        <cylinderGeometry args={[0.08, 0.1, 3.2, 6]} />
        <meshStandardMaterial color={BRAND.bgMid} emissive={BRAND.yellow} emissiveIntensity={0.4} />
      </instancedMesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 边界山（instanced + 雪顶，与天空盒地平线融合）
// ---------------------------------------------------------------------------
function BoundaryMountains() {
  const bodyRef = useRef<THREE.InstancedMesh>(null)
  const snowRef = useRef<THREE.InstancedMesh>(null)

  const mountains = useMemo(() => {
    const rand = mulberry32(7)
    const arr: Array<{ x: number; z: number; s: number }> = []
    for (let i = 0; i < 40; i++) {
      const ang = (i / 40) * Math.PI * 2
      const r = WORLD_HALF + 8 + rand() * 10
      arr.push({ x: Math.cos(ang) * r, z: Math.sin(ang) * r, s: 8 + rand() * 12 })
    }
    return arr
  }, [])

  useEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const eul = new THREE.Euler()
    const v = new THREE.Vector3()
    const sc = new THREE.Vector3()
    if (bodyRef.current) {
      mountains.forEach((mt, i) => {
        eul.set(0, 0, 0); q.setFromEuler(eul)
        v.set(mt.x, mt.s / 2 - 1, mt.z); sc.setScalar(1)
        m.compose(v, q, sc); bodyRef.current!.setMatrixAt(i, m)
      })
      bodyRef.current.instanceMatrix.needsUpdate = true
    }
    if (snowRef.current) {
      mountains.forEach((mt, i) => {
        // 雪顶放在山体上方约 70% 高度处，尺寸约山体 25%
        eul.set(0, 0, 0); q.setFromEuler(eul)
        v.set(mt.x, mt.s * 0.75 - 1, mt.z)
        sc.set(mt.s * 0.28, mt.s * 0.3, mt.s * 0.28)
        m.compose(v, q, sc); snowRef.current!.setMatrixAt(i, m)
      })
      snowRef.current.instanceMatrix.needsUpdate = true
    }
  }, [mountains])

  return (
    <group>
      {/* 山体本体（深灰紫，与地平线雾色接近） */}
      <instancedMesh ref={bodyRef} args={[undefined, undefined, mountains.length]}>
        <coneGeometry args={[1, 1, 5]} />
        <meshStandardMaterial color="#1a1d26" roughness={1} />
      </instancedMesh>
      {/* 雪顶（白/浅蓝，与天空盒顶色呼应） */}
      <instancedMesh ref={snowRef} args={[undefined, undefined, mountains.length]}>
        <coneGeometry args={[1, 1, 5]} />
        <meshStandardMaterial color="#d8e0ec" roughness={0.9} />
      </instancedMesh>
    </group>
  )
}

// ---------------------------------------------------------------------------
// 环形道路发光车道线（品牌黄细环，引导沿环道行进）
// ---------------------------------------------------------------------------
function RingRoadGlow() {
  // 单条中线发光环（节省 draw call），引导沿环道行进
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[69.85, 70.15, 96]} />
      <meshBasicMaterial color={BRAND.yellow} transparent opacity={0.5} side={THREE.DoubleSide} />
    </mesh>
  )
}

// ---------------------------------------------------------------------------
// 性能统计浮层（开发模式显示 draw call 数）
// ---------------------------------------------------------------------------
function PerfStats() {
  const gl = useThree((s) => s.gl)
  const [calls, setCalls] = useState(0)
  // 本地开发环境显示（localhost / 127.0.0.1）
  const isDev = typeof window !== 'undefined' &&
    (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  useFrame(() => {
    // 每 ~20 帧采样一次，避免 setState 高频触发
    if (Math.floor(gl.info.render.frame) % 20 === 0) {
      setCalls(gl.info.render.calls)
    }
  })

  if (!isDev) return null
  const overBudget = calls > PERF_BUDGET.plazaMaxDrawCalls
  return (
    <Html position={[0, 0, 0]} center style={{ pointerEvents: 'none' }}>
      <div
        style={{
          position: 'absolute', left: 8, bottom: 8, zIndex: 30,
          padding: '4px 8px', borderRadius: 4, fontSize: 11,
          fontFamily: 'monospace', color: BRAND.text,
          background: 'rgba(10,10,10,0.7)',
          border: `1px solid ${overBudget ? '#e07a5f' : BRAND.yellow}`,
        }}
      >
        draw calls: {calls} / {PERF_BUDGET.plazaMaxDrawCalls}
      </div>
    </Html>
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
  /** 本地玩家位置（R4-03 LOD 距离分级） */
  localPosRef?: MutableRefObject<{ x: number; z: number }>
  /** 点击远端玩家时触发（R4-03 弹出玩家上下文菜单） */
  onRemotePlayerSelect?: (userId: string, clientX: number, clientY: number) => void
}

export default function WorldScene({ world, manifest, playersRef, remoteUserIds, localPosRef, onRemotePlayerSelect }: WorldSceneProps) {
  // 在 manifest 里按 assetId 找建筑资产
  const assetFor = (building: BuildingConfig) =>
    manifest?.assets.find((a) => a.id === building.assetId) ?? undefined

  // ---- 收集品：广场 6 个，已收集集合走 React state（拾取后刷新） ----
  const plazaItems = useMemo(() => collectiblesForScene('plaza'), [])
  const [collectedSet, setCollectedSet] = useState<Set<string>>(() => loadCollected())

  useEffect(() => {
    const onCollected = () => setCollectedSet(loadCollected())
    window.addEventListener('balabala:collectible', onCollected)
    return () => window.removeEventListener('balabala:collectible', onCollected)
  }, [])

  const handleCollect = useCallback((id: string) => {
    collectItem(id)
    // collectItem 会派发 'balabala:collectible' 事件 → 上面监听器刷新 state
  }, [])

  // 玩家位置直接传 mutable world.player（CollectibleMesh 在 useFrame 里读 .x/.y/.z）
  const playerPos = world.player

  // 程序化地砖纹理（仅客户端）
  const groundTileTex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const tex = makePlazaTileTexture()
    tex.repeat.set(26, 26)
    return tex
  }, [])
  const plazaTileTex = useMemo(() => {
    if (typeof document === 'undefined') return null
    const tex = makePlazaTileTexture()
    tex.repeat.set(6, 6)
    return tex
  }, [])

  return (
    <>
      <color attach="background" args={[SKY_GRADIENT.bottom]} />
      <fog attach="fog" args={[FOG.color, FOG.plazaNear, FOG.plazaFar]} />

      {/* 渐变天空盒（零贴图） */}
      <SkyDome />

      {/* 光照：全部引用 PLAZA_LIGHTING 规范 */}
      <ambientLight intensity={PLAZA_LIGHTING.ambientIntensity} />
      <hemisphereLight
        args={[PLAZA_LIGHTING.hemisphereSky, PLAZA_LIGHTING.hemisphereGround, PLAZA_LIGHTING.hemisphereIntensity]}
      />
      <directionalLight
        position={PLAZA_LIGHTING.directionalPosition}
        intensity={PLAZA_LIGHTING.directionalIntensity}
        castShadow
        shadow-mapSize={[PLAZA_LIGHTING.shadowMapSize, PLAZA_LIGHTING.shadowMapSize]}
        shadow-camera-left={-PLAZA_LIGHTING.shadowCameraBounds}
        shadow-camera-right={PLAZA_LIGHTING.shadowCameraBounds}
        shadow-camera-top={PLAZA_LIGHTING.shadowCameraBounds}
        shadow-camera-bottom={-PLAZA_LIGHTING.shadowCameraBounds}
      />

      {/* 地面（程序化地砖纹理） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[WORLD_HALF * 2, WORLD_HALF * 2]} />
        {groundTileTex ? (
          <meshStandardMaterial map={groundTileTex} color={BRAND.bgMid} roughness={1} />
        ) : (
          <meshStandardMaterial color={BRAND.bgMid} roughness={1} />
        )}
      </mesh>

      {/* 中央广场圆形地台（地砖纹理） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]} receiveShadow>
        <circleGeometry args={[16, 48]} />
        {plazaTileTex ? (
          <meshStandardMaterial map={plazaTileTex} color={BRAND.panel} roughness={0.9} />
        ) : (
          <meshStandardMaterial color={BRAND.panel} roughness={0.9} />
        )}
      </mesh>

      {/* 环形道路（半径 70，宽 6） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <ringGeometry args={[67, 73, 64]} />
        <meshStandardMaterial color={BRAND.road} roughness={0.95} />
      </mesh>
      {/* 环形道路发光车道线 */}
      <RingRoadGlow />

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

      {/* 自然植被（树/石/灯，instanced） */}
      <Nature />

      {/* R4-09: 可拾取 CC0 道具（靠近高亮，E 键拾取/放下） */}
      <PickupableProps world={world} localPosRef={localPosRef} />

      {/* 边界山（instanced + 雪顶） */}
      <BoundaryMountains />

      {/* 广场收集品层（6 个） */}
      <CollectibleLayer
        items={plazaItems}
        collectedSet={collectedSet}
        onCollect={handleCollect}
        playerPos={playerPos}
      />

      {/* 远端玩家（R4-03：传入本地位置做 LOD 分级；点击弹上下文菜单） */}
      {remoteUserIds.map((uid) => (
        <RemoteAvatar
          key={uid}
          userId={uid}
          playersRef={playersRef}
          localPosRef={localPosRef}
          onSelect={onRemotePlayerSelect}
        />
      ))}

      {/* 性能统计浮层（开发模式） */}
      <PerfStats />
    </>
  )
}

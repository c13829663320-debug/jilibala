import { Component, Suspense, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { OrbitControls, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import './room-entry.css'
import TopNav, { type TopView } from './TopNav'

export type RoomEntryProps = {
  onEnter: () => void
  onArchive: () => void
  onAvatar: () => void
  onCharacters?: () => void
  onCreateCharacter?: () => void
  onPlaza?: () => void
  onMyPage?: () => void
  onEnterTalkshow?: () => void
  onEnterWerewolf?: () => void
  onEnterBar?: () => void
  onEnterLibrary?: () => void
  onEnterGym?: () => void
  /** 进入「创造世界」工作室。 */
  onEnterSceneStudio?: () => void
  /** 进入「我的场景」列表。 */
  onMyScenes?: () => void
}

type Item = {
  id: string; label: string; eyebrow: string; hint: string; color: string
  model: string
  modelScale?: number
  modelYaw?: number
}

const SCENES: Item[] = [
  { id: 'court', label: '趣味法庭', eyebrow: 'SCENE 01 · ONLINE', hint: '开庭审判，AI 陪审团实时裁决', color: '#ffc83d', model: '/models/home-court.glb' },
  { id: 'talkshow', label: '脱口秀剧场', eyebrow: 'SCENE 02 · ONLINE', hint: '上台讲段子，AI 观众实时反应', color: '#ff5b61', model: '/models/home-talk.glb' },
  { id: 'werewolf', label: '狼人杀馆', eyebrow: 'SCENE 03 · ONLINE', hint: '夜晚圆桌，身份迷局，AI 名人陪玩', color: '#357be8', model: '/models/home-werewolf.glb' },
  { id: 'bar', label: '酒吧辩论赛', eyebrow: 'SCENE 04 · ONLINE', hint: '与名人围坐对辩，酒保总结金句', color: '#11c99a', model: '/models/home-bar-neon.glb' },
  { id: 'gym', label: '健身房', eyebrow: 'SCENE 05 · ONLINE', hint: 'AI 教练 + 名人带练，多人云健身', color: '#f18820', model: '/models/home-gym.glb' },
  { id: 'library', label: '图书馆', eyebrow: 'SCENE 06 · ONLINE', hint: '名人读书会与深度问答', color: '#7e52c7', model: '/models/home-library.glb' },
]

// ---- 各模型内部小部件的待机动画 ----
// 部件名沿用 GLB 导出的 tripo_part_N。
// bob 上下漂浮；slide 沿轴微滑；swing 绕底/中心摆动；spin 自转；glow 自发光脉动。
type PartAnim =
  | { part: string; type: 'bob'; amp: number; speed: number; phase: number }
  | { part: string; type: 'slide'; amp: number; speed: number; phase: number; axis: 'x' | 'z' }
  | { part: string; type: 'swing'; amp: number; speed: number; phase: number; pivot?: 'center' | 'bottom' }
  | { part: string; type: 'spin'; speed: number; phase: number }
  | { part: string; type: 'glow'; amp: number; speed: number; phase: number; gain?: number; flicker?: boolean; color?: string }

const PART_ANIMS: Record<string, PartAnim[]> = {
  court: [
    { part: 'tripo_part_1', type: 'swing', amp: 0.14, speed: 2.2, phase: 0, pivot: 'bottom' },
    { part: 'tripo_part_2', type: 'swing', amp: 0.06, speed: 1.5, phase: 1.0 },
    { part: 'tripo_part_2', type: 'glow', amp: 0.45, speed: 1.6, phase: 0.8, gain: 1.3 },
  ],
  talkshow: [
    { part: 'tripo_part_0', type: 'swing', amp: 0.05, speed: 1.6, phase: 0.5, pivot: 'bottom' },
    { part: 'tripo_part_0', type: 'glow', amp: 0.5, speed: 2.5, phase: 0 },
    { part: 'tripo_part_1', type: 'glow', amp: 0.5, speed: 2.5, phase: 0.7 },
    { part: 'tripo_part_2', type: 'glow', amp: 0.5, speed: 2.5, phase: 1.4 },
    { part: 'tripo_part_3', type: 'glow', amp: 0.5, speed: 2.5, phase: 2.1 },
    { part: 'tripo_part_4', type: 'glow', amp: 0.5, speed: 2.5, phase: 2.8 },
    { part: 'tripo_part_5', type: 'glow', amp: 0.5, speed: 2.5, phase: 3.5 },
    { part: 'tripo_part_6', type: 'glow', amp: 0.5, speed: 2.5, phase: 4.2 },
    { part: 'tripo_part_7', type: 'glow', amp: 0.5, speed: 2.5, phase: 4.9 },
  ],
  werewolf: [
    { part: 'tripo_part_2', type: 'glow', amp: 0.5, speed: 1.8, phase: 0, gain: 1.2 },
    { part: 'tripo_part_3', type: 'glow', amp: 0.45, speed: 2.0, phase: 1.2, gain: 1.2 },
    { part: 'tripo_part_9', type: 'bob', amp: 0.04, speed: 1.8, phase: 0 },
    { part: 'tripo_part_9', type: 'glow', amp: 0.45, speed: 2.2, phase: 0.6, gain: 1.3 },
    { part: 'tripo_part_10', type: 'bob', amp: 0.04, speed: 1.8, phase: 2.0 },
    { part: 'tripo_part_10', type: 'glow', amp: 0.45, speed: 2.2, phase: 2.6, gain: 1.3 },
    { part: 'tripo_part_11', type: 'glow', amp: 0.4, speed: 5.1, phase: 0.4, gain: 1.7, flicker: true, color: '#ffab5e' },
    { part: 'tripo_part_12', type: 'glow', amp: 0.4, speed: 5.9, phase: 1.7, gain: 1.7, flicker: true, color: '#ffab5e' },
    { part: 'tripo_part_13', type: 'glow', amp: 0.35, speed: 6.7, phase: 2.9, gain: 1.8, flicker: true, color: '#ffc06a' },
    { part: 'tripo_part_14', type: 'bob', amp: 0.025, speed: 2.2, phase: 1.0 },
    { part: 'tripo_part_14', type: 'glow', amp: 0.35, speed: 4.5, phase: 3.8, gain: 1.7, flicker: true, color: '#ffab5e' },
    { part: 'tripo_part_15', type: 'spin', speed: 0.7, phase: 0 },
  ],
  bar: [
    { part: 'tripo_part_13', type: 'glow', amp: 0.45, speed: 5.5, phase: 0, gain: 1.8, flicker: true, color: '#ff4fd8' },
    { part: 'tripo_part_14', type: 'glow', amp: 0.45, speed: 6.3, phase: 1.5, gain: 1.8, flicker: true, color: '#37e0ff' },
    { part: 'tripo_part_4', type: 'glow', amp: 0.5, speed: 1.8, phase: 0.3, gain: 1.3, color: '#b97fff' },
    { part: 'tripo_part_6', type: 'glow', amp: 0.5, speed: 2.2, phase: 1.0, gain: 1.3, color: '#ff5edb' },
    { part: 'tripo_part_6', type: 'bob', amp: 0.03, speed: 1.6, phase: 0.4 },
    { part: 'tripo_part_9', type: 'glow', amp: 0.5, speed: 2.0, phase: 0.8, gain: 1.3, color: '#ffcf6a' },
    { part: 'tripo_part_9', type: 'bob', amp: 0.04, speed: 1.8, phase: 0 },
    { part: 'tripo_part_7', type: 'glow', amp: 0.4, speed: 2.4, phase: 1.8, gain: 1.2, color: '#ffab5e' },
    { part: 'tripo_part_11', type: 'glow', amp: 0.4, speed: 2.6, phase: 2.6, gain: 1.2, color: '#ffa050' },
    { part: 'tripo_part_2', type: 'swing', amp: 0.05, speed: 1.4, phase: 0.5, pivot: 'bottom' },
    { part: 'tripo_part_8', type: 'bob', amp: 0.03, speed: 1.5, phase: 1.2 },
    { part: 'tripo_part_10', type: 'bob', amp: 0.03, speed: 1.7, phase: 2.0 },
  ],
  gym: [
    { part: 'tripo_part_3', type: 'bob', amp: 0.06, speed: 2.0, phase: 0 },
    { part: 'tripo_part_3', type: 'glow', amp: 0.4, speed: 2.0, phase: 0.8 },
    { part: 'tripo_part_5', type: 'bob', amp: 0.06, speed: 2.0, phase: 1.6 },
    { part: 'tripo_part_6', type: 'bob', amp: 0.04, speed: 2.4, phase: 0.8 },
    { part: 'tripo_part_6', type: 'glow', amp: 0.35, speed: 2.6, phase: 2.4, gain: 1.2 },
  ],
  library: [
    { part: 'tripo_part_2', type: 'slide', amp: 0.025, speed: 1.2, phase: 0, axis: 'x' },
    { part: 'tripo_part_3', type: 'slide', amp: 0.025, speed: 1.4, phase: 0.9, axis: 'x' },
    { part: 'tripo_part_3', type: 'glow', amp: 0.4, speed: 1.4, phase: 1.9 },
    { part: 'tripo_part_6', type: 'slide', amp: 0.025, speed: 1.1, phase: 1.8, axis: 'x' },
    { part: 'tripo_part_11', type: 'slide', amp: 0.025, speed: 1.3, phase: 2.7, axis: 'x' },
    { part: 'tripo_part_12', type: 'slide', amp: 0.025, speed: 1.5, phase: 3.6, axis: 'x' },
    { part: 'tripo_part_5', type: 'slide', amp: 0.03, speed: 1.0, phase: 0.5, axis: 'x' },
    { part: 'tripo_part_5', type: 'glow', amp: 0.45, speed: 1.2, phase: 1.1 },
    { part: 'tripo_part_9', type: 'slide', amp: 0.03, speed: 1.2, phase: 2.2, axis: 'x' },
    { part: 'tripo_part_10', type: 'slide', amp: 0.025, speed: 1.4, phase: 4.0, axis: 'x' },
    { part: 'tripo_part_7', type: 'glow', amp: 0.4, speed: 1.6, phase: 2.8 },
    { part: 'tripo_part_14', type: 'bob', amp: 0.02, speed: 1.8, phase: 1.0 },
    { part: 'tripo_part_14', type: 'glow', amp: 0.45, speed: 1.9, phase: 3.3 },
  ],
}

interface AnimTarget {
  cfg: PartAnim
  obj?: THREE.Object3D
  base?: THREE.Vector3
  pivot?: THREE.Group
  mats?: THREE.MeshStandardMaterial[]
  acc: number
}

// ---- 弧形排布：6 个模型沿对称浅弧排开 ----
const ARC_SLOTS = [
  { deg: -52, radius: 6.7 },
  { deg: -32, radius: 7.05 },
  { deg: -11, radius: 7.4 },
  { deg: 11, radius: 7.4 },
  { deg: 32, radius: 7.05 },
  { deg: 52, radius: 6.7 },
]
const ARC_CENTER_Z = 4.2
const MODEL_SIZE = 2.1
const FLOOR_Y = -1.02
const CAMERA_POSITION: [number, number, number] = [0, 2.35, 10.6]
const ORBIT_TARGET: [number, number, number] = [0, 0.6, 0]
const ARC_HALF_SPAN_DEG = 36
const ARC_SPREAD_DEG = 7

function arcSlot(index: number, spreadDeg = 0, dir = 0) {
  const slot = ARC_SLOTS[index] ?? ARC_SLOTS[ARC_SLOTS.length - 1]
  const deg = slot.deg + dir * spreadDeg
  const angle = (deg * Math.PI) / 180
  const x = slot.radius * Math.sin(angle)
  const z = ARC_CENTER_Z - slot.radius * Math.cos(angle)
  return {
    position: [x, FLOOR_Y, z] as [number, number, number],
    rotationY: Math.atan2(-x, CAMERA_POSITION[2] - z) * 0.9,
  }
}

function SceneSlot({ index, pushed, dir, modelYaw, children }: { index: number; pushed: boolean; dir: number; modelYaw: number; children: ReactNode }) {
  const rest = useMemo(() => arcSlot(index), [index])
  const spread = useMemo(() => arcSlot(index, ARC_SPREAD_DEG, dir), [index, dir])
  const ref = useRef<THREE.Group | null>(null)
  useFrame((_, delta) => {
    if (!ref.current) return
    const target = pushed ? spread : rest
    ref.current.position.x = THREE.MathUtils.damp(ref.current.position.x, target.position[0], 4, delta)
    ref.current.position.z = THREE.MathUtils.damp(ref.current.position.z, target.position[2], 4, delta)
    ref.current.rotation.y = THREE.MathUtils.damp(ref.current.rotation.y, target.rotationY + modelYaw, 4, delta)
  })
  return <group ref={ref} position={rest.position} rotation={[0, rest.rotationY + modelYaw, 0]}>{children}</group>
}

/** 单个场景模型：懒加载 GLB、Box3 归一化、底面贴地、驱动内部部件待机动画 */
function SceneModel({ item, active, onClick, onHover }: { item: Item; active: boolean; onClick: () => void; onHover: () => void }) {
  const { scene } = useGLTF(item.model, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new THREE.Box3().setFromObject(clone)
    const size = bounds.getSize(new THREE.Vector3())
    const center = bounds.getCenter(new THREE.Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const scale = (MODEL_SIZE * (item.modelScale ?? 1)) / maxSize
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    const dropped: THREE.Object3D[] = []
    clone.traverse((child) => {
      if ((child as THREE.Light).isLight || (child as THREE.Camera).isCamera) dropped.push(child)
      child.castShadow = true
      child.receiveShadow = true
    })
    dropped.forEach((object) => { object.parent?.remove(object) })
    return clone
  }, [scene, item.modelScale])

  const animTargets = useMemo<AnimTarget[]>(() => {
    const targets: AnimTarget[] = []
    for (const cfg of PART_ANIMS[item.id] ?? []) {
      const part = normalized.getObjectByName(cfg.part)
      if (!part) continue
      if (cfg.type === 'glow') {
        const mats: THREE.MeshStandardMaterial[] = []
        part.traverse((object) => {
          const material = (object as THREE.Mesh).material
          if (!material) return
          for (const mat of Array.isArray(material) ? material : [material]) {
            const standard = mat as THREE.MeshStandardMaterial
            if (cfg.color) standard.emissive = new THREE.Color(cfg.color)
            else if (standard.map && !standard.emissiveMap) {
              standard.emissiveMap = standard.map
              standard.emissive = new THREE.Color('#ffffff')
            } else continue
            standard.emissiveIntensity = 0
            standard.needsUpdate = true
            mats.push(standard)
          }
        })
        if (mats.length) targets.push({ cfg, mats, acc: cfg.phase })
        continue
      }
      if (cfg.type === 'bob' || cfg.type === 'slide') {
        targets.push({ cfg, obj: part, base: part.position.clone(), acc: cfg.phase })
        continue
      }
      const mesh = (part as THREE.Mesh).isMesh ? (part as THREE.Mesh) : part.getObjectByProperty('isMesh', true) as THREE.Mesh | null
      if (!mesh) continue
      mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      if (!box) continue
      const center = box.getCenter(new THREE.Vector3())
      const pivotY = cfg.type === 'swing' && cfg.pivot === 'bottom' ? box.min.y : center.y
      const pivotPos = new THREE.Vector3(center.x, pivotY, center.z)
      const pivot = new THREE.Group()
      part.parent?.add(pivot)
      pivot.position.copy(pivotPos)
      part.position.sub(pivotPos)
      pivot.add(part)
      targets.push({ cfg, pivot, acc: cfg.phase })
    }
    return targets
  }, [normalized, item.id])

  const ref = useRef<THREE.Group | null>(null)
  useFrame((state, delta) => {
    if (ref.current) {
      const next = THREE.MathUtils.damp(ref.current.scale.x, active ? 1.32 : 1, 6, delta)
      ref.current.scale.setScalar(next)
    }
    const speedBoost = active ? 1.2 : 1
    const glowBoost = active ? 1.4 : 1
    for (const target of animTargets) {
      const cfg = target.cfg
      if (cfg.type === 'spin') {
        target.pivot!.rotation.y += delta * cfg.speed * speedBoost
        continue
      }
      target.acc += delta * cfg.speed * speedBoost
      const value = Math.sin(target.acc) * cfg.amp
      if (cfg.type === 'bob') target.obj!.position.y = target.base!.y + value
      else if (cfg.type === 'slide') { if (cfg.axis === 'x') target.obj!.position.x = target.base!.x + value; else target.obj!.position.z = target.base!.z + value }
      else if (cfg.type === 'swing') target.pivot!.rotation.z = value
      else if (cfg.type === 'glow') {
        const wave = cfg.flicker ? Math.sin(target.acc) * 0.75 + Math.sin(target.acc * 2.33) * 0.25 : Math.sin(target.acc)
        const intensity = (0.35 + cfg.amp * (wave * 0.5 + 0.5)) * (cfg.gain ?? 1) * glowBoost
        for (const material of target.mats!) material.emissiveIntensity = Math.max(0, intensity)
      }
    }
  })
  return <group ref={ref} onPointerOver={(event) => { event.stopPropagation(); onHover() }} onClick={(event) => { event.stopPropagation(); onClick() }}>
    <primitive object={normalized} />
    <pointLight position={[0, 1.7, 1.5]} color={item.color} intensity={active ? 9 : 2.6} distance={7} />
  </group>
}

/** 某个模型加载失败时只隐藏它自己，不拖垮整个首页 */
class ModelBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

function AdaptiveFov() {
  useFrame(({ camera, size }, delta) => {
    const perspective = camera as THREE.PerspectiveCamera
    const aspect = size.width / Math.max(size.height, 1)
    const fit = 2 * Math.atan(Math.tan((ARC_HALF_SPAN_DEG * Math.PI) / 180) / Math.max(aspect, 0.1)) * (180 / Math.PI)
    const target = THREE.MathUtils.clamp(fit, 38, 58)
    if (Math.abs(perspective.fov - target) > 0.1) {
      perspective.fov = THREE.MathUtils.damp(perspective.fov, target, 2.5, delta)
      perspective.updateProjectionMatrix()
    }
  })
  return null
}

function OrbScene({ items, activeId, onActivate, onHover }: { items: Item[]; activeId: string; onActivate: (item: Item) => void; onHover: (item: Item) => void }) {
  const activeIndex = items.findIndex((entry) => entry.id === activeId)
  return <SafeCanvas camera={{ position: CAMERA_POSITION, fov: 44 }} dpr={[1, 1.7]} shadows>
    <color attach="background" args={['#080908']} /><fog attach="fog" args={['#080908', 16, 34]} />
    <ambientLight intensity={0.8} color="#c8d2dc" /><directionalLight position={[0, 6, 5]} intensity={2.4} color="#fff5dd" castShadow shadow-mapSize={[1024, 1024]} shadow-camera-left={-9} shadow-camera-right={9} shadow-camera-top={9} shadow-camera-bottom={-9} />
    <AdaptiveFov />
    {items.map((item, index) => {
      const isActive = index === activeIndex
      const dir = Math.sign(index - activeIndex)
      return <SceneSlot key={item.id} index={index} pushed={activeIndex >= 0 && !isActive} dir={dir} modelYaw={item.modelYaw ?? 0}>
        <ModelBoundary>
          <Suspense fallback={null}>
            <SceneModel item={item} active={isActive} onClick={() => onActivate(item)} onHover={() => onHover(item)} />
          </Suspense>
        </ModelBoundary>
      </SceneSlot>
    })}
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.02, -2]} receiveShadow><planeGeometry args={[34, 22]} /><meshStandardMaterial color="#0b0d0c" roughness={0.96} /></mesh>
    <gridHelper args={[32, 44, '#191b17', '#10120f']} position={[0, -1, -2]} />
    <OrbitControls enablePan={false} enableZoom={false} target={ORBIT_TARGET} rotateSpeed={0.5} minPolarAngle={1.4} maxPolarAngle={1.42} minAzimuthAngle={-0.28} maxAzimuthAngle={0.28} />
  </SafeCanvas>
}

export default function RoomEntry({ onEnter, onCharacters, onPlaza, onEnterTalkshow, onEnterWerewolf, onEnterBar, onEnterLibrary, onEnterGym, onMyPage, onEnterSceneStudio, onMyScenes }: RoomEntryProps) {
  const [activeId, setActiveId] = useState('court')
  const [notice, setNotice] = useState('')
  const items = SCENES

  // 统一顶部导航：把 TopNav 的 view 映射到本页回调。
  const onNavigate = (view: TopView) => {
    switch (view) {
      case 'characters': onCharacters?.(); break
      case 'plaza': onPlaza?.(); break
      case 'mypage': onMyPage?.(); break
      case 'talkshow': onEnterTalkshow?.(); break
      case 'werewolf': onEnterWerewolf?.(); break
      case 'bar': onEnterBar?.(); break
      case 'library': onEnterLibrary?.(); break
      case 'gym': onEnterGym?.(); break
      case 'scene-studio': onEnterSceneStudio?.(); break
      case 'my-scenes': onMyScenes?.(); break
      case 'court': setActiveId('court'); break
      default: break
    }
  }

  const openScene = (item: Item) => {
    setActiveId(item.id)
    if (item.id === 'court') { onEnter(); return }
    if (item.id === 'talkshow') { onEnterTalkshow?.(); return }
    if (item.id === 'werewolf') { onEnterWerewolf?.(); return }
    if (item.id === 'bar') { onEnterBar?.(); return }
    if (item.id === 'gym') { onEnterGym?.(); return }
    if (item.id === 'library') { onEnterLibrary?.(); return }
    setNotice(`${item.label} 暂不可用`)
  }

  return <main className="main-home" aria-label="BalaBala 平台主界面">
    <img src="/brand/hero-bg.png" alt="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.12, zIndex: 0, pointerEvents: 'none' }} />
    <TopNav currentView="home" onNavigate={onNavigate} />

    <section className="main-home__hero"><span className="main-home__kicker">BALA BALA SOCIAL WORLD</span><h1>选择一个场景，<em>开始你的故事。</em></h1><p>六大互动空间全部开放，自由进出。</p></section>

    <section className="main-home__create" aria-label="创造入口">
      <button type="button" className="main-home__create-card" onClick={() => onEnterSceneStudio?.()}>
        <span className="main-home__create-emoji">🎨</span>
        <span className="main-home__create-text"><b>创造世界</b><small>一句话生成专属 3D 场景，拉上 NPC 一起冒险</small></span>
        <i>↗</i>
      </button>
      <button type="button" className="main-home__create-card" onClick={() => onMyScenes?.()}>
        <span className="main-home__create-emoji">📁</span>
        <span className="main-home__create-text"><b>我的场景</b><small>管理、编辑、发布你创造过的每一个世界</small></span>
        <i>↗</i>
      </button>
    </section>

    <section className="main-home__scene" aria-label="场景空间">
      <OrbScene items={items} activeId={activeId} onActivate={openScene} onHover={(item) => setActiveId(item.id)} />
    </section>

    <section className="main-home__modules" aria-label="场景列表">
      {items.map((item) => (
        <button type="button" key={item.id} className={activeId === item.id ? 'is-active' : ''} onMouseEnter={() => setActiveId(item.id)} onFocus={() => setActiveId(item.id)} onClick={() => openScene(item)}>
          <span>{item.eyebrow}</span><b>{item.label}</b><small>{item.hint}</small><i>↗</i>
        </button>
      ))}
    </section>

    {notice && <button type="button" className="main-home__notice" onClick={() => setNotice('')}>{notice}<span>×</span></button>}
    <footer className="main-home__footer"><span>© 2025 BALABALA</span><span>6 / 6 个场景已开放</span></footer>
    {/* AI 生成短视频展示条 */}
    <div style={{ position: 'fixed', left: 16, bottom: 118, zIndex: 3, display: 'flex', gap: 8, padding: 8, background: 'rgba(15,15,15,.72)', border: '1px solid rgba(79,179,165,.32)', borderRadius: 10, backdropFilter: 'blur(10px)', WebkitBackdropFilter: 'blur(10px)' }}>
      {['/videos/court-opening.mp4', '/videos/plaza-overview.mp4'].map((src) => (
        <video key={src} src={src} autoPlay muted loop playsInline style={{ width: 150, height: 84, objectFit: 'cover', borderRadius: 6, display: 'block' }} />
      ))}
    </div>
  </main>
}

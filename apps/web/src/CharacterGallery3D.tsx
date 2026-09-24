import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { useFrame, type ThreeEvent } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Billboard, Environment, Lightformer, Text, useGLTF } from '@react-three/drei'
import { Box3, Group, InstancedMesh, MathUtils, Matrix4, MeshStandardMaterial, Points, Vector3 } from 'three'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import NeutralMannequin from './NeutralMannequin'
import { useSceneCleanup } from './useSceneCleanup'
import type { GalleryEntry } from './character-gallery'

/* ==========================================================================
 * 3D 人物馆：全屏环形选人界面。
 * 所有人物围成一个水平圆环，相机固定在圈外正面，整圈绕 Y 轴旋转切换选中人物。
 * 选中人物严格居于屏幕正中央（吸附后 group.rotation.y = -(activeIndex/count)*2π，
 * 此时 activeIndex 号 booth 世界坐标 x=0, z=-RING_RADIUS）。
 * 支持：拖拽 + 惯性 + 松手吸附、左右箭头 / ←/→ 循环切换、点两侧人物旋转聚焦、
 * 点居中人物直接进对话。布局/角度约定在 character-gallery.ts 的 ringLayout。
 * ======================================================================== */

/** 相机固定在圈外正面。 */
const CAMERA_POS: [number, number, number] = [0, 1.6, 8.5]
const CAMERA_LOOK: [number, number, number] = [0, 1.2, 0]
const FOV = 50
/** 仅加载当前 ±N 个展台的真实 GLB，其余用占位人形，控制首屏模型数（环形按圆周距离）。 */
const LOAD_NEARBY = 4
const PLINTH_TOP = 0.14
/** 人物整体归一化身高。 */
const FIGURE_HEIGHT = 2.35
const FIGURE_SCALE = FIGURE_HEIGHT / 1.7

/** 拖拽手势状态（外层 DOM 事件写，Canvas 内 useFrame 读）。 */
type DragState = {
  down: boolean
  moved: boolean
  startX: number
  startT: number
  startRot: number
  lastX: number
  lastT: number
  velocity: number
  releaseAt: number
}

const freshDrag = (): DragState => ({
  down: false, moved: false, startX: 0, startT: 0, startRot: 0,
  lastX: 0, lastT: 0, velocity: 0, releaseAt: 0,
})

/** 圆周最短索引距离（0..count/2）。 */
function circularDist(i: number, active: number, count: number): number {
  if (count <= 1) return 0
  const d = Math.abs(i - active) % count
  return Math.min(d, count - d)
}

/** 按与居中位的角度距离计算缩放：C 位 1.15x，超过 90° 退到 0.6。 */
function scaleForAngle(angleDist: number, active: boolean): number {
  if (active) return 1.15
  const t = Math.min(angleDist / (Math.PI / 2), 1)
  return MathUtils.lerp(1.15, 0.6, t)
}

/** 整个 3D 长廊渲染失败时（如模型解码失败）→ 通知父级回退 2D 平面视图。 */
class GalleryErrorBoundary extends Component<{ onError: () => void; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Character gallery 3D failed, falling back to 2D', error, info.componentStack)
    this.props.onError()
  }
  render() { return this.state.failed ? null : this.props.children }
}

/** 全身 GLB 归一化到 FIGURE_HEIGHT 高、脚落在 plinthTopY。 */
function BoothModel({ url, plinthTopY }: { url: string; plinthTopY: number }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    // Tripo 导出的人物默认正面朝 +X，统一绕 Y 轴转 -90° 让正面朝 +Z（屏幕 / 相机）。
    clone.rotation.y = -Math.PI / 2
    clone.updateMatrixWorld(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = FIGURE_HEIGHT / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, plinthTopY - bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => { child.castShadow = true })
    return clone
  }, [scene, plinthTopY])
  return <primitive object={normalized} />
}

type BoothProps = {
  entry: GalleryEntry
  index: number
  /** 与居中位的圆周角度距离（弧度）。 */
  angleDist: number
  active: boolean
  hovered: boolean
  near: boolean
  onHover: (index: number | null) => void
  onPick: (index: number, e: ThreeEvent<MouseEvent>) => void
}

/** 「创建我的人物」占位展台：青绿光环 + 悬浮 + 号门户，不渲染人形。 */
function CreatePortal({ active }: { active: boolean }) {
  const mat = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    const t = clock.getElapsedTime()
    mat.current.emissiveIntensity = MathUtils.lerp(
      mat.current.emissiveIntensity,
      active ? 2.4 + Math.sin(t * 3) * 0.6 : 1.1,
      0.12,
    )
  })
  return (
    <group position={[0, PLINTH_TOP + 1.05, 0]}>
      {/* 竖杠 */}
      <mesh castShadow>
        <boxGeometry args={[0.14, 0.62, 0.14]} />
        <meshStandardMaterial ref={mat} color="#4fb3a5" emissive="#4fb3a5" emissiveIntensity={1.1} />
      </mesh>
      {/* 横杠 */}
      <mesh castShadow position={[0, 0, 0]}>
        <boxGeometry args={[0.62, 0.14, 0.14]} />
        <meshStandardMaterial color="#4fb3a5" emissive="#4fb3a5" emissiveIntensity={1.1} />
      </mesh>
    </group>
  )
}

function Booth({ entry, index, angleDist, active, hovered, near, onHover, onPick }: BoothProps) {
  const ringMat = useRef<MeshStandardMaterial | null>(null)
  const modelGroup = useRef<Group>(null)
  const { booth, color } = entry
  const isCreate = Boolean(entry.isCreateEntry)
  const lit = active || hovered

  useFrame(({ clock }) => {
    if (!ringMat.current) return
    const t = clock.getElapsedTime()
    const target = active ? 2.0 + Math.sin(t * 4) * 0.4 : hovered ? 1.2 : 0.25
    ringMat.current.emissiveIntensity = MathUtils.lerp(ringMat.current.emissiveIntensity, target, 0.15)
  })

  // 按圆周角度距离缩放（C 位 1.15x 突出，两侧退远）+ 居中人物极轻呼吸浮动。
  useFrame(({ clock }, delta) => {
    if (!modelGroup.current) return
    const g = modelGroup.current
    g.position.y = PLINTH_TOP + (active ? Math.sin(clock.getElapsedTime() * 1.4) * 0.015 : 0)
    const wantScale = scaleForAngle(angleDist, active)
    g.scale.setScalar(MathUtils.damp(g.scale.x, wantScale, 6, delta))
  })

  const hasModel = Boolean(entry.character.model) && near && !isCreate

  return (
    <group position={[booth.x, 0, booth.z]}>
      {/* 光环底座（可点）——点亮=青绿 accent（当前选中），未点亮=中性灰 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, PLINTH_TOP + 0.005, 0]}
        onClick={(e) => onPick(index, e)}
        onPointerOver={(e) => { e.stopPropagation(); onHover(index) }}
        onPointerOut={() => onHover(null)}>
        <ringGeometry args={[0.62, 0.86, 48]} />
        <meshStandardMaterial
          ref={ringMat}
          color={lit ? '#4fb3a5' : '#1a1a1a'}
          emissive={lit ? '#4fb3a5' : '#141414'}
          emissiveIntensity={0.25}
          transparent opacity={lit ? 1 : 0.6}
          side={2}
        />
      </mesh>

      {/* 人物：近处加载真实 GLB，远处/无模型用占位人形；创建入口渲染 + 号门户。
          本地 rotationY=booth.rotationY 使角色面朝圆心；整圈 group 旋转后居中者正对相机。 */}
      <group ref={modelGroup} rotation={[0, booth.rotationY, 0]}>
        {isCreate ? (
          <CreatePortal active={active} />
        ) : hasModel ? (
          <Suspense fallback={<group position={[0, PLINTH_TOP, 0]} scale={FIGURE_SCALE}><NeutralMannequin active={active} /></group>}>
            <BoothModel url={entry.character.model!} plinthTopY={PLINTH_TOP} />
          </Suspense>
        ) : (
          <group position={[0, PLINTH_TOP, 0]} scale={FIGURE_SCALE}><NeutralMannequin active={active} /></group>
        )}
      </group>

      {/* 领域色点（底座前缘） */}
      <mesh position={[0, PLINTH_TOP + 0.02, 0.86]}>
        <sphereGeometry args={[0.045, 12, 12]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={lit ? 1.2 : 0.35} />
      </mesh>

      {/* 名牌（始终面向相机）：名字为主、Title 为副，极细描边仅用于与人物模型分离 */}
      <Billboard position={[0, PLINTH_TOP + 0.52, 1.12]}>
        <Text
          position={[0, 0.075, 0]}
          fontSize={0.185}
          color={lit ? '#EDEDF0' : 'rgba(237,237,240,.55)'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.004}
          outlineColor="#050505"
          raycast={() => null}
        >
          {entry.character.name}
        </Text>
        <Text
          position={[0, -0.085, 0]}
          fontSize={0.115}
          letterSpacing={0.04}
          color={lit ? 'rgba(237,237,240,.48)' : 'rgba(237,237,240,.30)'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.004}
          outlineColor="#050505"
          raycast={() => null}
        >
          {entry.character.title}
        </Text>
      </Billboard>
    </group>
  )
}

/** 星尘：围绕圆心缓缓发散的微弱冷白星点（真黑底 + UI 规范「暗色粒子底」手法）。 */
function StarDust() {
  const COUNT = 220
  const RESET_R2 = 13 * 13
  const pointsRef = useRef<Points>(null)
  const sim = useMemo(() => {
    const positions = new Float32Array(COUNT * 3)
    const dirs = new Float32Array(COUNT * 3)
    const speeds = new Float32Array(COUNT)
    const spawn = (i: number) => {
      // 星点在圆环中心附近生成，向外上方缓慢飘散。
      const a = Math.random() * Math.PI * 2
      const r = 0.5 + Math.random() * 2.6
      positions[i * 3] = Math.cos(a) * r
      positions[i * 3 + 1] = 0.2 + Math.random() * 3.0
      positions[i * 3 + 2] = Math.sin(a) * r * 0.6 - 1.4
      const dx = Math.cos(a)
      const dz = Math.sin(a)
      const up = 0.12 + Math.random() * 0.3
      const len = Math.hypot(dx, up, dz) || 1
      dirs[i * 3] = dx / len
      dirs[i * 3 + 1] = up / len
      dirs[i * 3 + 2] = dz / len
      speeds[i] = 0.1 + Math.random() * 0.25
    }
    for (let i = 0; i < COUNT; i++) spawn(i)
    return { positions, dirs, speeds, spawn }
  }, [])

  useFrame((_, delta) => {
    const pts = pointsRef.current
    if (!pts) return
    const { positions, dirs, speeds, spawn } = sim
    for (let i = 0; i < COUNT; i++) {
      const sp = speeds[i] * delta
      positions[i * 3] += dirs[i * 3] * sp
      positions[i * 3 + 1] += dirs[i * 3 + 1] * sp
      positions[i * 3 + 2] += dirs[i * 3 + 2] * sp
      const px = positions[i * 3]
      const pz = positions[i * 3 + 2]
      if (px * px + pz * pz > RESET_R2) spawn(i)
    }
    const attr = pts.geometry.getAttribute('position')
    if (attr) attr.needsUpdate = true
  })

  return (
    <points ref={pointsRef} frustumCulled={false}>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[sim.positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.03} color="#dfe3ec" transparent opacity={0.42} sizeAttenuation depthWrite={false} />
    </points>
  )
}

/** 所有展台底座：InstancedMesh，随圆环一起旋转（booth 坐标为 ring 局部坐标）。 */
function Plinths({ entries }: { entries: GalleryEntry[] }) {
  const ref = useRef<InstancedMesh>(null)
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh || entries.length === 0) return
    const m = new Matrix4()
    entries.forEach((e, i) => {
      m.makeTranslation(e.booth.x, PLINTH_TOP / 2, e.booth.z)
      mesh.setMatrixAt(i, m)
    })
    mesh.instanceMatrix.needsUpdate = true
  }, [entries])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, Math.max(entries.length, 0)]} frustumCulled>
      <cylinderGeometry args={[0.95, 1.08, PLINTH_TOP, 32]} />
      <meshStandardMaterial color="#101010" roughness={0.6} metalness={0.25} />
    </instancedMesh>
  )
}

type GallerySceneProps = {
  entries: GalleryEntry[]
  activeIndex: number
  ringRef: React.RefObject<Group>
  dragRef: React.MutableRefObject<DragState>
  onIndexChange: (i: number) => void
  onEnter: (entry: GalleryEntry) => void
  onRequestCreate: () => void
  onHover: (i: number | null) => void
  hovered: number | null
}

function GalleryScene({ entries, activeIndex, ringRef, dragRef, onIndexChange, onEnter, onRequestCreate, onHover, hovered }: GallerySceneProps) {
  const count = entries.length
  // useFrame 闭包可能捕获旧 props，用 ref 镜像保证吸附回调取到最新值。
  const activeRef = useRef(activeIndex)
  activeRef.current = activeIndex
  const onIndexRef = useRef(onIndexChange)
  onIndexRef.current = onIndexChange

  // 首次挂载/列表变化时，圆环直接跳到目标角，避免开场扫动。
  useLayoutEffect(() => {
    const ring = ringRef.current
    if (ring && count > 0) {
      ring.rotation.y = -(activeRef.current / count) * Math.PI * 2
    }
  }, [count, ringRef])

  useFrame(({ camera }, delta) => {
    const ring = ringRef.current
    if (!ring || count === 0) return
    camera.position.set(CAMERA_POS[0], CAMERA_POS[1], CAMERA_POS[2])
    camera.lookAt(CAMERA_LOOK[0], CAMERA_LOOK[1], CAMERA_LOOK[2])

    const d = dragRef.current
    if (d.down) return // 拖拽中：外层 onPointerMove 直接写 rotation.y

    const step = (Math.PI * 2) / count
    const now = performance.now()

    // 惯性阶段：松手后 200ms 内或速度未衰减到阈值前继续滑行。
    if (d.velocity !== 0 && now - d.releaseAt < 200) {
      ring.rotation.y += d.velocity * delta
      d.velocity *= Math.pow(0.92, delta * 60)
      if (Math.abs(d.velocity) < 0.25) d.velocity = 0
      return
    }
    d.velocity = 0

    // 吸附：当前旋转 → 最近索引（取模循环）。
    const snapIdx = ((Math.round(-ring.rotation.y / step) % count) + count) % count
    if (snapIdx !== activeRef.current) onIndexRef.current(snapIdx)

    // 阻尼到目标角（取最短路径），最终精确收敛到 -(activeIndex/count)*2π。
    const target = -(activeRef.current / count) * Math.PI * 2
    let t = target
    while (t - ring.rotation.y > Math.PI) t -= Math.PI * 2
    while (ring.rotation.y - t > Math.PI) t += Math.PI * 2
    ring.rotation.y = MathUtils.damp(ring.rotation.y, t, 7, delta)
  })

  const handlePick = (index: number, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const entry = entries[index]
    if (!entry) return
    if (entry.isCreateEntry) { onRequestCreate(); return }
    // 点两侧人物：旋转到该人物并设为选中；点居中人物：直接进详情。
    if (index !== activeIndex) onIndexChange(index)
    else onEnter(entry)
  }

  return (
    <>
      {/* 真黑舞台：背景纯黑 + 黑雾让圆环外缘隐入虚空；人物只靠中性白主光 + 冷色轮廓光塑形。 */}
      <color attach="background" args={['#000000']} />
      <fog attach="fog" args={['#000000', 9, 30]} />
      <ambientLight intensity={0.38} color="#ffffff" />
      <directionalLight position={[2.5, 6, 5]} intensity={1.0} color="#ffffff" />
      <directionalLight position={[-4, 3.5, -5]} intensity={0.5} color="#dfe8ff" />
      <Environment resolution={128}>
        <Lightformer intensity={0.5} color="#ffffff" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
        <Lightformer intensity={0.35} color="#dfe8ff" position={[-6, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.35} color="#dfe8ff" position={[6, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.3} color="#ffffff" position={[0, 2, 6]} scale={[10, 4, 1]} />
      </Environment>

      <StarDust />

      {/* 整圈展台（底座 + 人物）放在同一 group 内，绕 Y 旋转切换选中人物。 */}
      <group ref={ringRef}>
        <Plinths entries={entries} />
        <Suspense fallback={null}>
          {entries.map((entry, i) => {
            const cdist = circularDist(i, activeIndex, count)
            const angleDist = cdist * ((Math.PI * 2) / count)
            return (
              <Booth
                key={entry.character.id}
                entry={entry}
                index={i}
                angleDist={angleDist}
                active={i === activeIndex}
                hovered={hovered === i}
                near={cdist <= LOAD_NEARBY}
                onHover={onHover}
                onPick={handlePick}
              />
            )
          })}
        </Suspense>
      </group>

      {/* 大圆形平台（半径 12），取代原长方形地面。 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <circleGeometry args={[12, 64]} />
        <meshStandardMaterial color="#000000" roughness={1} metalness={0} />
      </mesh>
    </>
  )
}

export type CharacterGallery3DProps = {
  entries: GalleryEntry[]
  activeIndex: number
  onIndexChange: (i: number) => void
  onEnter: (entry: GalleryEntry) => void
  onModelError: () => void
  /** 点击「创建我的人物」占位入口时触发（跳分身工坊）。 */
  onCreate?: () => void
}

export default function CharacterGallery3D({ entries, activeIndex, onIndexChange, onEnter, onModelError, onCreate }: CharacterGallery3DProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const ringRef = useRef<Group>(null)
  const dragRef = useRef<DragState>(freshDrag())
  const wrapRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Group>(null)

  useEffect(() => {
    setHovered(null)
  }, [activeIndex, entries.length])

  useSceneCleanup(sceneRef, () => entries.map((e) => e.character.model).filter(Boolean) as string[])

  const count = entries.length

  /** 一转对应屏幕宽 → 每弧度像素数。 */
  const pxPerRadian = () => (wrapRef.current?.clientWidth ?? window.innerWidth) / (Math.PI * 2)

  // 循环切换：圆环无首尾，左右箭头均可循环。
  const step = (delta: number) => {
    if (count === 0) return
    const next = (((activeIndex + delta) % count) + count) % count
    onIndexChange(next)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') step(1)
      else if (e.key === 'ArrowLeft') step(-1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeIndex, count])

  const onPointerDown = (e: React.PointerEvent) => {
    dragRef.current = {
      ...freshDrag(),
      down: true,
      startX: e.clientX,
      startT: performance.now(),
      startRot: ringRef.current?.rotation.y ?? 0,
      lastX: e.clientX,
      lastT: performance.now(),
    }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d.down) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 6) d.moved = true
    // 右拖（dx>0）→ rotation.y 减小 → 切到下一位（与旧长廊手势一致）。
    if (ringRef.current) ringRef.current.rotation.y = d.startRot - dx / pxPerRadian()
    d.lastX = e.clientX
    d.lastT = performance.now()
  }
  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d.down) return
    d.down = false
    const now = performance.now()
    // 末段速度（px/s）→ rad/s，符号与实时旋转一致。
    const dt = Math.max((now - d.lastT) / 1000, 0.008)
    const vPx = (e.clientX - d.lastX) / dt
    d.velocity = -vPx / pxPerRadian()
    d.releaseAt = now
    // 未移动视为点击（交给 booth onClick）；移动过则在 useFrame 惯性后吸附。
    if (!d.moved) d.velocity = 0
  }

  const current = entries[activeIndex]
  const currentIsCreate = Boolean(current?.isCreateEntry)

  return (
    <div className="gallery3d-root" ref={wrapRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <GalleryErrorBoundary onError={onModelError}>
        <SafeCanvas
          camera={{ position: CAMERA_POS, fov: FOV, near: 0.1, far: 120 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: false }}
        >
          <group ref={sceneRef}>
            <GalleryScene
              entries={entries}
              activeIndex={activeIndex}
              ringRef={ringRef}
              dragRef={dragRef}
              onIndexChange={onIndexChange}
              onEnter={onEnter}
              onRequestCreate={() => onCreate?.()}
              onHover={setHovered}
              hovered={hovered}
            />
          </group>
        </SafeCanvas>
      </GalleryErrorBoundary>

      <button type="button" className="gallery3d__arrow gallery3d__arrow--left"
        onClick={() => step(-1)} aria-label="上一位">
        <ChevronLeft size={22} />
      </button>
      <button type="button" className="gallery3d__arrow gallery3d__arrow--right"
        onClick={() => step(1)} aria-label="下一位">
        <ChevronRight size={22} />
      </button>

      {current && (
        <div className="gallery3d__now">
          <span className="gallery3d__dot" style={{ background: current.color }} />
          <div className="gallery3d__now-text">
            <b>{current.character.name}</b>
            <span>{current.character.title}</span>
            <i>{currentIsCreate ? '点击进入分身工坊' : '在线 · 可对话'}</i>
          </div>
          {currentIsCreate ? (
            <button type="button" className="gallery3d__talk" onClick={() => onCreate?.()}>
              去创建 ↗
            </button>
          ) : (
            <button type="button" className="gallery3d__talk" onClick={() => onEnter(current)}>
              对话 ↗
            </button>
          )}
        </div>
      )}
      <div className="gallery3d__hint">拖拽旋转圆环 · ←/→ 切换 · 点两侧聚焦 · 点居中进入对话</div>
    </div>
  )
}

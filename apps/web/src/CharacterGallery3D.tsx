import { Component, Suspense, useEffect, useLayoutEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Environment, Lightformer, Text, useGLTF } from '@react-three/drei'
import { Box3, Group, InstancedMesh, MathUtils, Matrix4, MeshStandardMaterial, Vector3 } from 'three'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import NeutralMannequin from './NeutralMannequin'
import { useSceneCleanup } from './useSceneCleanup'
import {
  BOOTH_SPACING,
  clampGalleryIndex,
  type GalleryEntry,
} from './character-gallery'

/* ==========================================================================
 * 3D 人物长廊：全身模型站在弧形展台上，横向拖拽/箭头/键盘切换并吸附，
 * 悬停点亮，点击聚焦再进对话。布局/吸附/领域色/问候语在 character-gallery.ts。
 * ======================================================================== */

const CAMERA_BASE_Z = 6.2
const CAMERA_FOCUS_Z = 4.3
const CAMERA_Y = 1.55
const CAMERA_LOOK_Y = 1.15
const FOV = 50
/** 仅加载当前 ±N 个展台的真实 GLB，其余用占位人形，控制首屏模型数。
 *  第六轮：2→4，覆盖首屏两侧 + 远处占位提前加载调暗过渡。 */
const LOAD_NEARBY = 4
const PLINTH_TOP = 0.14
/** 人物整体放大倍数（参考 kims-room 物体占比），GLB 归一化身高 1.7→2.05。 */
const FIGURE_SCALE = 2.05 / 1.7

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

/** 全身 GLB 归一化到 2.05 高（第六轮 1.7→2.05，人物放大 1.2x）、脚落在 plinthTopY。 */
function BoothModel({ url, plinthTopY }: { url: string; plinthTopY: number }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = (1.7 * FIGURE_SCALE) / Math.max(size.y, 0.001)
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
  active: boolean
  hovered: boolean
  focused: boolean
  near: boolean
  onHover: (index: number | null) => void
  onPick: (index: number, e: ThreeEvent<MouseEvent>) => void
}

function Booth({ entry, index, active, hovered, focused, near, onHover, onPick }: BoothProps) {
  const ringMat = useRef<MeshStandardMaterial | null>(null)
  const modelGroup = useRef<Group>(null)
  const { booth, color } = entry
  const lit = active || focused || hovered

  useFrame(({ clock }) => {
    if (!ringMat.current) return
    const t = clock.getElapsedTime()
    const target = focused ? 2.6 + Math.sin(t * 4) * 0.8 : active ? 1.8 : hovered ? 1.0 : 0.25
    ringMat.current.emissiveIntensity = MathUtils.lerp(ringMat.current.emissiveIntensity, target, 0.15)
  })

  // 角色轻微转向镜头 + 极轻呼吸浮动。
  useFrame(({ clock }) => {
    if (!modelGroup.current) return
    const g = modelGroup.current
    const wantRot = booth.rotationY + (active ? Math.sin(clock.getElapsedTime() * 0.6) * 0.06 : 0)
    g.rotation.y = MathUtils.lerp(g.rotation.y, wantRot, 0.08)
    g.position.y = PLINTH_TOP + (active ? Math.sin(clock.getElapsedTime() * 1.4) * 0.015 : 0)
  })

  const hasModel = Boolean(entry.character.model) && near

  return (
    <group position={[booth.x, 0, booth.z]}>
      {/* 光环底座（可点） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, PLINTH_TOP + 0.005, 0]}
        onClick={(e) => onPick(index, e)}
        onPointerOver={(e) => { e.stopPropagation(); onHover(index) }}
        onPointerOut={() => onHover(null)}>
        <ringGeometry args={[0.62, 0.86, 48]} />
        <meshStandardMaterial
          ref={ringMat}
          color={lit ? '#FFD60A' : '#3a3320'}
          emissive={lit ? '#FFD60A' : '#2a2410'}
          emissiveIntensity={0.25}
          transparent opacity={lit ? 1 : 0.6}
          side={2}
        />
      </mesh>

      {/* 人物：近处加载真实 GLB，远处/无模型用占位人形（占位人形同步放大到 FIGURE_SCALE） */}
      <group ref={modelGroup} rotation={[0, booth.rotationY, 0]}>
        {hasModel ? (
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

      {/* 名牌（始终面向相机；第六轮字号 0.16→0.23，随人物放大上移） */}
      <Billboard position={[0, PLINTH_TOP + 0.52, 1.12]}>
        <Text
          fontSize={0.23}
          color={lit ? '#ffffff' : '#cfcfcf'}
          anchorX="center"
          anchorY="middle"
          outlineWidth={0.014}
          outlineColor="#000000"
          raycast={() => null}
        >
          {`${entry.character.name}\n${entry.character.title}`}
        </Text>
      </Billboard>
    </group>
  )
}

/** 星空微尘：简单 Points，无外部 HDR/CDN。 */
function StarDust() {
  const positions = useMemo(() => {
    const n = 260
    const arr = new Float32Array(n * 3)
    for (let i = 0; i < n; i++) {
      arr[i * 3] = (Math.random() - 0.5) * 60
      arr[i * 3 + 1] = Math.random() * 8 + 0.5
      arr[i * 3 + 2] = -Math.random() * 30 + 2
    }
    return arr
  }, [])
  return (
    <points frustumCulled>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.035} color="#ffe9a8" transparent opacity={0.55} sizeAttenuation depthWrite={false} />
    </points>
  )
}

/** 所有展台底座：InstancedMesh，视锥外剔除。 */
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
      <meshStandardMaterial color="#161513" roughness={0.6} metalness={0.25} />
    </instancedMesh>
  )
}

type GallerySceneProps = {
  entries: GalleryEntry[]
  activeIndex: number
  focused: boolean
  liveIndexRef: React.MutableRefObject<number>
  onIndexChange: (i: number) => void
  onFocusToggle: () => void
  onEnter: (entry: GalleryEntry) => void
  onHover: (i: number | null) => void
  hovered: number | null
}

function GalleryScene({ entries, activeIndex, focused, liveIndexRef, onIndexChange, onFocusToggle, onEnter, onHover, hovered }: GallerySceneProps) {
  const { camera } = useThree()
  const center = (entries.length - 1) / 2
  const boothXAt = (floatIndex: number) => (floatIndex - center) * BOOTH_SPACING

  useFrame((_, delta) => {
    const targetX = boothXAt(liveIndexRef.current)
    const targetZ = focused ? CAMERA_FOCUS_Z : CAMERA_BASE_Z
    const k = Math.min(delta * 3.2, 1)
    camera.position.x = MathUtils.lerp(camera.position.x, targetX, k)
    camera.position.z = MathUtils.lerp(camera.position.z, targetZ, k)
    camera.position.y = MathUtils.lerp(camera.position.y, CAMERA_Y, k)
    camera.lookAt(camera.position.x, CAMERA_LOOK_Y, 0)
  })

  const handlePick = (index: number, e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    if (index !== activeIndex) {
      liveIndexRef.current = index
      onIndexChange(index)
    } else if (!focused) {
      onFocusToggle()
    } else {
      onEnter(entries[index])
    }
  }

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={0.55} color="#fff2d0" />
      <directionalLight position={[4, 8, 6]} intensity={0.9} color="#ffffff" />
      <Environment resolution={128}>
        <Lightformer intensity={1.1} color="#ffdcb0" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
        <Lightformer intensity={0.5} color="#dfe8ff" position={[-6, 2, 2]} rotation={[0, Math.PI / 2, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.5} color="#dfe8ff" position={[6, 2, 2]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.9} color="#ffe8c8" position={[0, 2, 6]} scale={[10, 4, 1]} />
      </Environment>

      <StarDust />
      <Plinths entries={entries} />

      <Suspense fallback={null}>
        {entries.map((entry, i) => (
          <Booth
            key={entry.character.id}
            entry={entry}
            index={i}
            active={i === activeIndex}
            focused={focused && i === activeIndex}
            hovered={hovered === i}
            near={Math.abs(i - activeIndex) <= LOAD_NEARBY}
            onHover={onHover}
            onPick={handlePick}
          />
        ))}
      </Suspense>

      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]}>
        <planeGeometry args={[80, 40]} />
        <meshStandardMaterial color="#0d0d0d" roughness={1} metalness={0} />
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
}

export default function CharacterGallery3D({ entries, activeIndex, onIndexChange, onEnter, onModelError }: CharacterGallery3DProps) {
  const [hovered, setHovered] = useState<number | null>(null)
  const [focused, setFocused] = useState(false)
  const liveIndexRef = useRef(activeIndex)
  const dragRef = useRef({ down: false, startX: 0, startIndex: activeIndex, moved: false })
  const wrapRef = useRef<HTMLDivElement>(null)
  const sceneRef = useRef<Group>(null)

  useEffect(() => {
    liveIndexRef.current = activeIndex
    setFocused(false)
  }, [activeIndex, entries.length])

  useSceneCleanup(sceneRef, () => entries.map((e) => e.character.model).filter(Boolean) as string[])

  const count = entries.length

  const step = (delta: number) => {
    const next = clampGalleryIndex(activeIndex + delta, count)
    liveIndexRef.current = next
    setFocused(false)
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
    dragRef.current = { down: true, startX: e.clientX, startIndex: activeIndex, moved: false }
  }
  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current
    if (!d.down) return
    const dx = e.clientX - d.startX
    if (Math.abs(dx) > 6) d.moved = true
    const width = wrapRef.current?.clientWidth ?? window.innerWidth
    const height = wrapRef.current?.clientHeight || 1
    const visibleWidth = 2 * CAMERA_BASE_Z * Math.tan((FOV / 2) * Math.PI / 180) * (width / height)
    const pxPerBooth = (width / Math.max(visibleWidth, 1)) * BOOTH_SPACING
    const booths = -dx / Math.max(pxPerBooth, 1)
    liveIndexRef.current = MathUtils.clamp(d.startIndex - booths, 0, count - 1)
  }
  const onPointerUp = () => {
    const d = dragRef.current
    if (!d.down) return
    dragRef.current.down = false
    if (d.moved) {
      const snapped = clampGalleryIndex(liveIndexRef.current, count)
      liveIndexRef.current = snapped
      setFocused(false)
      onIndexChange(snapped)
    }
  }

  const current = entries[activeIndex]

  return (
    <div className="gallery3d-root" ref={wrapRef}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerLeave={onPointerUp}>
      <GalleryErrorBoundary onError={onModelError}>
        <Canvas
          camera={{ position: [0, CAMERA_Y, CAMERA_BASE_Z], fov: FOV, near: 0.1, far: 120 }}
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: false }}
        >
          <group ref={sceneRef}>
            <GalleryScene
              entries={entries}
              activeIndex={activeIndex}
              focused={focused}
              liveIndexRef={liveIndexRef}
              onIndexChange={onIndexChange}
              onFocusToggle={() => setFocused(true)}
              onEnter={onEnter}
              onHover={setHovered}
              hovered={hovered}
            />
          </group>
        </Canvas>
      </GalleryErrorBoundary>

      <button type="button" className="gallery3d__arrow gallery3d__arrow--left"
        onClick={() => step(-1)} disabled={activeIndex <= 0} aria-label="上一位">
        <ChevronLeft size={22} />
      </button>
      <button type="button" className="gallery3d__arrow gallery3d__arrow--right"
        onClick={() => step(1)} disabled={activeIndex >= count - 1} aria-label="下一位">
        <ChevronRight size={22} />
      </button>

      {current && (
        <div className="gallery3d__now">
          <span className="gallery3d__dot" style={{ background: current.color, boxShadow: `0 0 10px ${current.color}` }} />
          <div className="gallery3d__now-text">
            <b>{current.character.name}</b>
            <span>{current.character.title}</span>
            <i>在线 · 可对话</i>
          </div>
          <button type="button" className="gallery3d__talk" onClick={() => onEnter(current)}>
            {focused ? '开始对话 ↗' : '对话'}
          </button>
        </div>
      )}
      <div className="gallery3d__hint">拖拽滑动 · ←/→ 切换 · 点击聚焦 · 再点进入对话</div>
    </div>
  )
}

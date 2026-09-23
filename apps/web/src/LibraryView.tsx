import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'

// ===== 错误边界：单个名人模型加载失败不拖垮整个 Canvas =====
class LibraryModelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) { console.warn('Library model failed', error, info.componentStack) }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** 名人模型：按高度归一化到 ~1.6，脚落 y=0，不做 Y180 翻转。 */
function NormalizedModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = 1.6 / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => { child.castShadow = true; child.receiveShadow = true })
    return clone
  }, [scene])
  return <primitive object={normalized} />
}

// ===== 程序化书架：深色柜体 + 一排排柔和书脊 =====
const BOOK_COLORS = ['#6b5540', '#7a4b3a', '#3f5a6e', '#5a6b4a', '#6e5570', '#4a5568', '#8a7a55', '#5c4a5e', '#40503e', '#6a4a4a']

/** 确定性伪随机，保证每次渲染书脊位置/颜色稳定。 */
const seeded = (n: number): number => {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453
  return x - Math.floor(x)
}

function BookShelf({ position, rotationY = 0, width = 3.2 }: { position: [number, number, number]; rotationY?: number; width?: number }) {
  const rows = 5
  const cols = 11
  const books = useMemo(() => {
    const out: Array<{ x: number; y: number; h: number; w: number; color: string; row: number }> = []
    for (let r = 0; r < rows; r += 1) {
      const y = 0.45 + r * 0.62
      let cursor = -width / 2 + 0.12
      let c = 0
      while (cursor < width / 2 - 0.12) {
        const seed = r * 100 + c
        const w = 0.12 + seeded(seed) * 0.1
        const h = 0.42 + seeded(seed + 0.5) * 0.18
        const gap = 0.015
        out.push({ x: cursor + w / 2, y: y + h / 2, h, w, color: BOOK_COLORS[Math.floor(seeded(seed + 1.7) * BOOK_COLORS.length)], row: r })
        cursor += w + gap
        c += 1
      }
    }
    return out
  }, [width])

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      {/* 柜体背板 + 顶底板 + 侧板 */}
      <mesh position={[0, 1.65, -0.22]}>
        <boxGeometry args={[width, 3.3, 0.08]} />
        <meshStandardMaterial color="#241a12" roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.32, 0]}>
        <boxGeometry args={[width + 0.1, 0.1, 0.55]} />
        <meshStandardMaterial color="#2c2016" roughness={0.85} />
      </mesh>
      <mesh position={[0, 0.05, 0]}>
        <boxGeometry args={[width + 0.1, 0.1, 0.55]} />
        <meshStandardMaterial color="#2c2016" roughness={0.85} />
      </mesh>
      <mesh position={[-width / 2 - 0.02, 1.66, 0]}>
        <boxGeometry args={[0.1, 3.3, 0.55]} />
        <meshStandardMaterial color="#2c2016" roughness={0.85} />
      </mesh>
      <mesh position={[width / 2 + 0.02, 1.66, 0]}>
        <boxGeometry args={[0.1, 3.3, 0.55]} />
        <meshStandardMaterial color="#2c2016" roughness={0.85} />
      </mesh>
      {/* 层板 */}
      {Array.from({ length: rows - 1 }).map((_, i) => (
        <mesh key={i} position={[0, 0.45 + (i + 1) * 0.62 - 0.04, 0]}>
          <boxGeometry args={[width, 0.06, 0.5]} />
          <meshStandardMaterial color="#33251a" roughness={0.85} />
        </mesh>
      ))}
      {/* 书脊 */}
      {books.map((b, i) => (
        <mesh key={i} position={[b.x, b.y, 0.06]} castShadow>
          <boxGeometry args={[b.w, b.h, 0.32]} />
          <meshStandardMaterial color={b.color} roughness={0.7} />
        </mesh>
      ))}
    </group>
  )
}

// ===== 阅览桌 + 台灯 + 椅子 =====
function ReadingTable({ position, length = 2.8 }: { position: [number, number, number]; length?: number }) {
  return (
    <group position={position}>
      {/* 桌面 */}
      <mesh castShadow receiveShadow position={[0, 0.76, 0]}>
        <boxGeometry args={[length, 0.1, 1.2]} />
        <meshStandardMaterial color="#3a2c1e" roughness={0.75} />
      </mesh>
      {/* 桌腿 */}
      {[[-length / 2 + 0.15, -0.5], [length / 2 - 0.15, -0.5], [-length / 2 + 0.15, 0.5], [length / 2 - 0.15, 0.5]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.37, z]}>
          <boxGeometry args={[0.08, 0.74, 0.08]} />
          <meshStandardMaterial color="#2a1f14" roughness={0.8} />
        </mesh>
      ))}
      {/* 桌面摊开的书 */}
      <mesh position={[-0.4, 0.83, -0.1]} rotation={[0, 0.3, 0]}>
        <boxGeometry args={[0.5, 0.03, 0.36]} />
        <meshStandardMaterial color="#e8e0d0" roughness={0.6} />
      </mesh>
    </group>
  )
}

function DeskLamp({ position }: { position: [number, number, number] }) {
  const shade = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (shade.current) shade.current.emissiveIntensity = 1.6 + Math.sin(clock.getElapsedTime() * 1.5) * 0.15
  })
  return (
    <group position={position}>
      <mesh position={[0, 0.05, 0]}>
        <cylinderGeometry args={[0.1, 0.14, 0.08, 16]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.32, 0]}>
        <cylinderGeometry args={[0.03, 0.03, 0.5, 8]} />
        <meshStandardMaterial color="#1c1c1c" roughness={0.5} metalness={0.4} />
      </mesh>
      <mesh position={[0, 0.58, 0]}>
        <coneGeometry args={[0.18, 0.18, 16, 1, true]} />
        <meshStandardMaterial ref={shade} color="#fff4e0" emissive="#ffe9b8" emissiveIntensity={1.6} side={DoubleSide} />
      </mesh>
      <pointLight position={[0, 0.5, 0]} intensity={9} distance={4.5} decay={2} color="#fff4e0" />
    </group>
  )
}

function Chair({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.28, 0]}>
        <boxGeometry args={[0.42, 0.08, 0.42]} />
        <meshStandardMaterial color="#3a2c1e" roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 0.62, 0.19]}>
        <boxGeometry args={[0.42, 0.62, 0.06]} />
        <meshStandardMaterial color="#33261a" roughness={0.8} />
      </mesh>
    </group>
  )
}

/** 发言名人脚下的暖光环。 */
function SeatRing({ active }: { active: boolean }) {
  const mat = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    mat.current.emissiveIntensity = active ? 1.8 + Math.sin(clock.getElapsedTime() * 4) * 0.9 : 0.3
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]}>
      <ringGeometry args={[0.42, 0.58, 40]} />
      <meshStandardMaterial
        ref={mat}
        color={active ? '#f2d39a' : '#4a3f2a'}
        emissive={active ? '#ffce7a' : '#2a2114'}
        emissiveIntensity={active ? 1.8 : 0.3}
        transparent opacity={active ? 1 : 0.5}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** 当前发言名人头顶的暖光聚光。 */
function SpeakerSpotlight() {
  const light = useMemo(() => new SpotLight('#ffce86', 42, 10, Math.PI / 5, 0.6, 1.6), [])
  const target = useMemo(() => new Object3D(), [])
  useLayoutEffect(() => { light.target = target }, [light, target])
  return (<>
    <primitive object={light} position={[0, 3.6, 0.6]} />
    <primitive object={target} position={[0, 1, 0]} />
  </>)
}

function MemberPlaceholder({ name, active }: { name: string; active: boolean }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.8, 0]}>
        <cylinderGeometry args={[0.2, 0.28, 1.25, 16]} />
        <meshStandardMaterial color={active ? '#7a6238' : '#4a4556'} />
      </mesh>
      <mesh castShadow position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshStandardMaterial color={active ? '#e8cfa0' : '#8a849a'} />
      </mesh>
      <Text position={[0, 1.9, 0.06]} fontSize={0.22} color="#fff4e0" anchorX="center" anchorY="middle"
        outlineWidth={0.012} outlineColor="#1a1408">{name}</Text>
    </group>
  )
}

const SEAT_LAYOUT: Array<[number, number, number]> = [
  [-1.5, 0, 1.35],
  [0, 0, 1.55],
  [1.5, 0, 1.35],
]

function Seat({ celebrity, position, active }: { celebrity: Celebrity; position: [number, number, number]; active: boolean }) {
  const fallback = <MemberPlaceholder name={celebrity.name} active={active} />
  return (
    <group position={position}>
      <SeatRing active={active} />
      {active && <SpeakerSpotlight />}
      {celebrity.model ? (
        <LibraryModelErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <NormalizedModel url={celebrity.model} />
          </Suspense>
        </LibraryModelErrorBoundary>
      ) : fallback}
      <Text position={[0, active ? 1.95 : 1.72, 0.06]} fontSize={active ? 0.22 : 0.16} color={active ? '#ffe6a8' : '#e8e2d0'}
        anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#0c0a06">
        {active ? `${celebrity.name} · 正在讲述` : celebrity.name}
      </Text>
    </group>
  )
}

function LibraryScene({ celebrities, activeSpeakerId }: { celebrities: Celebrity[]; activeSpeakerId: string | null }) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () =>
    celebrities.map((c) => c.model).filter((m): m is string => Boolean(m)),
  )
  const shown = celebrities.slice(0, 3)
  return (
    <group ref={sceneRef}>
      <color attach="background" args={['#0a0a14']} />
      {/* 安静氛围：低强度冷环境光 */}
      <ambientLight intensity={0.22} color="#8a93b8" />
      <Environment resolution={128}>
        <Lightformer intensity={0.8} color="#cdd6ff" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[12, 12, 1]} />
        <Lightformer intensity={0.5} color="#fff4e0" position={[0, 1.5, 5]} scale={[10, 3, 1]} />
        <Lightformer intensity={0.35} color="#9aa8d8" position={[-6, 2, -2]} rotation={[0, Math.PI / 2, 0]} scale={[6, 3, 1]} />
        <Lightformer intensity={0.35} color="#9aa8d8" position={[6, 2, -2]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 3, 1]} />
      </Environment>

      {/* 地板：深色木地板 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[16, 14]} />
        <meshStandardMaterial color="#141020" roughness={0.9} />
      </mesh>

      {/* 三面墙书架 */}
      <BookShelf position={[-3.2, 0, -5.2]} width={3.0} />
      <BookShelf position={[0, 0, -5.2]} width={3.0} />
      <BookShelf position={[3.2, 0, -5.2]} width={3.0} />
      <BookShelf position={[-6.0, 0, -1.0]} rotationY={Math.PI / 2} width={4.2} />
      <BookShelf position={[6.0, 0, -1.0]} rotationY={-Math.PI / 2} width={4.2} />

      {/* 阅览桌与椅子 */}
      <ReadingTable position={[0, 0, -0.4]} length={3.0} />
      <ReadingTable position={[-3.2, 0, 1.8]} length={1.8} />
      <ReadingTable position={[3.2, 0, 1.8]} length={1.8} />
      <Chair position={[-1.6, 0, 0.5]} />
      <Chair position={[1.6, 0, 0.5]} />
      <Chair position={[0, 0, 0.5]} />

      {/* 暖白台灯 */}
      <DeskLamp position={[-0.9, 0.81, -0.4]} />
      <DeskLamp position={[0.9, 0.81, -0.4]} />
      <DeskLamp position={[-3.2, 0.81, 1.8]} />
      <DeskLamp position={[3.2, 0.81, 1.8]} />

      {/* 安静提示 */}
      <Text position={[0, 3.5, -5.1]} fontSize={0.28} color="#5a5f7a" anchorX="center" anchorY="middle" letterSpacing={0.3}>
        QUIET
      </Text>

      {/* 名人（最多 3 位）坐在主桌旁 */}
      {shown.map((c, i) => (
        <Seat key={c.id} celebrity={c} position={SEAT_LAYOUT[i] ?? SEAT_LAYOUT[0]} active={c.id === activeSpeakerId} />
      ))}

      <OrbitControls
        enablePan={false}
        target={[0, 1.1, -0.4]}
        minDistance={3.5}
        maxDistance={9}
        maxPolarAngle={Math.PI / 2.05}
        minPolarAngle={Math.PI / 6}
      />
    </group>
  )
}

export default function LibraryView({
  celebrities,
  activeSpeakerId,
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
}) {
  return (
    <SafeCanvas shadows camera={{ position: [0, 3.4, 5.8], fov: 45 }} dpr={[1, 2]}>
      <LibraryScene celebrities={celebrities} activeSpeakerId={activeSpeakerId} />
    </SafeCanvas>
  )
}

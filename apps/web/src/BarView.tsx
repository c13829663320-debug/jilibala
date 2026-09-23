// M8: 程序化 3D 酒吧室内（无外部 GLB 场景，全部用 three 基础几何体搭建）。
import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'

/** GLB 加载失败时不让整个 Canvas 崩掉。 */
class BarModelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Bar celebrity model failed to load', error, info.componentStack)
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** 名人模型：按高度归一化到 ~1.5（酒吧坐姿可稍矮），脚置 y=0，不做 Y180。 */
function NormalizedBarModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = 1.5 / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
    return clone
  }, [scene])
  return <primitive object={normalized} />
}

/** 座位下方的发光圆环，发言时脉动。 */
function SeatRing({ active }: { active: boolean }) {
  const mat = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    mat.current.emissiveIntensity = active ? 2.2 + Math.sin(clock.getElapsedTime() * 4) * 1.1 : 0.35
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[0.42, 0.56, 40]} />
      <meshStandardMaterial
        ref={mat}
        color={active ? '#ffb066' : '#4a3418'}
        emissive={active ? '#ff9a30' : '#3a2610'}
        emissiveIntensity={active ? 2.2 : 0.35}
        transparent
        opacity={active ? 1 : 0.5}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** 发言者头顶的暖光聚光。 */
function SpeakerSpotlight() {
  const light = useMemo(() => {
    return new SpotLight('#ffce86', 50, 11, Math.PI / 5.5, 0.55, 1.6)
  }, [])
  const target = useMemo(() => new Object3D(), [])
  useLayoutEffect(() => { light.target = target }, [light, target])
  return (
    <>
      <primitive object={light} position={[0, 4.2, 0]} />
      <primitive object={target} position={[0, 0.9, 0]} />
    </>
  )
}

/** 模型缺失/失败时的占位几何体。 */
function MemberPlaceholder({ name, active }: { name: string; active: boolean }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.2, 0.28, 1.15, 16]} />
        <meshStandardMaterial color={active ? '#c98a4a' : '#5b4a8a'} />
      </mesh>
      <mesh castShadow position={[0, 1.5, 0]}>
        <sphereGeometry args={[0.17, 16, 16]} />
        <meshStandardMaterial color={active ? '#e8c08a' : '#8a7cc0'} />
      </mesh>
      <Text
        position={[0, 1.85, 0.06]}
        fontSize={active ? 0.24 : 0.17}
        color="#fff0d8"
        anchorX="center"
        anchorY="middle"
        outlineWidth={active ? 0.025 : 0.01}
        outlineColor="#7a4a10"
      >
        {name}
      </Text>
    </group>
  )
}

interface SeatSlot {
  celebrity: Celebrity
  position: [number, number, number]
  active: boolean
}

function BarSeat({ celebrity, position, active }: SeatSlot) {
  const fallback = <MemberPlaceholder name={celebrity.name} active={active} />
  return (
    <group position={position}>
      <SeatRing active={active} />
      {active && <SpeakerSpotlight />}
      {celebrity.model ? (
        <BarModelErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <NormalizedBarModel url={celebrity.model} />
          </Suspense>
        </BarModelErrorBoundary>
      ) : (
        fallback
      )}
      <Text
        position={[0, active ? 1.95 : 1.72, 0.06]}
        fontSize={active ? 0.24 : 0.17}
        color={active ? '#ffe6a8' : '#f4ecff'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={active ? 0.028 : 0.012}
        outlineColor={active ? '#a45a00' : '#160f24'}
      >
        {active ? `${celebrity.name} · 发言中` : celebrity.name}
      </Text>
    </group>
  )
}

/** 斜侧看向圆桌，发言时平滑推镜头。 */
function CameraRig({ activeSeat, children }: { activeSeat: [number, number, number] | null; children: ReactNode }) {
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)
  const camera = useThree((s) => s.camera)
  const desiredTarget = useMemo(() => new Vector3(0, 0.9, -0.4), [])
  const desiredCamera = useMemo(() => new Vector3(), [])
  const offset = useMemo(() => new Vector3(), [])
  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    if (activeSeat) desiredTarget.set(activeSeat[0], 1.0, activeSeat[2])
    else desiredTarget.set(0, 0.9, -0.4)
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.1))
    c.target.lerp(desiredTarget, k)
    offset.subVectors(camera.position, c.target)
    desiredCamera.copy(desiredTarget).add(offset)
    camera.position.lerp(desiredCamera, k)
    c.update()
  })
  return (
    <>
      {children}
      <OrbitControls
        ref={controls as never}
        enablePan={false}
        target={[0, 0.9, -0.4]}
        minDistance={2.4}
        maxDistance={7}
        maxPolarAngle={Math.PI / 2.05}
      />
    </>
  )
}

/** 吧台（长条形深色木台）。 */
function BarCounter() {
  return (
    <group>
      {/* 台身 */}
      <mesh castShadow receiveShadow position={[0, 0.5, -2.8]}>
        <boxGeometry args={[6.4, 1.0, 0.7]} />
        <meshStandardMaterial color="#2a1a10" roughness={0.85} metalness={0.1} />
      </mesh>
      {/* 台面（稍亮的木纹感） */}
      <mesh castShadow receiveShadow position={[0, 1.04, -2.8]}>
        <boxGeometry args={[6.6, 0.08, 0.85]} />
        <meshStandardMaterial color="#5a3a22" roughness={0.6} metalness={0.15} />
      </mesh>
    </group>
  )
}

/** 吧台上的酒瓶：细高圆柱 + 彩色小瓶盖。 */
const BOTTLES: Array<{ x: number; h: number; color: string }> = [
  { x: -2.6, h: 0.62, color: '#3a7d44' },
  { x: -2.25, h: 0.5, color: '#7d3a3a' },
  { x: -1.9, h: 0.7, color: '#c9a227' },
  { x: -1.5, h: 0.55, color: '#2e5e8a' },
  { x: -1.1, h: 0.66, color: '#5a2a6a' },
  { x: -0.7, h: 0.48, color: '#3a7d44' },
  { x: -0.3, h: 0.6, color: '#8a4a2a' },
  { x: 0.1, h: 0.68, color: '#2e5e8a' },
  { x: 0.5, h: 0.52, color: '#c9a227' },
  { x: 0.9, h: 0.64, color: '#7d3a3a' },
  { x: 1.3, h: 0.5, color: '#3a7d44' },
  { x: 1.7, h: 0.66, color: '#5a2a6a' },
  { x: 2.1, h: 0.55, color: '#8a4a2a' },
  { x: 2.5, h: 0.62, color: '#2e5e8a' },
]
function Bottles() {
  return (
    <group>
      {BOTTLES.map((b, i) => (
        <group key={i} position={[b.x, 1.08, -2.85]}>
          {/* 瓶身 */}
          <mesh castShadow position={[0, b.h / 2, 0]}>
            <cylinderGeometry args={[0.055, 0.07, b.h, 14]} />
            <meshStandardMaterial color={b.color} roughness={0.25} metalness={0.2} transparent opacity={0.92} />
          </mesh>
          {/* 瓶颈 */}
          <mesh castShadow position={[0, b.h + 0.09, 0]}>
            <cylinderGeometry args={[0.022, 0.03, 0.18, 10]} />
            <meshStandardMaterial color="#1a1a1a" roughness={0.3} />
          </mesh>
          {/* 瓶盖 */}
          <mesh castShadow position={[0, b.h + 0.19, 0]}>
            <cylinderGeometry args={[0.024, 0.024, 0.04, 10]} />
            <meshStandardMaterial color="#d4af37" roughness={0.3} metalness={0.8} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

/** 酒杯（圆锥 + 小圆柱杯脚）。 */
function Glass({ position, color }: { position: [number, number, number]; color: string }) {
  return (
    <group position={position}>
      {/* 杯身 */}
      <mesh castShadow position={[0, 0.09, 0]}>
        <cylinderGeometry args={[0.05, 0.035, 0.12, 16]} />
        <meshStandardMaterial color={color} roughness={0.05} metalness={0} transparent opacity={0.65} />
      </mesh>
      {/* 杯脚 */}
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.008, 0.008, 0.06, 8]} />
        <meshStandardMaterial color="#cfcfcf" roughness={0.2} transparent opacity={0.7} />
      </mesh>
    </group>
  )
}

/** 圆桌（矮圆柱桌面 + 细圆柱腿）。 */
function RoundTable() {
  return (
    <group>
      {/* 桌面 */}
      <mesh castShadow receiveShadow position={[0, 0.62, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.06, 32]} />
        <meshStandardMaterial color="#4a2e18" roughness={0.7} metalness={0.1} />
      </mesh>
      {/* 桌腿 */}
      <mesh castShadow receiveShadow position={[0, 0.31, 0]}>
        <cylinderGeometry args={[0.09, 0.12, 0.62, 16]} />
        <meshStandardMaterial color="#2a1a10" roughness={0.8} />
      </mesh>
      {/* 桌上的酒杯 */}
      <Glass position={[-0.3, 0.65, 0.15]} color="#ffb066" />
      <Glass position={[0.25, 0.65, -0.1]} color="#e8d8b0" />
      <Glass position={[0.05, 0.65, 0.35]} color="#ffb066" />
    </group>
  )
}

/** 圆凳。 */
function Stool({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      {/* 凳面 */}
      <mesh castShadow receiveShadow position={[0, 0.55, 0]}>
        <cylinderGeometry args={[0.22, 0.22, 0.08, 20]} />
        <meshStandardMaterial color="#3a2416" roughness={0.75} />
      </mesh>
      {/* 凳腿 */}
      <mesh castShadow receiveShadow position={[0, 0.27, 0]}>
        <cylinderGeometry args={[0.05, 0.06, 0.55, 10]} />
        <meshStandardMaterial color="#1a1a1a" roughness={0.6} metalness={0.4} />
      </mesh>
    </group>
  )
}

/** 酒保：吧台后方的简单几何体人形（留空也可，这里用几何体示意）。 */
function Bartender() {
  return (
    <group position={[0, 0, -3.35]}>
      {/* 身体（深色马甲） */}
      <mesh castShadow position={[0, 0.95, 0]}>
        <cylinderGeometry args={[0.22, 0.28, 0.9, 16]} />
        <meshStandardMaterial color="#2a2a35" roughness={0.8} />
      </mesh>
      {/* 头 */}
      <mesh castShadow position={[0, 1.6, 0]}>
        <sphereGeometry args={[0.16, 16, 16]} />
        <meshStandardMaterial color="#d4a574" roughness={0.7} />
      </mesh>
      <Text
        position={[0, 1.9, 0.1]}
        fontSize={0.16}
        color="#ffd9a8"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.012}
        outlineColor="#5a3000"
      >
        酒保
      </Text>
    </group>
  )
}

/** 正反方座位：正方左侧、反方右侧，不做 Y180。 */
const SEAT_LAYOUT: Array<[number, number, number]> = [
  [-1.5, 0, 0.3],
  [1.5, 0, 0.3],
  [-1.5, 0, -1.1],
  [1.5, 0, -1.1],
]

function Bar({ celebrities, activeSpeakerId }: { celebrities: Celebrity[]; activeSpeakerId: string | null }) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () =>
    celebrities.map((c) => c.model).filter((m): m is string => Boolean(m)),
  )
  const celebList = celebrities.slice(0, 4)
  const layout = SEAT_LAYOUT.slice(0, Math.max(1, celebList.length))
  const activeSeat: [number, number, number] | null = (() => {
    const idx = celebList.findIndex((c) => c.id === activeSpeakerId)
    return idx >= 0 ? layout[idx] : null
  })()

  const warmLights: Array<[number, number, number]> = [
    [-2.6, 2.8, -2.2],
    [2.6, 2.8, -2.2],
    [0, 3.4, 0.8],
    [0, 2.6, 2.6],
  ]

  return (
    <group ref={sceneRef}>
      <color attach="background" args={['#1a0f08']} />
      <ambientLight intensity={0.38} color="#ffd9a8" />
      <Environment resolution={128}>
        <Lightformer intensity={1.3} color="#ffb066" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.8} color="#ffae54" position={[-5, 2, -1]} rotation={[0, Math.PI / 2, 0]} scale={[7, 4, 1]} />
        <Lightformer intensity={0.8} color="#ffae54" position={[5, 2, -1]} rotation={[0, -Math.PI / 2, 0]} scale={[7, 4, 1]} />
        <Lightformer intensity={1.0} color="#ffd9a8" position={[0, 2, 5]} scale={[9, 4, 1]} />
        <Lightformer intensity={0.5} color="#ff9a40" position={[0, 2, -5]} scale={[9, 4, 1]} />
      </Environment>
      {warmLights.map((p, i) => (
        <pointLight key={`warm-${i}`} position={p} intensity={12} distance={8} decay={2} color="#ffb066" />
      ))}

      {/* 地面 */}
      <mesh receiveShadow rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, -0.5]}>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#160c06" roughness={0.95} />
      </mesh>

      <BarCounter />
      <Bottles />
      <RoundTable />
      <Stool position={[-2.1, 0, 0.3]} />
      <Stool position={[2.1, 0, 0.3]} />
      <Bartender />

      {celebList.map((c, i) => (
        <BarSeat key={c.id} celebrity={c} position={layout[i]} active={c.id === activeSpeakerId} />
      ))}

      <CameraRig activeSeat={activeSeat}>{null}</CameraRig>
    </group>
  )
}

/**
 * 完整 3D 酒吧（Canvas + 场景）。按需加载，用户进入酒吧时才下载 three/r3f。
 */
export default function BarView({
  celebrities,
  activeSpeakerId,
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
}) {
  return (
    <SafeCanvas shadows camera={{ position: [3.6, 1.9, 3.8], fov: 45 }} dpr={[1, 2]}>
      <Bar celebrities={celebrities} activeSpeakerId={activeSpeakerId} />
    </SafeCanvas>
  )
}

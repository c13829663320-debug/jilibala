import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'
import NeutralMannequin from './NeutralMannequin'
import type { CourtSeatKind } from './courtroom-seats'
import {
  TRIAL_CAMERA,
  WIZARD_CAMERA,
  clampCameraPosition,
  getCameraForMode,
  type ActiveSpeakerInfo,
  type CameraMode,
} from './courtroom-camera'

/**
 * Keep a bad/expired Tripo URL from taking down the whole R3F canvas. The
 * placeholder is rendered by the parent scene when the GLB is still loading
 * or fails to decode.
 */
class CourtroomModelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() { return { failed: true } }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Tripo courtroom model failed to load', error, info.componentStack)
  }

  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

function NormalizedCourtroomModel({ url, height = 1.7 }: { url: string; height?: number }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    // Normalize by HEIGHT (size.y) to the seat target height so models fit the
    // courtroom seat without being oversized. Feet sit on the local ground
    // (position.y = -bounds.min.y * scale), matching the seat origin.
    const scale = height / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
    return clone
  }, [scene, height])
  return <primitive object={normalized} />
}

function CourtroomEnvironmentModel() {
  const { scene } = useGLTF('/models/balabala_courtroom.glb', false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const maxSize = Math.max(size.x, size.y, size.z, 0.001)
    const scale = 10.8 / maxSize
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

/** Flat glowing ring on the seat. Pulses brighter while the member speaks. */
function SeatRing({ active }: { active: boolean }) {
  const mat = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    const t = clock.getElapsedTime()
    mat.current.emissiveIntensity = active ? 2.2 + Math.sin(t * 4) * 1.1 : 0.35
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.03, 0]}>
      <ringGeometry args={[0.5, 0.66, 48]} />
      <meshStandardMaterial
        ref={mat}
        color={active ? '#ffd06a' : '#5a4326'}
        emissive={active ? '#ffb340' : '#3a2a12'}
        emissiveIntensity={active ? 2.2 : 0.35}
        transparent
        opacity={active ? 1 : 0.55}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** Warm spotlight hanging above the currently speaking member. */
function SpeakerSpotlight() {
  const light = useMemo(() => {
    const l = new SpotLight('#ffce86', 60, 12, Math.PI / 5.5, 0.55, 1.6)
    return l
  }, [])
  const target = useMemo(() => new Object3D(), [])
  useLayoutEffect(() => {
    light.target = target
  }, [light, target])
  return (
    <>
      <primitive object={light} position={[0, 4.6, 0]} />
      <primitive object={target} position={[0, 0.9, 0]} />
    </>
  )
}

/** Simple geometry placeholder shown when a member's GLB is missing or fails. */
function MemberPlaceholder({ name, active, tint }: { name: string; active: boolean; tint?: 'judge' | 'plaintiff' | 'defendant' }) {
  const bodyColor = tint === 'judge' ? (active ? '#e8c25a' : '#6b5316')
    : tint === 'plaintiff' ? (active ? '#6aa0e8' : '#2d5fa8')
    : tint === 'defendant' ? (active ? '#e86a86' : '#a82d48')
    : (active ? '#e8b25a' : '#5b4a8a')
  const headColor = tint === 'judge' ? (active ? '#f5dd9a' : '#9a8036')
    : tint === 'plaintiff' ? (active ? '#bcdcfb' : '#5f8fd0')
    : tint === 'defendant' ? (active ? '#fbbcc8' : '#d05f7c')
    : (active ? '#f2d39a' : '#8a7cc0')
  return (
    <group>
      <mesh castShadow position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.22, 0.3, 1.3, 16]} />
        <meshStandardMaterial color={bodyColor} />
      </mesh>
      <mesh castShadow position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={headColor} />
      </mesh>
      <Text
        position={[0, 2.05, 0.06]}
        fontSize={active ? 0.26 : 0.18}
        color="#fff4e0"
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

/** M13: generic seat descriptor for the new fullscreen courtroom (judge/plaintiff/defendant/defender). */
export type CourtSeat = {
  id: string
  name: string
  role: 'judge' | 'plaintiff' | 'defendant' | 'defender'
  /** 第五轮：细分角色（固定 GLB 席位 / 旁听 / 陪审 / 证人）。 */
  kind?: CourtSeatKind
  model?: string
  /** 模型归一化目标身高（法官略高 1.8，其余 1.7）。 */
  modelHeight?: number
  position: [number, number, number]
  active: boolean
  side?: 'plaintiff' | 'defendant' | null
  /** 绕 Y 轴朝向（弧度）。0 = 面向 +z（法庭/观众），π = 面向 -z（法官）。 */
  facing?: number
  /** 氛围 NPC：不高亮、不挂名牌、不进发言轮次。 */
  npc?: boolean
}

interface SeatSlot {
  celebrity: Celebrity
  position: [number, number, number]
  active: boolean
}

function BenchSeat({ celebrity, position, active }: SeatSlot) {
  const fallback = (
    <NeutralMannequin name={celebrity.name} active={active} variant="party" />
  )
  return (
    <group position={position}>
      <SeatRing active={active} />
      {active && <SpeakerSpotlight />}
      {celebrity.model ? (
        <CourtroomModelErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <NormalizedCourtroomModel url={celebrity.model} />
          </Suspense>
        </CourtroomModelErrorBoundary>
      ) : (
        fallback
      )}
      <Text
        position={[0, active ? 2.0 : 1.78, 0.06]}
        fontSize={active ? 0.26 : 0.18}
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

/** M13: a generic seat (judge / party / defender / fixed counsel / NPC) rendered from a CourtSeat descriptor. */
function GenericSeat({ seat }: { seat: CourtSeat }) {
  // 法官 / 原告 / 被告坐在各自桌后（坐姿人台，头高 local ≈1.3）；
  // 辩护人用真实名人 GLB 模型（站姿，头高 ≈1.7）。
  const seated = seat.role !== 'defender'
  const fallback = (
    <NeutralMannequin
      name={seat.name}
      active={seat.active}
      variant={seat.role === 'judge' ? 'judge' : 'party'}
      seated={seated}
    />
  )
  // 人物本体单独按 facing 旋转（面向法官/法庭），金色席环与名牌保持朝向相机不转。
  const body = (
    <group rotation={[0, seat.facing ?? 0, 0]}>
      {seat.model ? (
        <CourtroomModelErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <NormalizedCourtroomModel url={seat.model} height={seat.modelHeight ?? (seat.role === 'judge' ? 1.8 : 1.7)} />
          </Suspense>
        </CourtroomModelErrorBoundary>
      ) : (
        fallback
      )}
    </group>
  )

  // 氛围 NPC（旁听者 / 陪审团 / 证人）：只渲染人物，无席环 / 聚光 / 名牌 / 高亮。
  if (seat.npc) {
    return <group position={seat.position}>{body}</group>
  }

  return (
    <group position={seat.position}>
      <SeatRing active={seat.active} />
      {seat.active && <SpeakerSpotlight />}
      {body}
      {/* 名牌：坐姿头高 ≈1.3 → 名牌 local ≈1.55；站姿头高 ≈1.7 → 名牌 local ≈1.78。 */}
      <Text
        position={[0, seat.active ? (seated ? 1.78 : 2.0) : (seated ? 1.55 : 1.78), 0.06]}
        fontSize={seat.active ? 0.26 : 0.18}
        color={seat.active ? '#ffe6a8' : '#f4ecff'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={seat.active ? 0.028 : 0.012}
        outlineColor={seat.active ? '#a45a00' : '#160f24'}
      >
        {seat.active ? `${seat.name} · 发言中` : seat.name}
      </Text>
    </group>
  )
}

/**
 * M13 第六轮：主全景机位默认，相机就位后用户 OrbitControls 完全接管。
 *
 *  - trial/bench：进入时一次性平滑settle到主全景（mode 切换 1.2s），
 *    之后每帧只做 clampCameraPosition 防穿墙/穿地/穿顶；
 *    发言者切换绝不移动相机、不 nudge、不回位——只靠 SeatRing+聚光+名牌高亮。
 *  - 用户拖拽/缩放立即生效，绝不被下一帧覆盖。
 *  - wizard: 维持全景 autoRotate，保留用户 orbit/zoom 绕 target 的 offset。
 *  - 每帧仍 clampCameraPosition，相机永不离开房间。
 */
function CameraRig({
  mode,
  children,
}: {
  mode: CameraMode
  activeSpeaker: ActiveSpeakerInfo | null
  children: ReactNode
}) {
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)
  const camera = useThree((s) => s.camera)
  const cfg = getCameraForMode(mode)
  const desiredTarget = useMemo(() => new Vector3(...cfg.target), [cfg])
  const desiredCamera = useMemo(() => new Vector3(...cfg.position), [cfg])
  const offset = useMemo(() => new Vector3(), [])
  const modeRef = useRef<CameraMode>(mode)
  const transitionUntil = useRef(-1)
  // r3f clock 时间轴：onStart/onEnd 里没有 clock，用 useFrame 里刷过的 clockNow 取同一时间。
  const clockNow = useRef(0)
  // 用户正在拖拽/缩放手势中（onStart → onEnd 之间）。第六轮：仅用于记录，不再据此回位。
  const userInteracting = useRef(false)

  useFrame(({ clock }, delta) => {
    const c = controls.current
    if (!c) return
    const now = clock.getElapsedTime()
    clockNow.current = now
    if (modeRef.current !== mode) {
      modeRef.current = mode
      transitionUntil.current = now + 1.2
    }
    const transitioning = now < transitionUntil.current
    // frame-rate independent lerp
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.1))

    if (mode === 'wizard') {
      desiredTarget.set(WIZARD_CAMERA.target[0], WIZARD_CAMERA.target[1], WIZARD_CAMERA.target[2])
      c.target.lerp(desiredTarget, k)
      // wizard 保留用户 orbit/zoom 绕 target 的 offset（autoRotate 自己转）
      offset.subVectors(camera.position, c.target)
      desiredCamera.copy(desiredTarget).add(offset)
      camera.position.lerp(desiredCamera, k)
    } else if (transitioning) {
      // trial/bench：仅在 mode 切换后的 1.2s 内一次性 settle 到主全景；
      // 之后绝不主动移动相机——用户 OrbitControls 完全接管，发言者不跟随。
      desiredTarget.set(TRIAL_CAMERA.target[0], TRIAL_CAMERA.target[1], TRIAL_CAMERA.target[2])
      desiredCamera.set(TRIAL_CAMERA.position[0], TRIAL_CAMERA.position[1], TRIAL_CAMERA.position[2])
      c.target.lerp(desiredTarget, k)
      camera.position.lerp(desiredCamera, k)
    }
    // hard clamp so the camera can never leave the room (wall / floor / ceiling)
    const [cx, cy, cz] = clampCameraPosition([camera.position.x, camera.position.y, camera.position.z])
    camera.position.set(cx, cy, cz)
    c.update()
  })

  return (
    <>
      {children}
      <OrbitControls
        ref={controls as never}
        enablePan={false}
        enableDamping={mode === 'wizard'}
        autoRotate={mode === 'wizard'}
        autoRotateSpeed={cfg.autoRotateSpeed}
        target={cfg.target}
        minDistance={cfg.minDistance}
        maxDistance={cfg.maxDistance}
        maxPolarAngle={cfg.maxPolarAngle}
        onStart={() => {
          // 用户开始拖拽/缩放：记录手势开始（第六轮：松手后不自动回位）
          userInteracting.current = true
        }}
        onEnd={() => {
          // 用户松手：仅记录手势结束，相机保持用户视角、不自动回位
          userInteracting.current = false
        }}
      />
    </>
  )
}
const SEAT_LAYOUTS: Record<number, [number, number, number][]> = {
  3: [[-2.2, 0.62, -1.5], [0, 0.62, -2.0], [2.2, 0.62, -1.5]],
  4: [[-2.8, 0.62, -1.3], [-0.9, 0.62, -1.8], [0.9, 0.62, -1.8], [2.8, 0.62, -1.3]],
  5: [[-3.0, 0.62, -1.2], [-1.5, 0.62, -1.7], [0, 0.62, -2.0], [1.5, 0.62, -1.7], [3.0, 0.62, -1.2]],
}

function Courtroom({
  celebrities,
  activeSpeakerId,
  seats,
  mode,
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
  seats?: CourtSeat[]
  mode: CameraMode
}) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () => [
    '/models/balabala_courtroom.glb',
    ...celebrities.map((c) => c.model).filter((m): m is string => Boolean(m)),
    ...(seats ?? []).map((s) => s.model).filter((m): m is string => Boolean(m)),
  ])
  const sconceLights: Array<[number, number, number]> = [
    [-3.3, 2.4, -4.0], [-1.53, 2.4, -4.0], [1.53, 2.4, -4.0], [3.3, 2.4, -4.0],
    [-5.2, 2.3, -2.1], [5.2, 2.3, -2.1],
  ]
  const ceilingLights: Array<[number, number, number]> = [
    [0, 4.0, -2.6],
  ]
  // M13 generic seats take priority; otherwise fall back to celebrity arc layout.
  const layout = SEAT_LAYOUTS[Math.max(3, Math.min(5, celebrities.length))] ?? SEAT_LAYOUTS[3]
  // M13 修复 B：CameraRig 需要发言者的 role + side + position 才能选固定机位。
  // legacy bench 模式没有角色信息，直接给 null → idle 全景（弧形席位整体入画）。
  const activeSpeaker: ActiveSpeakerInfo | null = mode === 'wizard'
    ? null
    : seats
    ? (() => {
        const s = seats.find((x) => x.active)
        return s
          ? { role: s.role, side: s.side ?? null, position: s.position }
          : null
      })()
    : null

  return (
    <group ref={sceneRef}>
      <color attach="background" args={['#160d08']} />
      <ambientLight intensity={0.42} color="#ffe2b4" />
      <directionalLight position={[5, 9, 6]} intensity={2.3} color="#fff1d2" castShadow shadow-mapSize={[1024, 1024]} />
      <Environment resolution={128}>
        <Lightformer intensity={1.4} color="#ffdcb0" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.7} color="#dfe8ff" position={[-6, 2, 0]} rotation={[0, Math.PI / 2, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.7} color="#dfe8ff" position={[6, 2, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={1.1} color="#ffe8c8" position={[0, 2, 6]} scale={[10, 4, 1]} />
        <Lightformer intensity={0.5} color="#ffcf96" position={[0, 2, -6]} scale={[10, 4, 1]} />
      </Environment>
      {sconceLights.map((p, i) => (
        <pointLight key={`sconce-${i}`} position={p} intensity={13} distance={7} decay={2} color="#ffb066" />
      ))}
      {ceilingLights.map((p, i) => (
        <pointLight key={`ceil-${i}`} position={p} intensity={11} distance={7} decay={2} color="#ffe3b8" />
      ))}
      <Suspense fallback={null}>
        <CourtroomEnvironmentModel />
      </Suspense>
      {seats
        ? seats.map((s) => <GenericSeat key={s.id} seat={s} />)
        : celebrities.slice(0, layout.length).map((c, i) => (
            <BenchSeat key={c.id} celebrity={c} position={layout[i]} active={c.id === activeSpeakerId} />
          ))}
      <CameraRig mode={mode} activeSpeaker={activeSpeaker}>{null}</CameraRig>
    </group>
  )
}

/**
 * The full 3D courtroom view (Canvas + scene). Extracted as a lazily-loaded
 * chunk so three/r3f only download when the user actually enters the courtroom.
 *
 * Two modes:
 *  - Legacy bench mode: pass `celebrities` + `activeSpeakerId` (arc bench).
 *  - M13 fullscreen mode: pass `seats` (judge / plaintiff / defendant / defenders).
 */
export default function CourtroomView({
  celebrities,
  activeSpeakerId,
  seats,
  cameraMode = 'trial',
}: {
  celebrities?: Celebrity[]
  activeSpeakerId?: string | null
  seats?: CourtSeat[]
  cameraMode?: CameraMode
}) {
  const init = getCameraForMode(cameraMode)
  return (
    <Canvas shadows camera={{ position: init.position, fov: init.fov }} dpr={[1, 2]}>
      <Courtroom celebrities={celebrities ?? []} activeSpeakerId={activeSpeakerId ?? null} seats={seats} mode={cameraMode} />
    </Canvas>
  )
}

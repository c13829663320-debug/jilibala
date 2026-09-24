import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'
import NeutralMannequin from './NeutralMannequin'
import type { CourtSeatKind } from './courtroom-seats'
import { buildFixedSeats } from './courtroom-seats'
import {
  TRIAL_CAMERA,
  WIZARD_CAMERA,
  clampCameraPosition,
  getCameraForMode,
  getViewCamera,
  type ActiveSpeakerInfo,
  type CameraMode,
  type CourtPerspective,
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
  const { scene } = useGLTF('/models/balabala_courtroom.glb?v=2', false, true)
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

/**
 * 氛围 NPC 的代码人形（不加载白色 GLB 胶囊）：旁听为低饱和彩色坐姿、
 * 证人为中性站姿。颜色低饱和、与暖木法庭协调，小尺寸在画面两侧不抢眼。
 */
const AUDIENCE_PALETTE: Array<[string, string]> = [
  ['#6E84A8', '#A6B6D0'], // 蓝灰
  ['#A8836E', '#D0B4A6'], // 暖棕
  ['#6E9C8E', '#A6C8BE'], // 青绿
  ['#9C8E6E', '#C8BEA6'], // 卡其
]

function NpcFigure({ kind, index }: { kind: CourtSeatKind; index: number }) {
  if (kind === 'witness') {
    return (
      <group>
        <mesh castShadow position={[0, 0.95, 0]}>
          <capsuleGeometry args={[0.19, 0.72, 8, 16]} />
          <meshStandardMaterial color="#7E8798" roughness={0.85} />
        </mesh>
        <mesh castShadow position={[0, 1.58, 0]}>
          <sphereGeometry args={[0.17, 16, 16]} />
          <meshStandardMaterial color="#AEB5C2" roughness={0.85} />
        </mesh>
      </group>
    )
  }
  const pal = AUDIENCE_PALETTE[index % AUDIENCE_PALETTE.length]
  return (
    <group>
      <mesh castShadow position={[0, 0.52, 0]}>
        <capsuleGeometry args={[0.15, 0.38, 8, 14]} />
        <meshStandardMaterial color={pal[0]} roughness={0.9} />
      </mesh>
      <mesh castShadow position={[0, 0.93, 0]}>
        <sphereGeometry args={[0.15, 14, 14]} />
        <meshStandardMaterial color={pal[1]} roughness={0.9} />
      </mesh>
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
  const npcIndex = (() => { const m = seat.id.match(/(\d+)$/); return m ? parseInt(m[1], 10) - 1 : 0 })()
  const isCodeNpc = seat.kind === 'audience' || seat.kind === 'witness'
  const body = isCodeNpc ? (
    <group rotation={[0, seat.facing ?? 0, 0]}>
      <NpcFigure kind={seat.kind ?? 'audience'} index={npcIndex} />
    </group>
  ) : (
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

  // 第七轮：单一名牌（发言时内容含"名字·发言中"，不另渲染常显名牌）。
  // GLB 归一化站姿高 1.7（头 local≈1.7）；名牌统一浮在头顶上方 local≈1.95，
  // 发言时略抬到 2.15，避免压住身体、也避免与相邻角色名牌在屏幕上重叠。
  return (
    <group position={seat.position}>
      <SeatRing active={seat.active} />
      {seat.active && <SpeakerSpotlight />}
      {body}
      <Text
        position={[0, seat.active ? 2.15 : 1.95, 0.06]}
        fontSize={seat.active ? 0.24 : 0.16}
        color={seat.active ? '#ffe6a8' : '#f4ecff'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={seat.active ? 0.026 : 0.01}
        outlineColor={seat.active ? '#a45a00' : '#160f24'}
      >
        {seat.active ? `${seat.name} · 发言中` : seat.name}
      </Text>
    </group>
  )
}

/**
 * M13 第七轮：主全景机位默认，相机就位后用户 OrbitControls 完全接管。
 *
 *  - trial/bench：进入时用显式快照（from 当前机位）+ easeInOutQuad 在 1.4s 内
 *    平滑 settle 到主全景 [0,4.3,4.5]→[0,0.9,-1.3]；过渡全程 clamp 在 ROOM_CLAMP 内。
 *    第六轮旧实现靠 useFrame 内 modeRef diff + 指数 lerp，真机上 wizard→trial 偶尔
 *    不触发（相机停在家具内满屏木纹）；第七轮改为 useEffect(mode) 显式打快照 + 确定性
 *    插值，保证开庭后 1 秒内必然到达主机位。
 *  - 过渡结束后绝不主动移动相机——用户 OrbitControls 完全接管，发言者只靠
 *    SeatRing+聚光+名牌高亮。
 *  - 用户拖拽/缩放立即生效，绝不被下一帧覆盖。
 *  - wizard: 维持全景 autoRotate，保留用户 orbit/zoom 绕 target 的 offset。
 *  - 每帧仍 clampCameraPosition，相机永不离开房间。
 */
function CameraRig({
  mode,
  perspective = 'audience',
  children,
}: {
  mode: CameraMode
  perspective?: CourtPerspective
  activeSpeaker: ActiveSpeakerInfo | null
  children: ReactNode
}) {
  // trial 模式下目标机位随视角（原告/观众/被告）；wizard/bench 不用它。
  const aimView = mode === 'trial' ? getViewCamera(perspective) : null
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)
  const camera = useThree((s) => s.camera)
  const desiredTarget = useMemo(() => new Vector3(), [])
  const desiredCamera = useMemo(() => new Vector3(), [])
  const offset = useMemo(() => new Vector3(), [])
  const clockNow = useRef(0)
  // 显式过渡：mode 切换瞬间打快照（起点机位/目标点），useFrame 内按进度插值。
  const trans = useRef<{
    fromPos: Vector3
    fromTgt: Vector3
    start: number
    dur: number
  } | null>(null)
  const modeInitialized = useRef(false)

  // mode 或视角变化 → 立即记录过渡起点（trial 内切换原告/观众/被告也打快照）。
  useLayoutEffect(() => {
    const c = controls.current
    if (!c) return
    // 首次挂载不做过渡；仅在真实切换（mode 或视角）时打快照。
    if (!modeInitialized.current) {
      modeInitialized.current = true
      return
    }
    if (mode === 'wizard') return
    trans.current = {
      fromPos: new Vector3(camera.position.x, camera.position.y, camera.position.z),
      fromTgt: new Vector3(c.target.x, c.target.y, c.target.z),
      start: clockNow.current,
      dur: 1.3,
    }
  }, [mode, perspective, camera])

  useFrame(({ clock }, delta) => {
    const c = controls.current
    if (!c) return
    const now = clock.getElapsedTime()
    clockNow.current = now
    // frame-rate independent lerp（wizard 自转用）
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.1))

    if (mode === 'wizard') {
      desiredTarget.set(WIZARD_CAMERA.target[0], WIZARD_CAMERA.target[1], WIZARD_CAMERA.target[2])
      c.target.lerp(desiredTarget, k)
      // wizard 保留用户 orbit/zoom 绕 target 的 offset（autoRotate 自己转）
      offset.subVectors(camera.position, c.target)
      desiredCamera.copy(desiredTarget).add(offset)
      camera.position.lerp(desiredCamera, k)
    } else if (trans.current) {
      // trial：确定性缓动到当前视角机位（原告/观众/被告）；bench：缓动到主全景。
      const goalPos = aimView ? aimView.position : TRIAL_CAMERA.position
      const goalTgt = aimView ? aimView.target : TRIAL_CAMERA.target
      desiredTarget.set(goalTgt[0], goalTgt[1], goalTgt[2])
      desiredCamera.set(goalPos[0], goalPos[1], goalPos[2])
      const t = trans.current
      const p = Math.min(1, Math.max(0, (now - t.start) / t.dur))
      const e = p < 0.5 ? 2 * p * p : 1 - Math.pow(-2 * p + 2, 2) / 2
      camera.position.lerpVectors(t.fromPos, desiredCamera, e)
      c.target.lerpVectors(t.fromTgt, desiredTarget, e)
      if (p >= 1) trans.current = null
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
        autoRotateSpeed={0.3}
        target={aimView ? aimView.target : TRIAL_CAMERA.target}
        minDistance={TRIAL_CAMERA.minDistance}
        maxDistance={TRIAL_CAMERA.maxDistance}
        maxPolarAngle={TRIAL_CAMERA.maxPolarAngle}
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
  perspective = 'audience',
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
  seats?: CourtSeat[]
  mode: CameraMode
  perspective?: CourtPerspective
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
      <CameraRig mode={mode} perspective={perspective} activeSpeaker={activeSpeaker}>{null}</CameraRig>
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
  perspective = 'audience',
}: {
  celebrities?: Celebrity[]
  activeSpeakerId?: string | null
  seats?: CourtSeat[]
  cameraMode?: CameraMode
  perspective?: CourtPerspective
}) {
  const init = getCameraForMode(cameraMode)
  return (
    <SafeCanvas shadows camera={{ position: init.position, fov: init.fov }} dpr={[1, 2]}>
      <Courtroom celebrities={celebrities ?? []} activeSpeakerId={activeSpeakerId ?? null} seats={seats} mode={cameraMode} perspective={perspective} />
    </SafeCanvas>
  )
}

/* ============================ DEBUG 隔离渲染（临时） ============================
 * URL: /?debug=court&scene=env&cam=x,y,z&look=x,y,z[&fov=50]
 *      /?debug=court&scene=seat&kind=judge&cam=...&look=...
 *  - scene=env  : 只渲染环境 GLB + 坐标网格标尺，不渲染任何席位
 *  - scene=seat : 环境 GLB + 网格 + 仅 kind 指定的那一个固定席位（按 seats.ts 当前坐标落位）
 * 相机由 cam/look 查询参数固定，无 OrbitControls。
 * 调试结束后整块删除，并删 main.tsx 里的短路。
 * ========================================================================== */
function CameraLookAt({ look }: { look: [number, number, number] }) {
  const camera = useThree((s) => s.camera)
  useLayoutEffect(() => {
    camera.lookAt(look[0], look[1], look[2])
  }, [camera, look])
  return null
}

export function DebugCourtScene() {
  const params = typeof window !== 'undefined' ? new URLSearchParams(window.location.search) : new URLSearchParams()
  const scene = params.get('scene') ?? 'env'
  const kind = params.get('kind') ?? 'judge'
  const camParam = params.get('cam') ?? '0,8,0'
  const lookParam = params.get('look') ?? '0,0,0'
  const fov = parseFloat(params.get('fov') ?? '50')
  const [cx, cy, cz] = camParam.split(',').map((v) => parseFloat(v.trim())) as [number, number, number]
  const [lx, ly, lz] = lookParam.split(',').map((v) => parseFloat(v.trim())) as [number, number, number]

  const seats = useMemo<CourtSeat[]>(() => {
    const toSeat = (found: ReturnType<typeof buildFixedSeats>[number]): CourtSeat => {
      const role: CourtSeat['role'] =
        found.kind === 'judge' ? 'judge'
        : found.kind === 'plaintiff' ? 'plaintiff'
        : found.kind === 'defendant' ? 'defender'
        : 'defender'
      const side: CourtSeat['side'] =
        found.kind === 'plaintiff' ? 'plaintiff'
        : found.kind === 'defendant' ? 'defendant'
        : found.kind === 'plaintiff-counsel' ? 'plaintiff'
        : found.kind === 'defendant-counsel' ? 'defendant'
        : null
      return {
        id: found.id, name: found.name, role, side,
        kind: found.kind, model: found.model,
        position: found.position, facing: found.facing, npc: found.npc, active: false,
      }
    }
    if (scene === 'all') return buildFixedSeats().map(toSeat)
    if (scene !== 'seat') return []
    const found = buildFixedSeats().find((s) => s.kind === kind)
    if (!found) return []
    return [toSeat(found)]
  }, [scene, kind])

  return (
    <div style={{ position: 'fixed', inset: 0, width: '100vw', height: '100vh' }}>
    <SafeCanvas shadows camera={{ position: [cx, cy, cz], fov, near: 0.05, far: 120 }} dpr={[1, 1]}>
      <color attach="background" args={['#160d08']} />
      <ambientLight intensity={0.55} color="#ffe2b4" />
      <directionalLight position={[5, 9, 6]} intensity={2.0} color="#fff1d2" castShadow shadow-mapSize={[1024, 1024]} />
      <pointLight position={[0, 4.0, 0]} intensity={12} distance={12} decay={2} color="#ffe3b8" />
      <Environment resolution={128}>
        <Lightformer intensity={1.2} color="#ffdcb0" position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 10, 1]} />
        <Lightformer intensity={0.8} color="#ffe8c8" position={[0, 2, 6]} scale={[10, 4, 1]} />
      </Environment>
      <Suspense fallback={null}>
        <CourtroomEnvironmentModel />
      </Suspense>
      {/* 坐标网格：1m 一格，中心线红色(x轴)/绿色(z轴) */}
      <gridHelper args={[12, 12, '#ff5555', '#3a3a3a']} position={[0, 0.01, 0]} />
      <axesHelper args={[1.2]} position={[0, 0.02, 0]} />
      {/* 轴向与刻度标签 */}
      <Text position={[6.2, 0.06, 0]} fontSize={0.28} color="#ff7777" anchorX="center" anchorY="middle">+x</Text>
      <Text position={[-6.2, 0.06, 0]} fontSize={0.28} color="#ff7777" anchorX="center" anchorY="middle">-x</Text>
      <Text position={[0, 0.06, 6.2]} fontSize={0.28} color="#77ff77" anchorX="center" anchorY="middle">+z(后/观众)</Text>
      <Text position={[0, 0.06, -6.2]} fontSize={0.28} color="#77ff77" anchorX="center" anchorY="middle">-z(法官)</Text>
      {[-4, -3, -2, -1, 1, 2, 3, 4].map((x) => (
        <Text key={'gx' + x} position={[x, 0.06, 0.35]} fontSize={0.16} color="#ffcc66" anchorX="center" anchorY="middle">{x}</Text>
      ))}
      {[-4, -3, -2, -1, 1, 2, 3, 4].map((z) => (
        <Text key={'gz' + z} position={[0.35, 0.06, z]} fontSize={0.16} color="#66ccff" anchorX="center" anchorY="middle">{z}</Text>
      ))}
      <CameraLookAt look={[lx, ly, lz]} />
      {seats.map((s) => <GenericSeat key={s.id} seat={s} />)}
    </SafeCanvas>
    </div>
  )
}

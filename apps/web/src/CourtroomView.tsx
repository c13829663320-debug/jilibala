import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'
import {
  TRIAL_CAMERA,
  WIZARD_CAMERA,
  clampCameraPosition,
  getCameraForMode,
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

function NormalizedCourtroomModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    // Full-body celebrity models: normalize by HEIGHT (size.y) to ~1.7 scene
    // units so they fit the courtroom seat without being oversized. Feet sit on
    // the local ground (position.y = -bounds.min.y * scale), matching the seat.
    const scale = 1.7 / Math.max(size.y, 0.001)
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
  model?: string
  position: [number, number, number]
  active: boolean
  side?: 'plaintiff' | 'defendant' | null
}

interface SeatSlot {
  celebrity: Celebrity
  position: [number, number, number]
  active: boolean
}

function BenchSeat({ celebrity, position, active }: SeatSlot) {
  const fallback = (
    <group position={[0, 0, 0]}>
      <MemberPlaceholder name={celebrity.name} active={active} />
    </group>
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

/** M13: a generic seat (judge / party / defender) rendered from a CourtSeat descriptor. */
function GenericSeat({ seat }: { seat: CourtSeat }) {
  const tint = seat.role === 'judge' ? 'judge'
    : seat.side === 'plaintiff' ? 'plaintiff'
    : seat.side === 'defendant' ? 'defendant'
    : undefined
  const fallback = (
    <group position={[0, 0, 0]}>
      <MemberPlaceholder name={seat.name} active={seat.active} tint={tint} />
    </group>
  )
  return (
    <group position={seat.position}>
      <SeatRing active={seat.active} />
      {seat.active && <SpeakerSpotlight />}
      {seat.model ? (
        <CourtroomModelErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <NormalizedCourtroomModel url={seat.model} />
          </Suspense>
        </CourtroomModelErrorBoundary>
      ) : (
        fallback
      )}
      <Text
        position={[0, seat.active ? 2.0 : 1.78, 0.06]}
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
 * Smoothly pans the OrbitControls target (and the camera that orbits it)
 * toward the currently speaking seat. User drag still works because we only
 * lerp the target + preserve the camera's current offset from it.
 *
 * Modes:
 *  - trial/bench: follow active seat (idle → TRIAL_CAMERA framing).
 *  - wizard: fixed wide panorama with slow auto-rotate, no seat following.
 * Camera position is clamped into ROOM_CLAMP every frame so the rig can never
 * push the camera through a wall / the floor / the ceiling.
 */
function CameraRig({
  mode,
  activeSeat,
  children,
}: {
  mode: CameraMode
  activeSeat: [number, number, number] | null
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

  useFrame(({ clock }, delta) => {
    const c = controls.current
    if (!c) return
    const now = clock.getElapsedTime()
    if (modeRef.current !== mode) {
      modeRef.current = mode
      transitionUntil.current = now + 1.2
    }
    const transitioning = now < transitionUntil.current

    if (mode === 'wizard') {
      desiredTarget.set(WIZARD_CAMERA.target[0], WIZARD_CAMERA.target[1], WIZARD_CAMERA.target[2])
    } else if (activeSeat) {
      desiredTarget.set(activeSeat[0], 1.1, activeSeat[2])
    } else {
      desiredTarget.set(TRIAL_CAMERA.target[0], TRIAL_CAMERA.target[1], TRIAL_CAMERA.target[2])
    }
    // frame-rate independent lerp
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.1))
    c.target.lerp(desiredTarget, k)
    if (transitioning) {
      // ease the whole camera onto the mode's canonical position on mode switch
      desiredCamera.set(cfg.position[0], cfg.position[1], cfg.position[2])
      camera.position.lerp(desiredCamera, k)
    } else {
      // keep camera roughly over the speaker without fighting user zoom/polar
      offset.subVectors(camera.position, c.target)
      desiredCamera.copy(desiredTarget).add(offset)
      camera.position.lerp(desiredCamera, k)
    }
    // hard clamp so the camera can never leave the room
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
  const activeSeat: [number, number, number] | null = mode === 'wizard'
    ? null
    : seats
    ? (() => {
        const s = seats.find((x) => x.active)
        return s ? s.position : null
      })()
    : (() => {
        const idx = celebrities.findIndex((c) => c.id === activeSpeakerId)
        return idx >= 0 ? layout[idx] : null
      })()

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
      <CameraRig mode={mode} activeSeat={activeSeat}>{null}</CameraRig>
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

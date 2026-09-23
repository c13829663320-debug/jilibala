import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'

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
function MemberPlaceholder({ name, active }: { name: string; active: boolean }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.22, 0.3, 1.3, 16]} />
        <meshStandardMaterial color={active ? '#e8b25a' : '#5b4a8a'} />
      </mesh>
      <mesh castShadow position={[0, 1.72, 0]}>
        <sphereGeometry args={[0.18, 16, 16]} />
        <meshStandardMaterial color={active ? '#f2d39a' : '#8a7cc0'} />
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

/**
 * Smoothly pans the OrbitControls target (and the camera that orbits it)
 * toward the currently speaking seat. User drag still works because we only
 * lerp the target + preserve the camera's current offset from it.
 */
function CameraRig({
  activeSeat,
  children,
}: {
  activeSeat: [number, number, number] | null
  children: ReactNode
}) {
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)
  const camera = useThree((s) => s.camera)
  const desiredTarget = useMemo(() => new Vector3(0, 1.2, -0.8), [])
  const desiredCamera = useMemo(() => new Vector3(), [])
  const offset = useMemo(() => new Vector3(), [])

  useFrame((_, delta) => {
    const c = controls.current
    if (!c) return
    if (activeSeat) desiredTarget.set(activeSeat[0], 1.1, activeSeat[2])
    else desiredTarget.set(0, 1.2, -0.8)
    // frame-rate independent lerp
    const k = 1 - Math.pow(0.0015, Math.min(delta, 0.1))
    c.target.lerp(desiredTarget, k)
    // keep camera roughly over the speaker without fighting user zoom/polar
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
        target={[0, 1.2, -0.8]}
        minDistance={2}
        maxDistance={6.4}
        maxPolarAngle={Math.PI / 2.05}
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
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
}) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () => [
    '/models/balabala_courtroom.glb',
    ...celebrities.map((c) => c.model).filter((m): m is string => Boolean(m)),
  ])
  const sconceLights: Array<[number, number, number]> = [
    [-3.3, 2.4, -4.0], [-1.53, 2.4, -4.0], [1.53, 2.4, -4.0], [3.3, 2.4, -4.0],
    [-5.2, 2.3, -2.1], [5.2, 2.3, -2.1],
  ]
  const ceilingLights: Array<[number, number, number]> = [
    [0, 4.0, -2.6],
  ]
  const layout = SEAT_LAYOUTS[Math.max(3, Math.min(5, celebrities.length))] ?? SEAT_LAYOUTS[3]
  const activeSeat: [number, number, number] | null = (() => {
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
      {celebrities.slice(0, layout.length).map((c, i) => (
        <BenchSeat key={c.id} celebrity={c} position={layout[i]} active={c.id === activeSpeakerId} />
      ))}
      <CameraRig activeSeat={activeSeat}>{null}</CameraRig>
    </group>
  )
}

/**
 * The full 3D courtroom view (Canvas + scene). Extracted as a lazily-loaded
 * chunk so three/r3f only download when the user actually enters the courtroom.
 */
export default function CourtroomView({
  celebrities,
  activeSpeakerId,
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
}) {
  return (
    <Canvas shadows camera={{ position: [0, 2.1, 3.7], fov: 45 }} dpr={[1, 2]}>
      <Courtroom celebrities={celebrities} activeSpeakerId={activeSpeakerId} />
    </Canvas>
  )
}

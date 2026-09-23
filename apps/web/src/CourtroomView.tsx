import { Component, Suspense, useMemo, type ErrorInfo, type ReactNode } from 'react'
import { Canvas } from '@react-three/fiber'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'

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

function CourtroomCharacter({ character }: { character: Celebrity }) {
  if (!character.model) return null
  const fallback = null
  return (
    <group position={[-1.83, 0.62, -1.5]}>
      <CourtroomModelErrorBoundary fallback={fallback}>
        <Suspense fallback={fallback}>
          <NormalizedCourtroomModel url={character.model} />
          <Text position={[0, 1.72, 0.06]} fontSize={0.2} color="#f4ecff" anchorX="center" anchorY="middle" outlineWidth={0.012} outlineColor="#160f24">{character.name}</Text>
        </Suspense>
      </CourtroomModelErrorBoundary>
    </group>
  )
}

function Courtroom({ character }: { character: Celebrity | null }) {
  const sconceLights: Array<[number, number, number]> = [
    [-3.3, 2.4, -4.0], [-1.53, 2.4, -4.0], [1.53, 2.4, -4.0], [3.3, 2.4, -4.0],
    [-5.2, 2.3, -2.1], [5.2, 2.3, -2.1],
  ]
  const ceilingLights: Array<[number, number, number]> = [
    [0, 4.0, -2.6],
  ]
  return (
    <group>
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
      {character?.model && <CourtroomCharacter character={character} />}
    </group>
  )
}

/**
 * The full 3D courtroom view (Canvas + scene). Extracted as a lazily-loaded
 * chunk so three/r3f only download when the user actually enters the courtroom.
 */
export default function CourtroomView({ character }: { character: Celebrity | null }) {
  return (
    <Canvas shadows camera={{ position: [0, 2.1, 3.7], fov: 45 }} dpr={[1, 2]}>
      <Courtroom character={character} />
      <OrbitControls enablePan={false} target={[0, 1.2, -0.8]} minDistance={2} maxDistance={6.4} maxPolarAngle={Math.PI / 2.05} />
    </Canvas>
  )
}

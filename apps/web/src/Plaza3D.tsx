import { Suspense, useLayoutEffect, useRef, useState, type MutableRefObject } from 'react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Text, useGLTF } from '@react-three/drei'
import * as THREE from 'three'
import { ArrowLeft, MessagesSquare } from 'lucide-react'
import { Plaza } from './Plaza'
import './plaza-3d.css'

const BUILDINGS = [
  { id: 'court', name: '法庭', x: 0, z: -14, isCourt: true },
  { id: 'talkshow', name: '脱口秀', x: 12.12, z: -7, isCourt: false },
  { id: 'werewolf', name: '狼人杀', x: 12.12, z: 7, isCourt: false },
  { id: 'bar', name: '酒吧', x: 0, z: 14, isCourt: false },
  { id: 'gym', name: '健身房', x: -12.12, z: 7, isCourt: false },
  { id: 'library', name: '图书馆', x: -12.12, z: -7, isCourt: false },
] as const

const HIT_RADIUS = 6
const CAMERA_Y = 16

type Marker = { id: number; x: number; z: number; born: number }

function PlazaModel({ onPick }: { onPick: (e: ThreeEvent<MouseEvent>) => void }) {
  const { scene } = useGLTF('/models/balabala_plaza.glb', false, true)
  useLayoutEffect(() => {
    scene.traverse((child) => {
      const mesh = child as THREE.Mesh
      if (mesh.isMesh) {
        mesh.castShadow = true
        mesh.receiveShadow = true
        // Let all clicks fall through to the invisible ground plane; we do
        // distance-based building hit detection against the ray-ground point.
        // useLayoutEffect runs before paint so no user click lands on these meshes.
        mesh.raycast = () => {}
      }
    })
  }, [scene])
  return <primitive object={scene} onClick={onPick} />
}

function RingMarker({ marker, onDone }: { marker: Marker; onDone: (id: number) => void }) {
  const meshRef = useRef<THREE.Mesh>(null)
  const matRef = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(() => {
    const age = (performance.now() - marker.born) / 1000
    const t = Math.min(age / 1.2, 1)
    if (meshRef.current) {
      const s = 0.6 + t * 1.8
      meshRef.current.scale.set(s, s, 1)
    }
    if (matRef.current) matRef.current.opacity = 1 - t
    if (t >= 1) onDone(marker.id)
  })
  return (
    <mesh ref={meshRef} rotation={[-Math.PI / 2, 0, 0]} position={[marker.x, 0.03, marker.z]}>
      <ringGeometry args={[0.7, 1.0, 32]} />
      <meshBasicMaterial ref={matRef} color="#FFD600" transparent opacity={1} side={THREE.DoubleSide} depthWrite={false} />
    </mesh>
  )
}

function CameraRig({ target, lookAt }: { target: MutableRefObject<THREE.Vector3>; lookAt: MutableRefObject<THREE.Vector3> }) {
  const { camera } = useThree()
  useFrame((_, delta) => {
    const t = Math.min(delta * 2.5, 1)
    camera.position.lerp(target.current, t)
    camera.lookAt(lookAt.current)
  })
  return null
}

function PlazaScene({ onEnterCourt, toast }: { onEnterCourt: () => void; toast: (msg: string) => void }) {
  const targetRef = useRef(new THREE.Vector3(0, CAMERA_Y, 22))
  const lookRef = useRef(new THREE.Vector3(0, 0, 0))
  const [markers, setMarkers] = useState<Marker[]>([])
  const [hovered, setHovered] = useState<string | null>(null)

  const hitBuilding = (x: number, z: number) => {
    for (const b of BUILDINGS) {
      const dx = x - b.x
      const dz = z - b.z
      if (dx * dx + dz * dz < HIT_RADIUS * HIT_RADIUS) return b
    }
    return null
  }

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation()
    const b = hitBuilding(e.point.x, e.point.z)
    if (b) {
      if (b.isCourt) onEnterCourt()
      else toast(`${b.name} 即将开放，敬请期待`)
      return
    }
    targetRef.current.set(e.point.x, CAMERA_Y, e.point.z)
    lookRef.current.set(e.point.x, 0, e.point.z)
    const id = Date.now() + Math.random()
    setMarkers((arr) => [...arr, { id, x: e.point.x, z: e.point.z, born: performance.now() }])
  }

  const handleMove = (e: ThreeEvent<PointerEvent>) => {
    const b = hitBuilding(e.point.x, e.point.z)
    const id = b ? b.id : null
    setHovered((prev) => (prev === id ? prev : id))
  }

  return (
    <>
      <color attach="background" args={['#0a0a0a']} />
      <ambientLight intensity={0.75} />
      <directionalLight position={[12, 22, 10]} intensity={1.4} castShadow shadow-mapSize={[1024, 1024]} />
      <Suspense fallback={null}>
        <PlazaModel onPick={handleClick} />
      </Suspense>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} onClick={handleClick} onPointerMove={handleMove}>
        <planeGeometry args={[90, 90]} />
        <meshBasicMaterial side={THREE.DoubleSide} depthWrite={false} colorWrite={false} />
      </mesh>
      {BUILDINGS.map((b) => (
        <Billboard key={b.id} position={[b.x, 5, b.z]}>
          <Text fontSize={hovered === b.id ? 0.95 : 0.75} color={hovered === b.id ? '#FFFFFF' : '#FFD600'} anchorX="center" anchorY="middle" outlineWidth={0.03} outlineColor="#000000" raycast={() => null}>
            {b.name}
          </Text>
        </Billboard>
      ))}
      {markers.map((m) => (
        <RingMarker key={m.id} marker={m} onDone={(id) => setMarkers((arr) => arr.filter((x) => x.id !== id))} />
      ))}
      <CameraRig target={targetRef} lookAt={lookRef} />
    </>
  )
}

export default function Plaza3D({ onBack, onEnterCourt }: { onBack: () => void; onEnterCourt: () => void }) {
  const [showDiscuss, setShowDiscuss] = useState(false)
  const [toastMsg, setToastMsg] = useState('')
  const toastTimer = useRef<number | null>(null)

  const toast = (msg: string) => {
    if (toastTimer.current) window.clearTimeout(toastTimer.current)
    setToastMsg(msg)
    toastTimer.current = window.setTimeout(() => setToastMsg(''), 2200)
  }

  return (
    <div className="plaza-3d-root">
      <Canvas shadows camera={{ position: [0, CAMERA_Y, 22], fov: 50, near: 0.1, far: 200 }} dpr={[1, 1.5]}>
        <PlazaScene onEnterCourt={onEnterCourt} toast={toast} />
      </Canvas>
      <div className="plaza-3d-topbar">
        <button className="plaza-3d-back" onClick={onBack} aria-label="返回">
          <ArrowLeft size={18} />
        </button>
        <div className="plaza-3d-title">广场</div>
        <img className="plaza-3d-logo" src="/brand/balabala-mark-clean.jpg" alt="BalaBala" />
      </div>
      <div className="plaza-3d-hint">点击地面移动 · 点击建筑进入</div>
      <button className="plaza-3d-discuss" onClick={() => setShowDiscuss(true)}>
        <MessagesSquare size={16} /> 讨论区
      </button>
      {toastMsg && <div className="plaza-3d-toast">{toastMsg}</div>}
      {showDiscuss && (
        <div className="plaza-3d-discuss-overlay">
          <Plaza onBack={() => setShowDiscuss(false)} />
        </div>
      )}
    </div>
  )
}
import { Component, Suspense, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Vector3 } from 'three'
import { getCelebrity, type WerewolfPlayerSnapshot, type WerewolfPublicPlayer } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'

const RED_NEON = '#ff2a3a'
const SPEAKER_YELLOW = '#4fb3a5'
const WOLF_RED = '#ff2233'
const TABLE_RADIUS = 2.8
const CHAIR_RADIUS = 3.4

/** 模型加载失败时不拖垮整个 Canvas。 */
class WerewolfModelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Werewolf model failed to load', error, info.componentStack)
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** 全身名人模型按高度归一化到 ~1.7，脚置局部原点。 */
function NormalizedWerewolfModel({ url, dead }: { url: string; dead: boolean }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = 1.7 / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
      if (dead) {
        const mat = (child as { material?: MeshStandardMaterial }).material
        if (mat && mat.isMaterial) {
          mat.color?.set('#555555')
          mat.emissive?.set('#222222')
        }
      }
    })
    return clone
  }, [scene, dead])
  return <primitive object={normalized} />
}

/** 黄色发光发言圈，脉动。 */
function SpeakerRing({ active, color }: { active: boolean; color: string }) {
  const mat = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    const t = clock.getElapsedTime()
    mat.current.emissiveIntensity = active ? 2.2 + Math.sin(t * 4) * 1.0 : 0.3
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      <ringGeometry args={[0.42, 0.62, 40]} />
      <meshStandardMaterial
        ref={mat}
        color={active ? color : '#222'}
        emissive={active ? color : '#111'}
        emissiveIntensity={active ? 2.2 : 0.3}
        transparent
        opacity={active ? 1 : 0.5}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** 胶囊占位化身。 */
function CapsuleAvatar({ dead }: { dead: boolean }) {
  const bodyColor = dead ? '#4a4a4a' : '#5a6a8a'
  const headColor = dead ? '#5a5a5a' : '#8a9ab8'
  return (
    <group>
      <mesh castShadow position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.22, 0.3, 1.3, 16]} />
        <meshStandardMaterial color={bodyColor} roughness={0.8} />
      </mesh>
      <mesh castShadow position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.19, 16, 16]} />
        <meshStandardMaterial color={headColor} roughness={0.8} />
      </mesh>
    </group>
  )
}

/** 一把围绕圆桌的椅子（box 组合）。 */
function Chair() {
  return (
    <group>
      {/* 椅面 */}
      <mesh castShadow position={[0, 0.45, 0]}>
        <boxGeometry args={[0.55, 0.08, 0.55]} />
        <meshStandardMaterial color="#2a1f14" roughness={0.9} />
      </mesh>
      {/* 椅背（local +Z 方向，即远离桌子中心） */}
      <mesh castShadow position={[0, 0.82, 0.25]}>
        <boxGeometry args={[0.55, 0.65, 0.07]} />
        <meshStandardMaterial color="#241a10" roughness={0.9} />
      </mesh>
      {/* 四条腿 */}
      {[[-0.22, -0.22], [0.22, -0.22], [-0.22, 0.22], [0.22, 0.22]].map(([lx, lz], i) => (
        <mesh key={i} castShadow position={[lx, 0.225, lz]}>
          <boxGeometry args={[0.05, 0.45, 0.05]} />
          <meshStandardMaterial color="#1a120a" roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** 单个座位：椅子 + 化身 + 号码牌 + 发言圈。 */
function SeatGroup({
  player,
  seat,
  isSpeaker,
  isWolfTeammate,
  myRole,
}: {
  player: WerewolfPublicPlayer
  seat: number
  isSpeaker: boolean
  isWolfTeammate: boolean
  myRole?: string
}) {
  const angle = seat * (2 * Math.PI / 9)
  const x = CHAIR_RADIUS * Math.cos(angle)
  const z = CHAIR_RADIUS * Math.sin(angle)
  // 面向桌子中心：forward 指向原点
  const rotY = Math.atan2(-x, -z)
  const dead = !player.alive

  const celeb = player.celebrityId ? getCelebrity(player.celebrityId) : undefined
  const modelUrl = celeb?.model
  const showWolfGlow = myRole === 'werewolf' && isWolfTeammate && !dead

  return (
    <group position={[x, 0, z]}>
      {/* 发言 / 狼队友光环：世界空间，保持水平 */}
      {(isSpeaker || showWolfGlow) && (
        <SpeakerRing active={isSpeaker} color={isSpeaker ? SPEAKER_YELLOW : WOLF_RED} />
      )}

      {/* 面向桌子中心的椅子 + 化身 */}
      <group rotation={[0, rotY, 0]}>
        <Chair />
        {modelUrl ? (
          <WerewolfModelErrorBoundary fallback={<CapsuleAvatar dead={dead} />}>
            <Suspense fallback={null}>
              <NormalizedWerewolfModel url={modelUrl} dead={dead} />
            </Suspense>
          </WerewolfModelErrorBoundary>
        ) : (
          <CapsuleAvatar dead={dead} />
        )}
      </group>

      {/* 号码牌：世界空间悬浮，始终可读 */}
      <Text
        position={[0, 2.25, 0]}
        fontSize={0.3}
        color={dead ? '#888' : '#ffe6b0'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.025}
        outlineColor={dead ? '#333' : '#3a2000'}
      >
        {`${seat + 1}`}
      </Text>
      {dead && (
        <Text
          position={[0, 2.65, 0]}
          fontSize={0.28}
          color="#ff4444"
          anchorX="center"
          anchorY="middle"
        >
          💀
        </Text>
      )}
    </group>
  )
}

/** 昼夜灯光控制。 */
function RoomLights({ night }: { night: boolean }) {
  return (
    <>
      <ambientLight intensity={night ? 0.15 : 0.7} color={night ? '#4455aa' : '#ffe6b0'} />
      <pointLight
        position={[0, 5, 0]}
        intensity={night ? 2 : 18}
        distance={20}
        decay={2}
        color={night ? '#4466aa' : '#ffd090'}
      />
      <pointLight position={[-4, 3, -3]} intensity={night ? 1 : 8} distance={12} decay={2} color={night ? '#334488' : '#ffc080'} />
      <pointLight position={[4, 3, 3]} intensity={night ? 1 : 8} distance={12} decay={2} color={night ? '#334488' : '#ffc080'} />
    </>
  )
}

/** 相机控制：俯视圆桌，可旋转缩放。 */
function CameraRig() {
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    controls.current?.update()
    camera.lookAt(0, 0.8, 0)
  })
  return (
    <OrbitControls
      ref={controls as never}
      enablePan={false}
      target={[0, 0.8, 0]}
      minDistance={5}
      maxDistance={14}
      minPolarAngle={Math.PI / 6}
      maxPolarAngle={Math.PI / 2.4}
    />
  )
}

/** 狼人杀馆主场景。 */
function WerewolfScene({ snapshot }: { snapshot: WerewolfPlayerSnapshot | null }) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () =>
    (snapshot?.players ?? [])
      .map((p) => (p.celebrityId ? getCelebrity(p.celebrityId)?.model : undefined))
      .filter((m): m is string => Boolean(m)),
  )
  const night = snapshot?.phase === 'night'
  const players = snapshot?.players ?? []
  const myRole = snapshot?.myRole
  const wolfTeammates = useMemo(() => new Set(snapshot?.wolfTeammates ?? []), [snapshot?.wolfTeammates])

  return (
    <group ref={sceneRef}>
      <color attach="background" args={[night ? '#03040a' : '#0a0806']} />

      <RoomLights night={night} />

      <Environment resolution={128}>
        <Lightformer intensity={night ? 0.3 : 1.2} color={night ? '#334488' : '#ffd090'} position={[0, 5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[10, 6, 1]} />
        <Lightformer intensity={0.2} color={night ? '#222244' : '#443322'} position={[0, 2, -5]} scale={[12, 3, 1]} />
        <Lightformer intensity={0.15} color={night ? '#222244' : '#332211'} position={[-6, 2, 0]} rotation={[0, Math.PI / 2, 0]} scale={[6, 3, 1]} />
        <Lightformer intensity={0.15} color={night ? '#222244' : '#332211'} position={[6, 2, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 3, 1]} />
      </Environment>

      {/* 地面：深色木纹 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#120e0a" roughness={1} />
      </mesh>

      {/* 中央圆桌 */}
      <mesh position={[0, 0.38, 0]} castShadow receiveShadow>
        <cylinderGeometry args={[TABLE_RADIUS, TABLE_RADIUS, 0.76, 48]} />
        <meshStandardMaterial color="#1a120a" roughness={0.7} />
      </mesh>
      {/* 桌面边缘装饰线 */}
      <mesh position={[0, 0.77, 0]}>
        <torusGeometry args={[TABLE_RADIUS, 0.03, 8, 48]} />
        <meshStandardMaterial color={night ? '#3a2222' : '#5a3a1a'} emissive={night ? '#5a1111' : '#3a2200'} emissiveIntensity={0.5} />
      </mesh>
      {/* 桌中央蜡烛/灯 */}
      <mesh position={[0, 0.82, 0]}>
        <cylinderGeometry args={[0.06, 0.06, 0.3, 12]} />
        <meshStandardMaterial color="#f5e6c0" emissive="#ffaa44" emissiveIntensity={night ? 1.2 : 0.4} />
      </mesh>

      {/* 圆形墙面 */}
      <mesh position={[0, 2.5, 0]}>
        <cylinderGeometry args={[6.5, 6.5, 5, 48, 1, true]} />
        <meshStandardMaterial color="#0d0a08" roughness={1} side={DoubleSide} />
      </mesh>

      {/* 背景霓虹字 */}
      <Text
        position={[0, 3.2, -6.4]}
        fontSize={0.55}
        color={RED_NEON}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.03}
        outlineColor="#660000"
      >
        WEREWOLF
      </Text>
      <Text
        position={[0, 2.55, -6.4]}
        fontSize={0.28}
        color="#cc3344"
        anchorX="center"
        anchorY="middle"
      >
        狼人杀馆
      </Text>

      {/* 9 个座位 */}
      {players.map((p) => (
        <SeatGroup
          key={p.seat}
          player={p}
          seat={p.seat}
          isSpeaker={snapshot?.currentSpeakerSeat === p.seat}
          isWolfTeammate={wolfTeammates.has(p.seat)}
          myRole={myRole}
        />
      ))}

      <CameraRig />
    </group>
  )
}

/**
 * 狼人杀馆 3D 场景视图。按需懒加载。
 */
export default function WerewolfView({ snapshot }: { snapshot: WerewolfPlayerSnapshot | null }) {
  return (
    <SafeCanvas shadows camera={{ position: [0, 6.5, 8.5], fov: 45 }} dpr={[1, 1.5]}>
      <WerewolfScene snapshot={snapshot} />
    </SafeCanvas>
  )
}

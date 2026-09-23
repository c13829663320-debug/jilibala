import { Component, Suspense, useLayoutEffect, useMemo, useRef, type ErrorInfo, type ReactNode } from 'react'
import { useFrame, useThree } from '@react-three/fiber'
import { SafeCanvas } from './SafeCanvas'
import { Environment, Lightformer, OrbitControls, Text, useGLTF } from '@react-three/drei'
import { Box3, DoubleSide, Group, MeshStandardMaterial, Object3D, SpotLight, Vector3 } from 'three'
import type { Celebrity } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'

/** 明黄主题色。 */
const YELLOW = '#4fb3a5'

/** 模型加载失败时不拖垮整个 Canvas。 */
class TalkshowModelErrorBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('Talkshow model failed to load', error, info.componentStack)
  }
  render() { return this.state.failed ? this.props.fallback : this.props.children }
}

/** 全身名人模型按高度归一化到 ~1.7，脚置局部原点（不加 Y180 旋转）。 */
function NormalizedTalkshowModel({ url }: { url: string }) {
  const { scene } = useGLTF(url, false, true)
  const normalized = useMemo(() => {
    const clone = scene.clone(true)
    const bounds = new Box3().setFromObject(clone)
    const size = bounds.getSize(new Vector3())
    const center = bounds.getCenter(new Vector3())
    const scale = 1.7 / Math.max(size.y, 0.001)
    clone.scale.setScalar(scale)
    // 脚落到局部 y=0，居中 x/z。
    clone.position.set(-center.x * scale, -bounds.min.y * scale, -center.z * scale)
    clone.traverse((child) => {
      child.castShadow = true
      child.receiveShadow = true
    })
    return clone
  }, [scene])
  return <primitive object={normalized} />
}

/** 黄色发光站位圈，表演者说话时脉动。 */
function StageSpot({ active }: { active: boolean }) {
  const mat = useRef<MeshStandardMaterial | null>(null)
  useFrame(({ clock }) => {
    if (!mat.current) return
    const t = clock.getElapsedTime()
    mat.current.emissiveIntensity = active ? 2.4 + Math.sin(t * 4) * 1.2 : 0.4
  })
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.012, 0]}>
      <ringGeometry args={[0.55, 0.78, 48]} />
      <meshStandardMaterial
        ref={mat}
        color={active ? YELLOW : '#4a3d00'}
        emissive={active ? YELLOW : '#3a2f00'}
        emissiveIntensity={active ? 2.4 : 0.4}
        transparent
        opacity={active ? 1 : 0.6}
        side={DoubleSide}
      />
    </mesh>
  )
}

/** 舞台聚光灯，打在舞台中央。 */
function StageSpotlight() {
  const light = useMemo(() => {
    return new SpotLight('#fff2c0', 90, 16, Math.PI / 5, 0.5, 1.4)
  }, [])
  const target = useMemo(() => new Object3D(), [])
  useLayoutEffect(() => { light.target = target }, [light, target])
  return (
    <>
      <primitive object={light} position={[0, 5.2, -1.6]} />
      <primitive object={target} position={[0, 0.4, -2.0]} />
    </>
  )
}

/** 麦克风立麦：圆柱立杆 + 顶部球体。 */
function MicStand({ position }: { position: [number, number, number] }) {
  return (
    <group position={position}>
      <mesh castShadow position={[0, 0.75, 0]}>
        <cylinderGeometry args={[0.025, 0.025, 1.5, 12]} />
        <meshStandardMaterial color="#2a2a2a" metalness={0.6} roughness={0.4} />
      </mesh>
      <mesh castShadow position={[0, 1.55, 0]}>
        <sphereGeometry args={[0.09, 16, 16]} />
        <meshStandardMaterial color={YELLOW} emissive={YELLOW} emissiveIntensity={0.6} />
      </mesh>
      <mesh position={[0, 0.02, 0]}>
        <cylinderGeometry args={[0.18, 0.22, 0.04, 16]} />
        <meshStandardMaterial color="#1a1a1a" />
      </mesh>
    </group>
  )
}

/** 模型缺失/失败时的 Q 版占位。 */
function PerformerPlaceholder({ name, active }: { name: string; active: boolean }) {
  return (
    <group>
      <mesh castShadow position={[0, 0.85, 0]}>
        <cylinderGeometry args={[0.24, 0.32, 1.3, 16]} />
        <meshStandardMaterial color={active ? YELLOW : '#4a4a55'} />
      </mesh>
      <mesh castShadow position={[0, 1.75, 0]}>
        <sphereGeometry args={[0.2, 16, 16]} />
        <meshStandardMaterial color={active ? '#fff0a0' : '#6a6a78'} />
      </mesh>
      <Text
        position={[0, 2.1, 0.06]}
        fontSize={0.24}
        color="#fff6d8"
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#3a2a00"
      >
        {name}
      </Text>
    </group>
  )
}

/** 舞台上的表演者（名人模型或占位）。 */
function Performer({ celebrity, position, active }: { celebrity: Celebrity; position: [number, number, number]; active: boolean }) {
  const fallback = <PerformerPlaceholder name={celebrity.name} active={active} />
  return (
    <group position={position}>
      <StageSpot active={active} />
      {celebrity.model ? (
        <TalkshowModelErrorBoundary fallback={fallback}>
          <Suspense fallback={null}>
            <NormalizedTalkshowModel url={celebrity.model} />
          </Suspense>
        </TalkshowModelErrorBoundary>
      ) : fallback}
      <Text
        position={[0, active ? 2.05 : 1.8, 0.06]}
        fontSize={active ? 0.24 : 0.17}
        color={active ? YELLOW : '#f0e8d0'}
        anchorX="center"
        anchorY="middle"
        outlineWidth={active ? 0.026 : 0.012}
        outlineColor={active ? '#7a5a00' : '#111'}
      >
        {active ? `${celebrity.name} · 演出中` : celebrity.name}
      </Text>
    </group>
  )
}

/** 阶梯式观众席：多排深色 box 排列。 */
function AudienceSeats() {
  const rows = useMemo(() => {
    const seats: Array<{ position: [number, number, number]; color: string }> = []
    const rowCount = 4
    const perRow = 9
    for (let r = 0; r < rowCount; r += 1) {
      const z = 0.6 + r * 0.85
      const y = 0.05 + r * 0.28
      for (let c = 0; c < perRow; c += 1) {
        const x = (c - (perRow - 1) / 2) * 0.85
        // 中间留一条过道。
        if (Math.abs(x) < 0.2) continue
        seats.push({ position: [x, y, z], color: r % 2 === 0 ? '#1c1c22' : '#23232b' })
      }
    }
    return seats
  }, [])
  return (
    <group>
      {rows.map((s, i) => (
        <mesh key={i} position={s.position} castShadow receiveShadow>
          <boxGeometry args={[0.62, 0.42, 0.62]} />
          <meshStandardMaterial color={s.color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

/** 相机控制：固定偏观众席视角，限制角度。 */
function CameraRig({ children }: { children?: ReactNode }) {
  const controls = useRef<{ target: Vector3; update: () => void } | null>(null)
  const camera = useThree((s) => s.camera)
  useFrame(() => {
    controls.current?.update()
    // 相机始终停在观众席看向舞台。
    camera.lookAt(0, 1.0, -2.0)
  })
  return (
    <>
      {children}
      <OrbitControls
        ref={controls as never}
        enablePan={false}
        target={[0, 1.0, -2.0]}
        minDistance={3}
        maxDistance={7.5}
        minPolarAngle={Math.PI / 5}
        maxPolarAngle={Math.PI / 2.05}
        minAzimuthAngle={-Math.PI / 6}
        maxAzimuthAngle={Math.PI / 6}
      />
    </>
  )
}

/** 剧场主场景。 */
function Talkshow({ celebrities, activeSpeakerId }: { celebrities: Celebrity[]; activeSpeakerId: string | null }) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef, () =>
    celebrities.map((c) => c.model).filter((m): m is string => Boolean(m)),
  )
  // 同屏最多 3 位名人，排成一行。
  const cast = celebrities.slice(0, 3)
  const stageTopY = 0.4
  const positions: Array<[number, number, number]> = cast.map((_, i) => {
    const offset = (i - (cast.length - 1) / 2) * 1.6
    return [offset, stageTopY, -2.0]
  })
  const audienceLights: Array<[number, number, number]> = [
    [-3.2, 2.6, 0.8], [3.2, 2.6, 0.8], [0, 2.8, 1.6],
  ]

  return (
    <group ref={sceneRef}>
      <color attach="background" args={['#050505']} />
      {/* 灯光：低强度环境 + 舞台聚光 + 观众席微弱点光。 */}
      <ambientLight intensity={0.25} color="#ffe6a8" />
      <StageSpotlight />
      {audienceLights.map((p, i) => (
        <pointLight key={`aud-${i}`} position={p} intensity={3} distance={6} decay={2} color="#554422" />
      ))}

      <Environment resolution={128}>
        <Lightformer intensity={1.6} color={YELLOW} position={[0, 5, -1.5]} rotation={[Math.PI / 2, 0, 0]} scale={[8, 4, 1]} />
        <Lightformer intensity={0.4} color="#444455" position={[0, 2, 3]} scale={[10, 3, 1]} />
        <Lightformer intensity={0.3} color="#665533" position={[-6, 2, 0]} rotation={[0, Math.PI / 2, 0]} scale={[6, 3, 1]} />
        <Lightformer intensity={0.3} color="#665533" position={[6, 2, 0]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 3, 1]} />
      </Environment>

      {/* 地面。 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[30, 30]} />
        <meshStandardMaterial color="#0a0a0c" roughness={1} />
      </mesh>

      {/* 舞台：抬高矩形平台，明黄边缘发光。 */}
      <mesh position={[0, stageTopY / 2, -2.0]} castShadow receiveShadow>
        <boxGeometry args={[6.4, stageTopY, 3.2]} />
        <meshStandardMaterial color="#141414" roughness={0.8} />
      </mesh>
      {/* 黄色发光前沿。 */}
      <mesh position={[0, stageTopY + 0.01, -0.42]}>
        <boxGeometry args={[6.4, 0.04, 0.08]} />
        <meshStandardMaterial color={YELLOW} emissive={YELLOW} emissiveIntensity={2.2} />
      </mesh>
      {/* 左右边缘发光条。 */}
      <mesh position={[-3.22, stageTopY + 0.01, -2.0]}>
        <boxGeometry args={[0.06, 0.04, 3.2]} />
        <meshStandardMaterial color={YELLOW} emissive={YELLOW} emissiveIntensity={1.6} />
      </mesh>
      <mesh position={[3.22, stageTopY + 0.01, -2.0]}>
        <boxGeometry args={[0.06, 0.04, 3.2]} />
        <meshStandardMaterial color={YELLOW} emissive={YELLOW} emissiveIntensity={1.6} />
      </mesh>

      {/* 麦克风立麦。 */}
      <MicStand position={[0.9, stageTopY, -2.0]} />

      {/* 背景墙：纯黑 + OPEN MIC 霓虹字。 */}
      <mesh position={[0, 1.8, -3.7]}>
        <planeGeometry args={[9, 3.6]} />
        <meshStandardMaterial color="#000000" roughness={1} side={DoubleSide} />
      </mesh>
      <Text
        position={[0, 2.1, -3.65]}
        fontSize={0.62}
        color={YELLOW}
        anchorX="center"
        anchorY="middle"
        outlineWidth={0.02}
        outlineColor="#aa8800"
      >
        OPEN MIC
      </Text>
      <Text
        position={[0, 1.35, -3.65]}
        fontSize={0.2}
        color="#888055"
        anchorX="center"
        anchorY="middle"
      >
        叽里呱啦 · 脱口秀剧场
      </Text>

      {/* 观众席。 */}
      <AudienceSeats />

      {/* 舞台上的表演者。 */}
      {cast.map((c, i) => (
        <Performer key={c.id} celebrity={c} position={positions[i]} active={c.id === activeSpeakerId} />
      ))}

      <CameraRig />
    </group>
  )
}

/**
 * 完整 3D 脱口秀剧场视图（Canvas + 场景）。按需懒加载，进入剧场才下载 three/r3f。
 */
export default function TalkshowView({
  celebrities,
  activeSpeakerId,
}: {
  celebrities: Celebrity[]
  activeSpeakerId: string | null
}) {
  return (
    <SafeCanvas shadows camera={{ position: [0, 1.9, 5.6], fov: 45 }} dpr={[1, 2]}>
      <Talkshow celebrities={celebrities} activeSpeakerId={activeSpeakerId} />
    </SafeCanvas>
  )
}

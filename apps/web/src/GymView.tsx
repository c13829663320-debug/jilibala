// M11: 健身房 3D 场景 — 纯程序化低模
// 明亮运动风室内健身房：drei 基础几何体拼接器械，不加载外部模型 / 外部 HDR。
// 灯光复用内联 Environment + Lightformer（参考 LibraryView）。
import { useRef, useState, type ReactNode } from 'react'
import { Canvas, useFrame, type ThreeEvent } from '@react-three/fiber'
import { Billboard, Environment, Lightformer, OrbitControls, Text } from '@react-three/drei'
import { Color, DoubleSide, Group, MeshStandardMaterial, type Group as TGroup } from 'three'
import type { GymEquipmentId } from '@balabala/shared'
import { useSceneCleanup } from './useSceneCleanup'

// ===== 对外类型 =====
export type GymPlayer = {
  userId: string
  nickname: string
  x: number
  z: number
  rotation: number
  activity?: string
}

export type GymCheer = {
  id: string
  text: string
  nickname: string
  born: number
}

// 器械元数据：位置 / 朝向 / 标签
type EquipmentPlacement = {
  id: GymEquipmentId
  label: string
  position: [number, number, number]
  rotationY: number
}

const EQUIPMENT_LAYOUT: EquipmentPlacement[] = [
  { id: 'treadmill', label: '跑步机', position: [-4.2, 0, -3.6], rotationY: 0 },
  { id: 'dumbbell', label: '哑铃架', position: [0, 0, -4.6], rotationY: 0 },
  { id: 'bench_press', label: '杠铃卧推', position: [4.2, 0, -3.6], rotationY: Math.PI / 2 },
  { id: 'rowing', label: '划船机', position: [-4.6, 0, 1.6], rotationY: Math.PI / 2 },
  { id: 'bike', label: '动感单车', position: [-1.6, 0, 2.4], rotationY: 0 },
  { id: 'yoga_mat', label: '瑜伽垫', position: [3.8, 0, 1.8], rotationY: -Math.PI / 10 },
]

const EQUIPMENT_META: Record<GymEquipmentId, { emoji: string; name: string }> = {
  treadmill: { emoji: '🏃', name: '跑步机' },
  dumbbell: { emoji: '🏋️', name: '哑铃架' },
  bench_press: { emoji: '🛏️', name: '杠铃卧推' },
  yoga_mat: { emoji: '🧘', name: '瑜伽垫' },
  rowing: { emoji: '🚣', name: '划船机' },
  bike: { emoji: '🚴', name: '动感单车' },
}

// ===== 可点击器械容器：悬停高亮 + 点击回调 =====
function ClickableEquipment({
  id,
  label,
  position,
  rotationY,
  onSelect,
  children,
}: {
  id: GymEquipmentId
  label: string
  position: [number, number, number]
  rotationY: number
  onSelect: (id: GymEquipmentId) => void
  children: ReactNode
}) {
  const [hovered, setHovered] = useState(false)
  const ringMat = useRef<MeshStandardMaterial | null>(null)

  useFrame(({ clock }) => {
    if (!ringMat.current) return
    const t = clock.getElapsedTime()
    ringMat.current.emissiveIntensity = hovered ? 1.4 + Math.sin(t * 6) * 0.4 : 0.25
  })

  return (
    <group position={position} rotation={[0, rotationY, 0]}>
      <group
        onClick={(e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); onSelect(id) }}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); setHovered(true) }}
        onPointerOut={() => setHovered(false)}
      >
        {children}
      </group>
      {/* 脚下高亮环 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0.4]}>
        <ringGeometry args={[0.55, 0.75, 32]} />
        <meshStandardMaterial
          ref={ringMat}
          color={hovered ? '#ffd23f' : '#3a4a3a'}
          emissive={hovered ? '#ffd23f' : '#223322'}
          emissiveIntensity={hovered ? 1.4 : 0.25}
          transparent
          opacity={hovered ? 1 : 0.55}
          side={DoubleSide}
        />
      </mesh>
      {/* 名牌 */}
      <Billboard position={[0, 1.9, 0.4]}>
        <Text fontSize={0.2} color={hovered ? '#ffd23f' : '#ffffff'} anchorX="center" anchorY="middle"
          outlineWidth={0.012} outlineColor="#0a1a12" raycast={() => null}>
          {`${EQUIPMENT_META[id].emoji} ${label}`}
        </Text>
      </Billboard>
    </group>
  )
}

// ===== 各器械低模拼装 =====
function Treadmill() {
  return (
    <group>
      {/* 底座 + 跑带 */}
      <mesh castShadow position={[0, 0.06, 0.5]}>
        <boxGeometry args={[1.1, 0.12, 2.6]} />
        <meshStandardMaterial color="#222831" roughness={0.6} metalness={0.2} />
      </mesh>
      <mesh position={[0, 0.13, 0.5]}>
        <boxGeometry args={[0.9, 0.02, 2.3]} />
        <meshStandardMaterial color="#0d1117" roughness={0.95} />
      </mesh>
      {/* 两端滚轮 */}
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0.13, -0.75]}>
        <cylinderGeometry args={[0.08, 0.08, 0.9, 12]} />
        <meshStandardMaterial color="#3a4a5a" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* 扶手立柱 + 横把 */}
      {[-0.42, 0.42].map((x, i) => (
        <mesh key={i} position={[x, 0.7, -0.55]}>
          <cylinderGeometry args={[0.03, 0.03, 1.1, 8]} />
          <meshStandardMaterial color="#5a6a7a" metalness={0.6} roughness={0.35} />
        </mesh>
      ))}
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 1.2, -0.55]}>
        <cylinderGeometry args={[0.035, 0.035, 0.84, 8]} />
        <meshStandardMaterial color="#5a6a7a" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 仪表盘 */}
      <mesh castShadow position={[0, 1.15, -0.78]} rotation={[-0.25, 0, 0]}>
        <boxGeometry args={[0.7, 0.32, 0.08]} />
        <meshStandardMaterial color="#2a3542" roughness={0.5} />
      </mesh>
      <mesh position={[0, 1.16, -0.83]} rotation={[-0.25, 0, 0]}>
        <planeGeometry args={[0.55, 0.2]} />
        <meshStandardMaterial color="#7fd4ff" emissive="#3fa9ff" emissiveIntensity={1.2} />
      </mesh>
    </group>
  )
}

function DumbbellRack() {
  const shelfY = [0.35, 0.85, 1.35]
  const dumbbellsPerShelf = 4
  return (
    <group>
      {/* 两侧立柱 */}
      {[-1.3, 1.3].map((x, i) => (
        <mesh key={i} castShadow position={[x, 0.75, 0]}>
          <boxGeometry args={[0.08, 1.5, 0.35]} />
          <meshStandardMaterial color="#3a4550" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {/* 三层搁板 */}
      {shelfY.map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <boxGeometry args={[2.7, 0.05, 0.35]} />
          <meshStandardMaterial color="#4a5560" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {/* 每层若干哑铃 */}
      {shelfY.map((y, si) =>
        Array.from({ length: dumbbellsPerShelf }).map((_, di) => {
          const x = -1.0 + di * 0.62
          const plateR = 0.09 + (di % 2) * 0.02
          return (
            <group key={`${si}-${di}`} position={[x, y + 0.06, 0]}>
              {/* 握杆 */}
              <mesh rotation={[0, 0, Math.PI / 2]}>
                <cylinderGeometry args={[0.025, 0.025, 0.5, 8]} />
                <meshStandardMaterial color="#c0c8d0" metalness={0.8} roughness={0.25} />
              </mesh>
              {[-0.28, 0.28].map((px, pi) => (
                <mesh key={pi} rotation={[0, 0, Math.PI / 2]} position={[px, 0, 0]}>
                  <cylinderGeometry args={[plateR, plateR, 0.12, 12]} />
                  <meshStandardMaterial color={si === 2 ? '#e05555' : '#2a3038'} metalness={0.6} roughness={0.4} />
                </mesh>
              ))}
            </group>
          )
        }),
      )}
    </group>
  )
}

function BenchPress() {
  return (
    <group>
      {/* 平凳 */}
      <mesh castShadow position={[0, 0.55, 0]}>
        <boxGeometry args={[0.6, 0.12, 1.6]} />
        <meshStandardMaterial color="#2e7d6b" roughness={0.7} />
      </mesh>
      {/* 凳腿 */}
      {[[-0.25, -0.6], [0.25, -0.6], [-0.25, 0.6], [0.25, 0.6]].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.27, z]}>
          <boxGeometry args={[0.06, 0.54, 0.06]} />
          <meshStandardMaterial color="#3a4550" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {/* 杠铃架（两侧立柱） */}
      {[-0.45, 0.45].map((x, i) => (
        <mesh key={i} castShadow position={[x, 0.85, -0.85]}>
          <boxGeometry args={[0.08, 1.2, 0.08]} />
          <meshStandardMaterial color="#3a4550" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
      {/* 杠铃杆 */}
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 1.35, -0.85]}>
        <cylinderGeometry args={[0.03, 0.03, 1.8, 12]} />
        <meshStandardMaterial color="#c8d0d8" metalness={0.85} roughness={0.2} />
      </mesh>
      {/* 杠铃片 */}
      {[-0.78, 0.78].map((x, i) => (
        <mesh key={i} rotation={[0, 0, Math.PI / 2]} position={[x, 1.35, -0.85]}>
          <cylinderGeometry args={[0.22, 0.22, 0.08, 16]} />
          <meshStandardMaterial color="#e05555" metalness={0.5} roughness={0.4} />
        </mesh>
      ))}
    </group>
  )
}

function YogaMat() {
  return (
    <group>
      <mesh receiveShadow position={[0, 0.015, 0]}>
        <boxGeometry args={[1.4, 0.03, 2.1]} />
        <meshStandardMaterial color="#6a5ae0" roughness={0.85} />
      </mesh>
      {/* 边缘装饰线 */}
      <mesh position={[0, 0.032, 0]}>
        <boxGeometry args={[1.25, 0.005, 1.95]} />
        <meshStandardMaterial color="#8a7aff" roughness={0.8} />
      </mesh>
    </group>
  )
}

function RowingMachine() {
  return (
    <group>
      {/* 滑轨 */}
      <mesh castShadow position={[0, 0.12, 0.2]}>
        <boxGeometry args={[0.18, 0.08, 2.2]} />
        <meshStandardMaterial color="#3a4550" metalness={0.5} roughness={0.4} />
      </mesh>
      {/* 飞轮箱 */}
      <mesh castShadow position={[0, 0.35, -0.95]}>
        <boxGeometry args={[0.5, 0.5, 0.6]} />
        <meshStandardMaterial color="#2a6a8a" roughness={0.6} />
      </mesh>
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0.35, -0.62]}>
        <cylinderGeometry args={[0.22, 0.22, 0.04, 16]} />
        <meshStandardMaterial color="#5a8aaa" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 座椅 */}
      <mesh castShadow position={[0, 0.25, 0.5]}>
        <boxGeometry args={[0.4, 0.1, 0.35]} />
        <meshStandardMaterial color="#e05555" roughness={0.7} />
      </mesh>
      {/* 脚踏 */}
      <mesh position={[0, 0.1, -0.55]}>
        <boxGeometry args={[0.5, 0.05, 0.2]} />
        <meshStandardMaterial color="#222831" roughness={0.8} />
      </mesh>
    </group>
  )
}

function ExerciseBike() {
  return (
    <group>
      {/* 主车架 */}
      <mesh castShadow position={[0, 0.5, 0]}>
        <boxGeometry args={[0.12, 0.9, 0.12]} />
        <meshStandardMaterial color="#2a8a6a" roughness={0.5} metalness={0.4} />
      </mesh>
      {/* 底座 */}
      <mesh castShadow position={[0, 0.08, 0.2]}>
        <boxGeometry args={[0.7, 0.1, 1.4]} />
        <meshStandardMaterial color="#222831" roughness={0.7} />
      </mesh>
      {/* 飞轮 */}
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 0.45, 0.55]}>
        <cylinderGeometry args={[0.32, 0.32, 0.12, 24]} />
        <meshStandardMaterial color="#3a4550" metalness={0.6} roughness={0.35} />
      </mesh>
      {/* 坐垫 */}
      <mesh castShadow position={[0, 1.0, -0.35]}>
        <boxGeometry args={[0.35, 0.08, 0.25]} />
        <meshStandardMaterial color="#e05555" roughness={0.7} />
      </mesh>
      {/* 车把 */}
      <mesh rotation={[0, 0, Math.PI / 2]} position={[0, 1.05, 0.35]}>
        <cylinderGeometry args={[0.025, 0.025, 0.6, 8]} />
        <meshStandardMaterial color="#3a4550" metalness={0.6} roughness={0.35} />
      </mesh>
      <mesh position={[0, 1.18, 0.35]}>
        <cylinderGeometry args={[0.03, 0.03, 0.3, 8]} />
        <meshStandardMaterial color="#2a8a6a" roughness={0.5} />
      </mesh>
    </group>
  )
}

// ===== 其他玩家化身：胶囊体 + 名牌 =====
function GymAvatar({ player }: { player: GymPlayer }) {
  const groupRef = useRef<TGroup>(null)
  const matColor = useRef(new Color(hashHue(player.userId)))
  useFrame(() => {
    if (!groupRef.current) return
    groupRef.current.position.x = lerp(groupRef.current.position.x, player.x, 0.15)
    groupRef.current.position.z = lerp(groupRef.current.position.z, player.z, 0.15)
    groupRef.current.rotation.y = player.rotation
  })
  return (
    <group ref={groupRef} position={[player.x, 0, player.z]}>
      <mesh position={[0, 0.55, 0]} castShadow>
        <capsuleGeometry args={[0.22, 0.55, 6, 14]} />
        <meshStandardMaterial color={matColor.current} roughness={0.45} />
      </mesh>
      <Billboard position={[0, 1.45, 0]}>
        <Text fontSize={0.22} color="#ffffff" anchorX="center" anchorY="middle" outlineWidth={0.014} outlineColor="#000" raycast={() => null}>
          {player.activity ? `${player.nickname} · ${player.activity}` : player.nickname}
        </Text>
      </Billboard>
    </group>
  )
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}
function hashHue(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) | 0
  return `hsl(${Math.abs(h) % 360}, 60%, 55%)`
}

// ===== 飘字加油 =====
function CheerFloater({ cheer }: { cheer: GymCheer }) {
  const groupRef = useRef<TGroup>(null)
  useFrame(({ clock }) => {
    if (!groupRef.current) return
    const age = clock.getElapsedTime() - cheer.born / 1000
    const t = Math.min(age / 3, 1)
    groupRef.current.position.y = 1.6 + t * 1.4
    const m = groupRef.current.children[0] as unknown as { material?: { opacity: number } }
    if (m?.material) m.material.opacity = 1 - t
  })
  return (
    <group ref={groupRef} position={[0, 1.6, 0]}>
      <Billboard>
        <Text fontSize={0.26} color="#ffd23f" anchorX="center" anchorY="middle"
          outlineWidth={0.02} outlineColor="#7a4a00" raycast={() => null}>
          {`${cheer.nickname}：${cheer.text}`}
        </Text>
      </Billboard>
    </group>
  )
}

// ===== 场景根 =====
function GymScene({
  onSelect,
  players,
  cheers,
}: {
  onSelect: (id: GymEquipmentId) => void
  players: GymPlayer[]
  cheers: GymCheer[]
}) {
  const sceneRef = useRef<Group>(null)
  useSceneCleanup(sceneRef)

  return (
    <group ref={sceneRef}>
      <color attach="background" args={['#0e1512']} />
      {/* 明亮运动风：冷白环境光 + 顶部主光 */}
      <ambientLight intensity={0.55} color="#eaf4ff" />
      <Environment resolution={128}>
        <Lightformer intensity={1.4} color="#ffffff" position={[0, 6, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[14, 14, 1]} />
        <Lightformer intensity={0.7} color="#dff0ff" position={[0, 2, 6]} scale={[10, 3, 1]} />
        <Lightformer intensity={0.4} color="#ffe9b8" position={[-6, 2, -3]} rotation={[0, Math.PI / 2, 0]} scale={[6, 3, 1]} />
        <Lightformer intensity={0.4} color="#ffe9b8" position={[6, 2, -3]} rotation={[0, -Math.PI / 2, 0]} scale={[6, 3, 1]} />
      </Environment>

      {/* 地面：分色区域 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[16, 14]} />
        <meshStandardMaterial color="#2b3a33" roughness={0.85} />
      </mesh>
      {/* 跑道区（跑步机下方）暖色 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-4.2, 0.005, -2.6]}>
        <planeGeometry args={[3.2, 3.2]} />
        <meshStandardMaterial color="#5a6e55" roughness={0.9} />
      </mesh>
      {/* 力量区 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[2, 0.005, -3.6]}>
        <planeGeometry args={[5.5, 2.6]} />
        <meshStandardMaterial color="#6e5a4a" roughness={0.9} />
      </mesh>
      {/* 拉伸区 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[3.8, 0.005, 1.8]}>
        <planeGeometry args={[3.4, 3.4]} />
        <meshStandardMaterial color="#4a5a7a" roughness={0.9} />
      </mesh>
      {/* 有氧区 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-3.2, 0.005, 2]}>
        <planeGeometry args={[4, 3.2]} />
        <meshStandardMaterial color="#5a4a6e" roughness={0.9} />
      </mesh>

      {/* 后墙 + 镜墙（高 metalness 模拟反射） */}
      <mesh position={[0, 1.75, -6.9]}>
        <planeGeometry args={[16, 3.5]} />
        <meshStandardMaterial color="#1d2a24" roughness={0.85} />
      </mesh>
      {/* 镜子墙：左侧高反射 */}
      <mesh position={[-7.4, 1.75, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[13, 3.5]} />
        <meshStandardMaterial color="#cfe8ff" metalness={1} roughness={0.04} envMapIntensity={1.6} />
      </mesh>
      {/* 右侧墙 */}
      <mesh position={[7.4, 1.75, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[13, 3.5]} />
        <meshStandardMaterial color="#1d2a24" roughness={0.85} />
      </mesh>

      {/* 天花板灯带 */}
      {[-3.5, 0, 3.5].map((x, i) => (
        <mesh key={i} position={[x, 3.45, 0]} rotation={[Math.PI / 2, 0, 0]}>
          <planeGeometry args={[2.6, 0.4]} />
          <meshStandardMaterial color="#ffffff" emissive="#eaf6ff" emissiveIntensity={2.2} side={DoubleSide} />
        </mesh>
      ))}

      {/* 器械 */}
      {EQUIPMENT_LAYOUT.map((e) => (
        <ClickableEquipment key={e.id} id={e.id} label={e.label} position={e.position} rotationY={e.rotationY} onSelect={onSelect}>
          {e.id === 'treadmill' && <Treadmill />}
          {e.id === 'dumbbell' && <DumbbellRack />}
          {e.id === 'bench_press' && <BenchPress />}
          {e.id === 'yoga_mat' && <YogaMat />}
          {e.id === 'rowing' && <RowingMachine />}
          {e.id === 'bike' && <ExerciseBike />}
        </ClickableEquipment>
      ))}

      {/* 其他玩家 */}
      {players.map((p) => (
        <GymAvatar key={p.userId} player={p} />
      ))}

      {/* 飘字加油 */}
      {cheers.map((c) => (
        <CheerFloater key={c.id} cheer={c} />
      ))}

      {/* 顶部提示字 */}
      <Text position={[0, 3.3, -6.85]} fontSize={0.22} color="#7fa890" anchorX="center" anchorY="middle" letterSpacing={0.4}>
        GYM · 汗水不骗人
      </Text>

      <OrbitControls
        enablePan={false}
        target={[0, 1, -0.5]}
        minDistance={4}
        maxDistance={11}
        maxPolarAngle={Math.PI / 2.05}
        minPolarAngle={Math.PI / 7}
      />
    </group>
  )
}

export default function GymView({
  onSelect,
  players,
  cheers,
}: {
  onSelect: (id: GymEquipmentId) => void
  players: GymPlayer[]
  cheers: GymCheer[]
}) {
  return (
    <Canvas shadows camera={{ position: [0, 4.2, 7.5], fov: 48 }} dpr={[1, 2]}>
      <GymScene onSelect={onSelect} players={players} cheers={cheers} />
    </Canvas>
  )
}

/**
 * 狼人杀馆 · 3D 室内场景
 * ------------------------------------------------------------------
 * 主题：暗紫 + 月光。中央圆桌（狼人杀经典围坐布局）+ 环形座椅 +
 * 天窗月光光柱 + 桌上蜡烛 + 神秘学书柜 + 月亮/狼头墙饰。
 *
 * 布局（房间 width=12 / depth=11 / height=5.5）：
 *   - 圆桌居中 (0,0)，直径 ~4.4，桌面深色、边缘紫色发光
 *   - 9 把椅子 instancedMesh 环形排列（半径 3.1，朝向圆心）
 *   - 天窗在天花板正上方，蓝白发光平面 + 半透明体积光柱
 *   - 4 盏蜡烛在桌上（emissive 暖色，不占点光源预算）
 *   - 左右两侧靠墙书柜（instanced 柜身 + instanced 书籍）
 *   - 后墙挂月亮图案 + 狼头剪影（emissive 平面）
 *   - 圆形暗紫地毯铺在桌下
 *
 * 性能：
 *   - 家具 draw call ≈ 10（instanced 合并椅子/蜡烛/书柜/书籍）
 *   - 点光源：InteriorShell 自带 3 盏 + 本场景月光 1 盏 = 4（达预算上限）
 *   - 蜡烛只用 emissive，不额外开 pointLight
 *
 * 收集品（由 InteriorScene → CollectibleLayer 自动渲染）：
 *   - werewolf_table       (0, 1.2, 0)  圆桌中央
 *   - werewolf_seat_1      (-3, 1, -2)  座椅旁
 *   - werewolf_hidden_attic (3, 3.5, 3) 高处（抬头可见）
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import { useFrame } from '@react-three/fiber'
import InteriorScene from './InteriorScene'
import type { InteriorCollider } from './InteriorShell'
import { BUILDING_THEME } from '../art-spec'

// ---------- 房间常量 ----------
const ROOM_W = 12
const ROOM_D = 11
const ROOM_H = 5.5

const theme = BUILDING_THEME.werewolf

// ---------- 家具碰撞体（AABB 数据，供共享层合并到 InteriorPlayer） ----------
/**
 * 圆桌、书柜、座椅区域的 AABB 碰撞体。
 * 说明：当前 InteriorScene 内部只注入墙体碰撞体，本数组作为分片声明导出，
 * 待共享 InteriorScene 支持 furnitureColliders 注入后即可合并生效。
 */
export const WEREWOLF_FURNITURE_COLLIDERS: InteriorCollider[] = [
  // 中央圆桌（直径 ~4.4）
  { kind: 'aabb', box: { minX: -2.3, maxX: 2.3, minZ: -2.3, maxZ: 2.3 } },
  // 左侧书柜（靠墙）
  { kind: 'aabb', box: { minX: -6.0, maxX: -5.0, minZ: -2.5, maxZ: 0.5 } },
  // 右侧书柜（靠墙）
  { kind: 'aabb', box: { minX: 5.0, maxX: 6.0, minZ: -2.5, maxZ: 0.5 } },
  // 座椅环（4 个对角/方位椅位的 keep-out 盒）
  { kind: 'aabb', box: { minX: -0.7, maxX: 0.7, minZ: 2.5, maxZ: 3.7 } },   // 北
  { kind: 'aabb', box: { minX: -0.7, maxX: 0.7, minZ: -3.7, maxZ: -2.5 } }, // 南
  { kind: 'aabb', box: { minX: 2.5, maxX: 3.7, minZ: -0.7, maxZ: 0.7 } },  // 东
  { kind: 'aabb', box: { minX: -3.7, maxX: -2.5, minZ: -0.7, maxZ: 0.7 } },// 西
]

// ---------- 环形布局工具 ----------
const CHAIR_COUNT = 9
const CHAIR_RING_R = 3.1
const CANDLE_COUNT = 4

/** 计算第 i 把椅子在环上的位置（朝向圆心） */
function chairTransform(i: number, out: THREE.Object3D) {
  const a = (i / CHAIR_COUNT) * Math.PI * 2
  out.position.set(Math.cos(a) * CHAIR_RING_R, 0, Math.sin(a) * CHAIR_RING_R)
  // 椅子面朝圆桌中心
  out.lookAt(0, 0, 0)
  out.updateMatrix()
}

/** 计算第 i 根蜡烛在桌上的位置 */
function candleTransform(i: number, out: THREE.Object3D) {
  const a = (i / CANDLE_COUNT) * Math.PI * 2 + Math.PI / 4
  out.position.set(Math.cos(a) * 1.2, 1.16, Math.sin(a) * 1.2)
  out.updateMatrix()
}

// ---------- 狼人杀专属家具 ----------
function WerewolfFurniture() {
  const chairSeatRef = useRef<THREE.InstancedMesh>(null)
  const chairBackRef = useRef<THREE.InstancedMesh>(null)
  const candleRef = useRef<THREE.InstancedMesh>(null)
  const shelfRef = useRef<THREE.InstancedMesh>(null)
  const bookRef = useRef<THREE.InstancedMesh>(null)
  const moonMatRef = useRef<THREE.MeshStandardMaterial>(null)

  // 椅子实例：座位 + 靠背
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    for (let i = 0; i < CHAIR_COUNT; i++) {
      chairTransform(i, dummy)
      // 座位
      dummy.position.y = 0.45
      dummy.updateMatrix()
      chairSeatRef.current?.setMatrixAt(i, dummy.matrix)
      // 靠背（沿 -Z 局部方向后移 0.25，抬高）
      const a = (i / CHAIR_COUNT) * Math.PI * 2
      dummy.position.set(Math.cos(a) * (CHAIR_RING_R - 0.28), 0.85, Math.sin(a) * (CHAIR_RING_R - 0.28))
      dummy.lookAt(Math.cos(a) * CHAIR_RING_R, 0.85, Math.sin(a) * CHAIR_RING_R)
      dummy.updateMatrix()
      chairBackRef.current?.setMatrixAt(i, dummy.matrix)
    }
    if (chairSeatRef.current) chairSeatRef.current.instanceMatrix.needsUpdate = true
    if (chairBackRef.current) chairBackRef.current.instanceMatrix.needsUpdate = true
  }, [])

  // 蜡烛实例
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    for (let i = 0; i < CANDLE_COUNT; i++) {
      candleTransform(i, dummy)
      candleRef.current?.setMatrixAt(i, dummy.matrix)
    }
    if (candleRef.current) candleRef.current.instanceMatrix.needsUpdate = true
  }, [])

  // 书柜实例（左右两个）
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    dummy.position.set(-5.6, 1.5, -1.0)
    dummy.updateMatrix()
    shelfRef.current?.setMatrixAt(0, dummy.matrix)
    dummy.position.set(5.6, 1.5, -1.0)
    dummy.updateMatrix()
    shelfRef.current?.setMatrixAt(1, dummy.matrix)
    if (shelfRef.current) shelfRef.current.instanceMatrix.needsUpdate = true
  }, [])

  // 书籍实例（两书柜 × 两层 × 若干本，instanced 合并为 1 draw call）
  const bookMatrices = useMemo(() => {
    const arr: { x: number; y: number; z: number; rot: number; h: number }[] = []
    const shelves = [
      { cx: -5.6, side: 1 },  // 左书柜，朝 +X 开
      { cx: 5.6, side: -1 },  // 右书柜，朝 -X 开
    ]
    const levels = [1.0, 2.0]
    for (const s of shelves) {
      for (const ly of levels) {
        for (let k = 0; k < 8; k++) {
          arr.push({
            x: s.cx + s.side * 0.18,
            y: ly + 0.18,
            z: -2.0 + k * 0.26,
            rot: 0,
            h: 0.28 + ((k * 7 + ly) % 3) * 0.05,
          })
        }
      }
    }
    return arr
  }, [])
  useLayoutEffect(() => {
    const dummy = new THREE.Object3D()
    bookMatrices.forEach((b, i) => {
      dummy.position.set(b.x, b.y, b.z)
      dummy.scale.set(1, b.h / 0.3, 1)
      dummy.rotation.set(0, 0, 0)
      dummy.updateMatrix()
      bookRef.current?.setMatrixAt(i, dummy.matrix)
    })
    if (bookRef.current) bookRef.current.instanceMatrix.needsUpdate = true
  }, [bookMatrices])

  // 月光呼吸感（天窗 + 月亮墙饰 emissive 轻微脉动）
  useFrame((state) => {
    const t = state.clock.elapsedTime
    if (moonMatRef.current) {
      moonMatRef.current.emissiveIntensity = 0.6 + Math.sin(t * 1.2) * 0.15
    }
  })

  return (
    <>
      {/* 月光（第 4 盏点光源，达预算上限）：从天窗向下洒蓝白冷光 */}
      <pointLight
        position={[0, ROOM_H - 0.4, -0.5]}
        color="#b8c8ff"
        intensity={0.7}
        distance={9}
        decay={2}
      />

      {/* 地毯：圆形暗紫，铺桌下 */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 0]} receiveShadow>
        <circleGeometry args={[3.7, 32]} />
        <meshStandardMaterial color="#2a1a3d" roughness={0.95} />
      </mesh>

      {/* 中央圆桌：深色鼓形桌身，顶面 emissive 紫边 */}
      <mesh position={[0, 0.55, 0]} castShadow>
        <cylinderGeometry args={[2.2, 2.0, 1.1, 24]} />
        <meshStandardMaterial
          color="#1a1025"
          emissive={theme.primary}
          emissiveIntensity={0.18}
          roughness={0.6}
        />
      </mesh>
      {/* 桌面边缘紫色发光环（薄 torus） */}
      <mesh position={[0, 1.12, 0]} rotation={[Math.PI / 2, 0, 0]}>
        <torusGeometry args={[2.15, 0.04, 8, 48]} />
        <meshStandardMaterial
          color={theme.primary}
          emissive={theme.primary}
          emissiveIntensity={1.2}
        />
      </mesh>

      {/* 座椅：instanced 座位 + 靠背 */}
      <instancedMesh ref={chairSeatRef} args={[undefined, undefined, CHAIR_COUNT]} castShadow>
        <boxGeometry args={[0.55, 0.08, 0.55]} />
        <meshStandardMaterial color="#3a2a55" roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={chairBackRef} args={[undefined, undefined, CHAIR_COUNT]}>
        <boxGeometry args={[0.55, 0.6, 0.08]} />
        <meshStandardMaterial color="#2a1d40" roughness={0.8} />
      </instancedMesh>

      {/* 蜡烛：instanced 发光烛台（emissive 暖色，不开点光源） */}
      <instancedMesh ref={candleRef} args={[undefined, undefined, CANDLE_COUNT]}>
        <cylinderGeometry args={[0.06, 0.08, 0.22, 8]} />
        <meshStandardMaterial
          color="#fff4e0"
          emissive="#ffb54d"
          emissiveIntensity={1.6}
        />
      </instancedMesh>

      {/* 天窗：天花板上的蓝白发光圆面（模拟月光开口） */}
      <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, ROOM_H - 0.06, 0]}>
        <circleGeometry args={[1.4, 24]} />
        <meshStandardMaterial
          ref={moonMatRef}
          color="#d8e4ff"
          emissive="#cdd8ff"
          emissiveIntensity={0.8}
        />
      </mesh>
      {/* 体积光柱：半透明圆锥从天窗落到桌面 */}
      <mesh position={[0, (ROOM_H + 1.2) / 2, 0]}>
        <cylinderGeometry args={[1.0, 1.9, ROOM_H - 1.2, 16, 1, true]} />
        <meshBasicMaterial
          color="#a8c0ff"
          transparent
          opacity={0.07}
          side={THREE.DoubleSide}
          depthWrite={false}
        />
      </mesh>

      {/* 书柜：instanced 柜身（左右两个） */}
      <instancedMesh ref={shelfRef} args={[undefined, undefined, 2]}>
        <boxGeometry args={[0.5, 3.0, 3.0]} />
        <meshStandardMaterial color="#241638" roughness={0.85} />
      </instancedMesh>
      {/* 书籍：instanced 薄长方体（神秘学书籍，暗紫/暗红/藏青） */}
      <instancedMesh ref={bookRef} args={[undefined, undefined, bookMatrices.length]}>
        <boxGeometry args={[0.16, 0.3, 0.12]} />
        <meshStandardMaterial color="#5b3a7a" roughness={0.7} />
      </instancedMesh>

      {/* 后墙挂饰：月亮图案（emissive 淡紫圆） */}
      <mesh position={[-2.0, 3.2, -5.28]}>
        <circleGeometry args={[0.55, 24]} />
        <meshStandardMaterial
          color={theme.accent}
          emissive={theme.accent}
          emissiveIntensity={0.9}
        />
      </mesh>
      {/* 后墙挂饰：狼头剪影（深色椭圆，嵌在墙上） */}
      <mesh position={[2.0, 3.2, -5.28]}>
        <circleGeometry args={[0.6, 24]} />
        <meshStandardMaterial color="#0d0818" emissive={theme.primary} emissiveIntensity={0.25} />
      </mesh>
    </>
  )
}

// ---------- 默认导出：狼人杀馆室内页面 ----------
interface WerewolfInteriorProps {
  /** 返回广场回调 */
  onExit: () => void
}

export default function WerewolfInterior({ onExit }: WerewolfInteriorProps) {
  return (
    <InteriorScene
      buildingId="werewolf"
      width={ROOM_W}
      depth={ROOM_D}
      height={ROOM_H}
      buildingName="狼人杀"
      onExit={onExit}
    >
      <WerewolfFurniture />
    </InteriorScene>
  )
}

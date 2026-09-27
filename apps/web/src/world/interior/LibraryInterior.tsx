/**
 * 开放世界 · 图书馆室内场景（分片）
 * ------------------------------------------------------------------
 * buildingId="library"  房间 13(X) × 11(Z) × 6(Y)
 * 主题色：#5b8db8（蓝）/ #0e1820（深夜）/ #b8d4e8（浅蓝）
 *
 * 家具全部程序化建模：
 *   - 两侧墙高大书架（instancedMesh 书脊，多色）
 *   - 中央长阅读桌 + 2 盏暖色台灯（发光罩，1 盏共享 pointLight）
 *   - 桌旁 5 把椅子（instanced）
 *   - 一侧装饰性楼梯 / 二层
 *   - 桌上地球仪
 *   - 后墙挂画
 *   - 中央蓝紫色地毯
 *
 * 性能：draw call ≈ 20（≤30），新增 pointLight 1 盏（Shell 自带 3 盏，共 4，≤4）。
 *
 * 收集品（位置见 collectibles.ts）：
 *   - library_desk        (0, 1.2, -2)  阅读桌上（rare）
 *   - library_shelf_l      (-4, 1, 1)    左侧书架旁（common）
 *   - library_hidden_vault (4, 0.5, -4)  右后角落禁书库（hidden）
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import InteriorScene from './InteriorScene'
import type { InteriorCollider } from './InteriorShell'

// ---------- 房间尺寸 ----------
const WIDTH = 13
const DEPTH = 11
const HEIGHT = 6

// ---------- 主题色 ----------
const C = {
  primary: '#5b8db8',
  secondary: '#0e1820',
  accent: '#b8d4e8',
  wood: '#241a12',      // 书架木框（深棕木）
  woodEdge: '#3a2a1c',
  rug: '#2b2a5e',       // 蓝紫地毯
  lampGlow: '#ffd9a0',  // 台灯暖光
} as const

/** 书脊配色（多彩，制造图书馆彩色书脊感） */
const BOOK_COLORS = [
  '#a8323a', '#3a6ea8', '#c9a227', '#4a8a4f', '#8a4a9e',
  '#b8d4e8', '#d98a3a', '#5b8db8', '#7d2e2e', '#2e5a3a',
]

// ---------- 家具碰撞体（纯数据 AABB，XZ 平面） ----------
/**
 * 书架 / 阅读桌 / 楼梯等家具的碰撞体。
 * 与 InteriorScene 的墙碰撞体合并后喂给 InteriorPlayer。
 */
export const LIBRARY_FURNITURE_COLLIDERS: InteriorCollider[] = [
  // 左侧高大书架（贴左墙，z 跨度 -3.5 ~ 1.5）
  { kind: 'aabb', box: { minX: -6.5, maxX: -5.7, minZ: -3.5, maxZ: 1.5 } },
  // 右侧高大书架（贴右墙）
  { kind: 'aabb', box: { minX: 5.7, maxX: 6.5, minZ: -3.5, maxZ: 1.5 } },
  // 中央阅读桌
  { kind: 'aabb', box: { minX: -2.2, maxX: 2.2, minZ: -2.8, maxZ: -1.2 } },
  // 右后角装饰楼梯（不挡角落禁书库 x=4 处）
  { kind: 'aabb', box: { minX: 4.6, maxX: 6.5, minZ: -5.4, maxZ: -3.6 } },
]

// ---------- instanced 小盒子工具 ----------
interface InstanceSpec {
  pos: [number, number, number]
  scale: [number, number, number]
  rotY?: number
  color?: string
}

function InstancedBoxes({ specs, roughness = 0.85 }: { specs: InstanceSpec[]; roughness?: number }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const e = new THREE.Euler()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const color = new THREE.Color()
    specs.forEach((spec, i) => {
      p.set(...spec.pos)
      s.set(...spec.scale)
      e.set(0, spec.rotY ?? 0, 0)
      q.setFromEuler(e)
      m.compose(p, q, s)
      ref.current.setMatrixAt(i, m)
      if (spec.color) {
        color.set(spec.color)
        ref.current.setColorAt(i, color)
      }
    })
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [specs])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, specs.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={roughness} metalness={0.05} />
    </instancedMesh>
  )
}

// ---------- 书架 ----------
/** 两个书架单元的参数：贴墙，深 0.7，长 5（z: -3.5~1.5），高 4.5 */
function useShelfSpecs() {
  return useMemo(() => {
    // 木框板件（背板 + 顶/底 + 两侧 + 4 层隔板），两个单元合并 instanced
    const slats: InstanceSpec[] = []
    // 书脊（小长方体，多色）
    const books: InstanceSpec[] = []

    const units = [
      { cx: -6.15, inward: 1 as const },  // 左单元，书脊朝 +x
      { cx: 6.15, inward: -1 as const },  // 右单元，书脊朝 -x
    ]
    const zStart = -3.4
    const zEnd = 1.4
    const shelfLevels = [0.1, 1.15, 2.2, 3.25] // 每层板顶面高度

    // 确定性伪随机（避免每次渲染抖动）
    let seed = 7
    const rand = () => {
      seed = (seed * 16807) % 2147483647
      return seed / 2147483647
    }

    for (const u of units) {
      // 背板
      slats.push({ pos: [u.cx - u.inward * 0.325, 2.25, -1.0], scale: [0.05, 4.5, 5.0] })
      // 顶板 / 底板
      slats.push({ pos: [u.cx, 4.45, -1.0], scale: [0.7, 0.1, 5.0] })
      slats.push({ pos: [u.cx, 0.05, -1.0], scale: [0.7, 0.1, 5.0] })
      // 两侧立板
      slats.push({ pos: [u.cx, 2.25, zStart - 0.05], scale: [0.7, 4.5, 0.1] })
      slats.push({ pos: [u.cx, 2.25, zEnd + 0.05], scale: [0.7, 4.5, 0.1] })
      // 中间隔板
      for (let l = 1; l < shelfLevels.length; l++) {
        slats.push({ pos: [u.cx, shelfLevels[l] - 0.04, -1.0], scale: [0.6, 0.08, 4.8] })
      }

      // 每一层摆书
      for (let li = 0; li < shelfLevels.length; li++) {
        const baseY = shelfLevels[li] + 0.04 // 书放在隔板顶面
        let z = zStart + 0.05
        while (z < zEnd - 0.15) {
          const bw = 0.12 + rand() * 0.12       // 书宽（Z 方向）
          const bh = 0.55 + rand() * 0.35       // 书高
          const bd = 0.32 + rand() * 0.08       // 书深（X 方向）
          // 书贴着背板，前缘朝室内
          const bx = u.cx - u.inward * (0.35 - bd / 2)
          books.push({
            pos: [bx, baseY + bh / 2, z + bw / 2],
            scale: [bd, bh, bw],
            color: BOOK_COLORS[Math.floor(rand() * BOOK_COLORS.length)],
          })
          z += bw + 0.02
        }
      }
    }
    return { slats, books }
  }, [])
}

function Bookshelves() {
  const { slats, books } = useShelfSpecs()
  return (
    <group>
      {/* 木框板件 */}
      <InstancedBoxes specs={slats} roughness={0.7} />
      {/* 彩色书脊 */}
      <InstancedBooks specs={books} />
    </group>
  )
}

/** 书脊（单独一个 instancedMesh，颜色更鲜艳一点） */
function InstancedBooks({ specs }: { specs: InstanceSpec[] }) {
  const ref = useRef<THREE.InstancedMesh>(null!)
  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const s = new THREE.Vector3()
    const p = new THREE.Vector3()
    const color = new THREE.Color()
    specs.forEach((spec, i) => {
      p.set(...spec.pos); s.set(...spec.scale)
      m.compose(p, q, s)
      ref.current.setMatrixAt(i, m)
      color.set(spec.color ?? '#ffffff')
      ref.current.setColorAt(i, color)
    })
    ref.current.instanceMatrix.needsUpdate = true
    if (ref.current.instanceColor) ref.current.instanceColor.needsUpdate = true
  }, [specs])
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, specs.length]} castShadow>
      <boxGeometry args={[1, 1, 1]} />
      <meshStandardMaterial roughness={0.6} />
    </instancedMesh>
  )
}

// ---------- 阅读桌 + 台灯 + 地球仪 ----------
function ReadingTable() {
  // 桌中心 (0, -2)，桌面 4.2(X) × 1.5(Z)，高 0.74
  const legSpecs: InstanceSpec[] = [
    { pos: [-1.8, 0.37, -2.6], scale: [0.12, 0.74, 0.12] },
    { pos: [1.8, 0.37, -2.6], scale: [0.12, 0.74, 0.12] },
    { pos: [-1.8, 0.37, -1.4], scale: [0.12, 0.74, 0.12] },
    { pos: [1.8, 0.37, -1.4], scale: [0.12, 0.74, 0.12] },
  ]
  // 台灯底座/杆（两盏）
  const lampBase: InstanceSpec[] = [
    { pos: [-1.2, 0.95, -2.0], scale: [0.08, 0.4, 0.08] },
    { pos: [1.2, 0.95, -2.0], scale: [0.08, 0.4, 0.08] },
  ]
  return (
    <group>
      {/* 桌面 */}
      <mesh position={[0, 0.74, -2]} castShadow>
        <boxGeometry args={[4.2, 0.08, 1.5]} />
        <meshStandardMaterial color={C.woodEdge} roughness={0.6} />
      </mesh>
      {/* 桌腿 */}
      <InstancedBoxes specs={legSpecs} roughness={0.7} />
      {/* 台灯杆 + 底座 */}
      <InstancedBoxes specs={lampBase} roughness={0.4} />
      {/* 两盏发光灯罩（暖色 emissive） */}
      <mesh position={[-1.2, 1.2, -2]}>
        <cylinderGeometry args={[0.12, 0.2, 0.18, 12, 1, true]} />
        <meshStandardMaterial color={C.lampGlow} emissive={C.lampGlow} emissiveIntensity={1.4} side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[1.2, 1.2, -2]}>
        <cylinderGeometry args={[0.12, 0.2, 0.18, 12, 1, true]} />
        <meshStandardMaterial color={C.lampGlow} emissive={C.lampGlow} emissiveIntensity={1.4} side={THREE.DoubleSide} />
      </mesh>
      {/* 共享暖色点光（Shell 已有 3 盏 pointLight，此为第 4 盏，达上限） */}
      <pointLight position={[0, 1.6, -2]} color={C.lampGlow} intensity={0.7} distance={6} decay={2} />

      {/* 地球仪（桌上装饰） */}
      <group position={[0.4, 0.78, -2]}>
        <mesh position={[0, 0.04, 0]}>
          <cylinderGeometry args={[0.12, 0.16, 0.08, 12]} />
          <meshStandardMaterial color={C.wood} roughness={0.6} />
        </mesh>
        <mesh position={[0, 0.32, 0]}>
          <sphereGeometry args={[0.26, 16, 12]} />
          <meshStandardMaterial color={C.primary} roughness={0.5} />
        </mesh>
      </group>
    </group>
  )
}

// ---------- 椅子（5 把，instanced） ----------
function Chairs() {
  const { seats, backs } = useMemo(() => {
    // 桌中心 (0,-2)，桌近边 z=-1.25，远边 z=-2.75
    const seats: InstanceSpec[] = []
    const backs: InstanceSpec[] = []
    // 近侧 3 把（z=-0.9，面朝 -z，靠背在 +z）
    for (const x of [-1.2, 0, 1.2]) {
      seats.push({ pos: [x, 0.45, -0.85], scale: [0.45, 0.08, 0.45] })
      backs.push({ pos: [x, 0.78, -0.62], scale: [0.45, 0.55, 0.06] })
    }
    // 远侧 2 把（z=-3.15，面朝 +z，靠背在 -z）
    for (const x of [-1.2, 1.2]) {
      seats.push({ pos: [x, 0.45, -3.15], scale: [0.45, 0.08, 0.45] })
      backs.push({ pos: [x, 0.78, -3.38], scale: [0.45, 0.55, 0.06] })
    }
    return { seats, backs }
  }, [])
  return (
    <group>
      <InstancedBoxes specs={seats} roughness={0.6} />
      <InstancedBoxes specs={backs} roughness={0.6} />
    </group>
  )
}

// ---------- 装饰楼梯（右后角，通往高处，装饰性） ----------
function Stairs() {
  const steps: InstanceSpec[] = useMemo(() => {
    const arr: InstanceSpec[] = []
    // 4 级台阶，沿 -z 方向升高，靠右墙 x≈5.5
    for (let i = 0; i < 4; i++) {
      const h = (i + 1) * 0.4
      arr.push({
        pos: [5.5, h / 2, -3.9 - i * 0.45],
        scale: [1.7, h, 0.45],
      })
    }
    return arr
  }, [])
  return <InstancedBoxes specs={steps} roughness={0.7} />
}

// ---------- 挂画（后墙） ----------
const PAINTINGS = [
  { x: -3.2, y: 2.6, color: C.primary },
  { x: 0, y: 2.8, color: '#c9a227' },
  { x: 3.2, y: 2.6, color: C.accent },
]
function Paintings() {
  return (
    <group>
      {PAINTINGS.map((p, i) => (
        <mesh key={i} position={[p.x, p.y, -5.28]}>
          <planeGeometry args={[1.1, 1.5]} />
          <meshStandardMaterial color={p.color} roughness={0.9} />
        </mesh>
      ))}
    </group>
  )
}

// ---------- 地毯 ----------
function Rug() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0.2]} receiveShadow>
      <planeGeometry args={[6.5, 4.5]} />
      <meshStandardMaterial color={C.rug} roughness={0.95} />
    </mesh>
  )
}

// ---------- 组合 ----------
function LibraryFurniture() {
  return (
    <group>
      <Rug />
      <Bookshelves />
      <ReadingTable />
      <Chairs />
      <Stairs />
      <Paintings />
    </group>
  )
}

export default function LibraryInterior({ onExit }: { onExit: () => void }) {
  return (
    <InteriorScene
      buildingId="library"
      width={WIDTH}
      depth={DEPTH}
      height={HEIGHT}
      buildingName="图书馆擂台"
      onExit={onExit}
      extraColliders={LIBRARY_FURNITURE_COLLIDERS}
    >
      <LibraryFurniture />
    </InteriorScene>
  )
}

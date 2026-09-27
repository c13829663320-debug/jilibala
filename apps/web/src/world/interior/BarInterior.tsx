/**
 * 开放世界 · 酒吧（酒吧辩论）3D 室内场景
 * ------------------------------------------------------------------
 * 分片：buildingId="bar"，房间 13(X) × 10(Z) × 5(H)。
 * 主题色：#a34a4a（酒红）/ #1c1210（暗棕）/ #e8a0a0（粉酒红高光）。
 *
 * 氛围：暖暗 + 酒红 + 吧台正面发光。低耗预算：
 *   - draw call ≤ 30（Shell ≈11 + 收集品 3 + 本家具 ≈16）
 *   - 额外 pointLight 仅 2 盏吧台吊灯（Shell 自带 3 盏）
 *
 * 家具：
 *   - 后部长吧台 + 多层酒架 + 彩色酒瓶（instancedMesh）
 *   - 吧台正面酒红 emissive 光带
 *   - 吧台前 5 个高脚凳（instancedMesh）
 *   - 两侧 2 张散座圆桌 + 椅子（instancedMesh）
 *   - 墙面霓虹灯 / 角落点唱机 / 2 盏暖色吊灯
 *
 * 碰撞体：吧台 / 酒架 / 散座桌导出为纯 AABB 数据
 *   （InteriorScene 仅注入四壁碰撞，家具碰撞数据由本文件导出供上层合并）。
 */
import { useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import InteriorScene from './InteriorScene'
import type { InteriorCollider } from './InteriorShell'
import { BUILDING_THEME } from '../art-spec'

const THEME = BUILDING_THEME.bar

// ---------- 家具 AABB 碰撞体（纯数据，与下方 3D 摆放一一对应） ----------
/** 吧台（后墙前方，长条形） */
export const BAR_FURNITURE_COLLIDERS: InteriorCollider[] = [
  // 吧台本体：x -3.45..5.05，z -4.65..-3.75
  { kind: 'aabb', box: { minX: -3.45, maxX: 5.05, minZ: -4.65, maxZ: -3.75 } },
  // 酒架（贴后墙，窄条）
  { kind: 'aabb', box: { minX: -3.45, maxX: 5.05, minZ: -4.95, maxZ: -4.55 } },
  // 散座圆桌 1（左侧，收集品 bar_table_1 下方）
  { kind: 'aabb', box: { minX: -4.1, maxX: -2.9, minZ: 1.4, maxZ: 2.6 } },
  // 散座圆桌 2（右侧）
  { kind: 'aabb', box: { minX: 3.4, maxX: 4.6, minZ: 0.6, maxZ: 1.8 } },
]

// ---------- 家具摆放常量 ----------
/** 吧台前 5 个高脚凳的位置 */
const STOOL_POS = [
  [-2.2, -2.9], [-0.6, -2.9], [1.0, -2.9], [2.6, -2.9], [4.2, -2.9],
] as const

/** 散座桌中心 */
const TABLE_POS = [
  [-3.5, 2], [4, 1.2],
] as const

/** 椅子（围两桌各 2 把） */
const CHAIR_POS = [
  [-3.5, 1.2], [-3.5, 2.8],
  [4, 0.4], [4, 2.0],
] as const

/** 吊灯（吧台上方 2 盏） */
const PENDANT_POS = [
  [0, 4.25, -4.2], [3, 4.25, -4.2],
] as const

/** 酒瓶配色（不同颜色代表不同酒） */
const BOTTLE_COLORS = ['#7a1f1f', '#c98a3d', '#3f6b3a', '#5a3a2a', '#274b6b', '#8a2a4a', '#d4b06a']

/** 生成酒瓶陈列点：两层酒架，沿 X 排列 */
function useBottleSpots() {
  return useMemo(() => {
    const spots: Array<{ x: number; y: number; z: number; color: THREE.Color }> = []
    // 两层搁板顶面高度（搁板中心 y=1.9 / 2.7，厚 0.06）
    const shelfTops = [1.93, 2.73]
    shelfTops.forEach((top, row) => {
      let i = 0
      for (let x = -3.1; x <= 4.6; x += 0.42) {
        const color = new THREE.Color(BOTTLE_COLORS[(row * 3 + i) % BOTTLE_COLORS.length])
        spots.push({ x, y: top + 0.2, z: -4.7, color })
        i++
      }
    })
    return spots
  }, [])
}

/** 酒吧专属家具（作为 InteriorScene 的 children） */
function BarFurniture() {
  const bottleRef = useRef<THREE.InstancedMesh>(null)
  const stoolRef = useRef<THREE.InstancedMesh>(null)
  const chairRef = useRef<THREE.InstancedMesh>(null)
  const bulbRef = useRef<THREE.InstancedMesh>(null)
  const tableTopRef = useRef<THREE.InstancedMesh>(null)
  const tableLegRef = useRef<THREE.InstancedMesh>(null)
  const bottleSpots = useBottleSpots()

  // 一次性写入所有 instanced 矩阵 + 酒瓶颜色
  useFrame(() => {
    const m = new THREE.Matrix4()
    const q = new THREE.Quaternion()
    const v = new THREE.Vector3()
    const sc = new THREE.Vector3()
    q.identity()

    if (bottleRef.current) {
      bottleSpots.forEach((p, i) => {
        v.set(p.x, p.y, p.z); sc.setScalar(1)
        m.compose(v, q, sc)
        bottleRef.current!.setMatrixAt(i, m)
        bottleRef.current!.setColorAt(i, p.color)
      })
      bottleRef.current.instanceMatrix.needsUpdate = true
      if (bottleRef.current.instanceColor) bottleRef.current.instanceColor.needsUpdate = true
    }
    if (stoolRef.current) {
      STOOL_POS.forEach(([x, z], i) => {
        v.set(x, 0.375, z); sc.setScalar(1)
        m.compose(v, q, sc)
        stoolRef.current!.setMatrixAt(i, m)
      })
      stoolRef.current.instanceMatrix.needsUpdate = true
    }
    if (chairRef.current) {
      CHAIR_POS.forEach(([x, z], i) {
        v.set(x, 0.225, z); sc.setScalar(1)
        m.compose(v, q, sc)
        chairRef.current!.setMatrixAt(i, m)
      })
      chairRef.current.instanceMatrix.needsUpdate = true
    }
    if (tableTopRef.current && tableLegRef.current) {
      TABLE_POS.forEach(([x, z], i) => {
        v.set(x, 0.75, z); sc.setScalar(1)
        m.compose(v, q, sc)
        tableTopRef.current!.setMatrixAt(i, m)
        v.set(x, 0.375, z); sc.setScalar(1)
        m.compose(v, q, sc)
        tableLegRef.current!.setMatrixAt(i, m)
      })
      tableTopRef.current.instanceMatrix.needsUpdate = true
      tableLegRef.current.instanceMatrix.needsUpdate = true
    }
    if (bulbRef.current) {
      PENDANT_POS.forEach(([x, y, z], i) => {
        v.set(x, y, z); sc.setScalar(1)
        m.compose(v, q, sc)
        bulbRef.current!.setMatrixAt(i, m)
      })
      bulbRef.current.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <group>
      {/* ===== 吧台（后部长条） ===== */}
      {/* 台身 */}
      <mesh position={[0.8, 0.525, -4.2]}>
        <boxGeometry args={[8.5, 1.05, 0.9]} />
        <meshStandardMaterial color={THEME.secondary} roughness={0.7} />
      </mesh>
      {/* 台面 */}
      <mesh position={[0.8, 1.08, -4.2]}>
        <boxGeometry args={[8.8, 0.1, 1.1]} />
        <meshStandardMaterial color="#2a1a16" roughness={0.35} metalness={0.2} />
      </mesh>
      {/* 吧台正面酒红发光带 */}
      <mesh position={[0.8, 0.45, -3.73]}>
        <boxGeometry args={[8.5, 0.12, 0.05]} />
        <meshStandardMaterial
          color={THEME.primary}
          emissive={THEME.primary}
          emissiveIntensity={1.4}
        />
      </mesh>

      {/* ===== 吧台后酒架（贴后墙） ===== */}
      {/* 背板 */}
      <mesh position={[0.8, 2.3, -4.85]}>
        <boxGeometry args={[8.5, 2.2, 0.1]} />
        <meshStandardMaterial color="#160d0b" roughness={0.9} />
      </mesh>
      {/* 两层搁板 */}
      <mesh position={[0.8, 1.9, -4.72]}>
        <boxGeometry args={[8.3, 0.06, 0.32]} />
        <meshStandardMaterial color="#3a241c" roughness={0.8} />
      </mesh>
      <mesh position={[0.8, 2.7, -4.72]}>
        <boxGeometry args={[8.3, 0.06, 0.32]} />
        <meshStandardMaterial color="#3a241c" roughness={0.8} />
      </mesh>
      {/* 酒瓶（彩色小圆柱，instanced） */}
      <instancedMesh ref={bottleRef} args={[undefined, undefined, bottleSpots.length]}>
        <cylinderGeometry args={[0.06, 0.07, 0.4, 6]} />
        <meshStandardMaterial roughness={0.2} metalness={0.1} />
      </instancedMesh>

      {/* ===== 吧台前高脚凳（instanced） ===== */}
      <instancedMesh ref={stoolRef} args={[undefined, undefined, STOOL_POS.length]}>
        <cylinderGeometry args={[0.18, 0.06, 0.75, 8]} />
        <meshStandardMaterial color="#4a2c22" roughness={0.6} />
      </instancedMesh>

      {/* ===== 散座圆桌（两侧） ===== */}
      {/* 桌面 */}
      <instancedMesh ref={tableTopRef} args={[undefined, undefined, TABLE_POS.length]}>
        <cylinderGeometry args={[0.55, 0.55, 0.06, 12]} />
        <meshStandardMaterial color="#3a241c" roughness={0.7} />
      </instancedMesh>
      {/* 桌腿（单柱） */}
      <instancedMesh ref={tableLegRef} args={[undefined, undefined, TABLE_POS.length]}>
        <cylinderGeometry args={[0.08, 0.1, 0.75, 8]} />
        <meshStandardMaterial color="#2a1a16" roughness={0.8} />
      </instancedMesh>
      {/* 椅子（instanced） */}
      <instancedMesh ref={chairRef} args={[undefined, undefined, CHAIR_POS.length]}>
        <boxGeometry args={[0.45, 0.45, 0.45]} />
        <meshStandardMaterial color={THEME.primary} roughness={0.75} />
      </instancedMesh>

      {/* ===== 霓虹灯（后墙上方，酒红发光） ===== */}
      <mesh position={[0.8, 3.75, -4.82]}>
        <boxGeometry args={[4.2, 0.7, 0.08]} />
        <meshStandardMaterial
          color={THEME.accent}
          emissive={THEME.accent}
          emissiveIntensity={1.2}
        />
      </mesh>

      {/* ===== 点唱机（右后角，发光装饰盒） ===== */}
      <mesh position={[5.7, 0.85, -3.9]}>
        <boxGeometry args={[0.9, 1.7, 0.7]} />
        <meshStandardMaterial color="#241614" roughness={0.6} />
      </mesh>
      <mesh position={[5.7, 1.0, -3.54]}>
        <boxGeometry args={[0.7, 0.9, 0.05]} />
        <meshStandardMaterial
          color="#FFD600"
          emissive="#FFD600"
          emissiveIntensity={0.9}
        />
      </mesh>

      {/* ===== 吧台吊灯（2 盏暖光灯泡 instanced + pointLight） ===== */}
      <instancedMesh ref={bulbRef} args={[undefined, undefined, PENDANT_POS.length]}>
        <sphereGeometry args={[0.09, 8, 8]} />
        <meshStandardMaterial
          color="#ffd9a0"
          emissive="#ffc880"
          emissiveIntensity={1.8}
        />
      </instancedMesh>
      <pointLight position={[0, 4.1, -4.2]} color="#ffc880" intensity={0.6} distance={4.5} decay={2} />
      <pointLight position={[3, 4.1, -4.2]} color="#ffc880" intensity={0.6} distance={4.5} decay={2} />

      {/* ===== 酒窖入口（左后角地面暗色盖板，收集品 bar_hidden_cellar 处） ===== */}
      <mesh position={[-4.5, 0.03, -4.2]}>
        <boxGeometry args={[1.2, 0.06, 0.9]} />
        <meshStandardMaterial color="#0a0808" roughness={0.95} />
      </mesh>
    </group>
  )
}

// ---------- 导出组件 ----------
interface BarInteriorProps {
  /** 返回广场 */
  onExit: () => void
}

/** 酒吧 3D 室内场景页面 */
export default function BarInterior({ onExit }: BarInteriorProps) {
  return (
    <InteriorScene
      buildingId="bar"
      width={13}
      depth={10}
      height={5}
      buildingName="酒吧辩论"
      onExit={onExit}
    >
      <BarFurniture />
    </InteriorScene>
  )
}

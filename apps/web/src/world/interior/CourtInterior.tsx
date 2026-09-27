/**
 * 开放世界 · 法庭 3D 室内场景（建筑分片：court）
 * ------------------------------------------------------------------
 * 用 <InteriorScene> 容器包裹，在 children 中摆放法庭专属程序化家具：
 *   - 法官席（后方中央）：高台 + 高背法官椅 + 金色法槌摆件
 *   - 审判长桌（中央靠后）：长桌（court_gavel 收集品浮于桌面）
 *   - 原告 / 被告席（左右两侧）：桌椅各一套（instancedMesh 复用）
 *   - 旁听席（前方两侧）：排椅（instancedMesh 复用 6 个实例）
 *   - 国徽/徽章（后墙）：品牌黄发光圆形装饰
 *   - 立柱（四角）：深色柱身 + 金色顶饰（instancedMesh 复用）
 *   - 地毯（中央走道）：深红色矩形
 *
 * 所有家具均为程序化几何体 + BUILDING_THEME.court 主题色，不加载外部模型/贴图。
 * 家具碰撞体通过 extraColliders 注入 InteriorPlayer（AABB）。
 *
 * 收集品位置（collectibles.ts 已定义，本组件仅保证布局可达）：
 *   - court_gavel        (0,   1.2, -3) rare    → 审判长桌桌面
 *   - court_bench_left   (-4,  1,   2) common   → 左侧旁听排椅之间
 *   - court_hidden_judge (0,   3,  -5) hidden   → 法官席后方高处（徽章前）
 */
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import InteriorScene from './InteriorScene'
import type { InteriorCollider } from './InteriorShell'
import { BUILDING_THEME, BRAND, MATERIAL } from '../art-spec'

// 房间尺寸（与 InteriorScene props 对齐）
const WIDTH = 14
const DEPTH = 12
const HEIGHT = 5.5

const theme = BUILDING_THEME.court
const GOLD = theme.primary      // #c9a227
const DEEP_RED = theme.secondary // #8b2500
const DARK_WOOD = '#33200f'     // 深色柱身 / 桌体（比墙面更深，形成层次）

/**
 * 法庭家具 AABB 碰撞体（纯数据，可单测）。
 * 仅覆盖主要家具：法官高台、审判长桌、四角立柱。
 * 与 buildInteriorColliders 的四壁碰撞体拼接后传入 InteriorPlayer。
 */
export function courtFurnitureColliders(): InteriorCollider[] {
  return [
    // 法官高台（后方中央，z:-5.9 ~ -4.3）
    { kind: 'aabb', box: { minX: -2.5, maxX: 2.5, minZ: -5.9, maxZ: -4.3 } },
    // 审判长桌（中央靠后，z:-3.7 ~ -2.5）
    { kind: 'aabb', box: { minX: -1.8, maxX: 1.8, minZ: -3.7, maxZ: -2.5 } },
    // 四角立柱（r≈0.3，取 ±0.3 盒）
    { kind: 'aabb', box: { minX: -6.6, maxX: -6.0, minZ: -5.6, maxZ: -5.0 } },
    { kind: 'aabb', box: { minX: 6.0, maxX: 6.6, minZ: -5.6, maxZ: -5.0 } },
    { kind: 'aabb', box: { minX: -6.6, maxX: -6.0, minZ: 5.0, maxZ: 5.6 } },
    { kind: 'aabb', box: { minX: 6.0, maxX: 6.6, minZ: 5.0, maxZ: 5.6 } },
  ]
}

// ---------- 布局常量（与收集品坐标对齐，便于可达性核对） ----------
const PILLAR_POS: [number, number][] = [
  [-6.3, -5.3], [6.3, -5.3], [-6.3, 5.3], [6.3, 5.3],
]
// 旁听排椅：左右各 3 排，朝 -Z（法官方向）
const BENCH_POS: [number, number][] = [
  [-4.5, 1.5], [-4.5, 2.8], [-4.5, 4.1],
  [4.5, 1.5], [4.5, 2.8], [4.5, 4.1],
]
// 原告 / 被告桌椅
const SIDE_DESK_POS: [number, number][] = [[-4.6, -0.5], [4.6, -0.5]]
const SIDE_CHAIR_POS: [number, number][] = [[-4.6, -1.4], [4.6, -1.4]]

/** instancedMesh 辅助：把 positions 写入实例矩阵 */
function useInstanceMatrices(
  ref: React.RefObject<THREE.InstancedMesh | null>,
  positions: [number, number][],
  y: number,
) {
  useLayoutEffect(() => {
    const mesh = ref.current
    if (!mesh) return
    const m = new THREE.Matrix4()
    for (let i = 0; i < positions.length; i++) {
      const [x, z] = positions[i]
      m.makeTranslation(x, y, z)
      mesh.setMatrixAt(i, m)
    }
    mesh.instanceMatrix.needsUpdate = true
  }, [ref, positions, y])
}

export default function CourtInterior({ onExit }: { onExit: () => void }) {
  const benchRef = useRef<THREE.InstancedMesh>(null)
  const deskRef = useRef<THREE.InstancedMesh>(null)
  const chairRef = useRef<THREE.InstancedMesh>(null)
  const shaftRef = useRef<THREE.InstancedMesh>(null)
  const capitalRef = useRef<THREE.InstancedMesh>(null)

  useInstanceMatrices(benchRef, BENCH_POS, 0.225)
  useInstanceMatrices(deskRef, SIDE_DESK_POS, 0.4)
  useInstanceMatrices(chairRef, SIDE_CHAIR_POS, 0.225)
  useInstanceMatrices(shaftRef, PILLAR_POS, HEIGHT / 2)
  useInstanceMatrices(capitalRef, PILLAR_POS, HEIGHT - 0.45)

  return (
    <InteriorScene
      buildingId="court"
      width={WIDTH}
      depth={DEPTH}
      height={HEIGHT}
      buildingName="趣味法庭"
      onExit={onExit}
      extraColliders={courtFurnitureColliders()}
    >
      {/* ===== 中央走道地毯（深红 #8b2500，微抬避免 z-fighting） ===== */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.02, 1.2]} receiveShadow>
        <planeGeometry args={[1.8, 7.6]} />
        <meshStandardMaterial color={DEEP_RED} roughness={0.9} />
      </mesh>
      {/* 地毯金色中线（强化走道识别，1 个 draw call） */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.025, 1.2]}>
        <planeGeometry args={[0.08, 7.6]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.25} />
      </mesh>

      {/* ===== 后墙国徽/徽章：品牌黄发光圆形 ===== */}
      <mesh position={[0, 3.3, -5.78]}>
        <circleGeometry args={[0.7, 32]} />
        <meshStandardMaterial
          color={GOLD}
          emissive={BRAND.yellow}
          emissiveIntensity={0.7}
          roughness={0.3}
          metalness={0.4}
        />
      </mesh>

      {/* ===== 法官席（后方中央）：高台 + 高背法官椅 ===== */}
      {/* 高台 */}
      <mesh position={[0, 0.175, -5.1]} castShadow receiveShadow>
        <boxGeometry args={[5.0, 0.35, 1.6]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      {/* 高背法官椅（高台之上，面朝 +Z：座体 + 靠背） */}
      <group position={[0, 0.35, -5.3]}>
        <mesh position={[0, 0.45, 0]} castShadow>
          <boxGeometry args={[0.9, 0.9, 0.9]} />
          <meshStandardMaterial color={DARK_WOOD} roughness={0.8} />
        </mesh>
        <mesh position={[0, 1.15, -0.32]}>
          <boxGeometry args={[0.9, 1.1, 0.18]} />
          <meshStandardMaterial color={DARK_WOOD} roughness={0.8} />
        </mesh>
      </group>

      {/* ===== 审判长桌（中央靠后）：court_gavel 浮于桌面 ===== */}
      <mesh position={[0, 0.5, -3.1]} castShadow receiveShadow>
        <boxGeometry args={[3.6, 1.0, 1.2]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={MATERIAL.defaultRoughness} />
      </mesh>
      {/* 法槌摆件（金色 #c9a227，置于桌面 court_gavel 正下方） */}
      <mesh position={[0, 1.12, -3.1]} rotation={[0, 0, Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.06, 0.06, 0.55, 8]} />
        <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
      </mesh>
      <mesh position={[0.24, 1.2, -3.1]} castShadow>
        <cylinderGeometry args={[0.13, 0.13, 0.18, 12]} />
        <meshStandardMaterial color={GOLD} metalness={0.6} roughness={0.3} />
      </mesh>

      {/* ===== 原告 / 被告席（左右两侧）：桌椅各一套（instanced） ===== */}
      <instancedMesh ref={deskRef} args={[undefined, undefined, SIDE_DESK_POS.length]} castShadow>
        <boxGeometry args={[1.4, 0.8, 0.7]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={0.8} />
      </instancedMesh>
      <instancedMesh ref={chairRef} args={[undefined, undefined, SIDE_CHAIR_POS.length]}>
        <boxGeometry args={[0.5, 0.45, 0.5]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={0.8} />
      </instancedMesh>

      {/* ===== 旁听席（前方两侧）：排椅 instancedMesh 复用 6 个 ===== */}
      <instancedMesh ref={benchRef} args={[undefined, undefined, BENCH_POS.length]} castShadow>
        <boxGeometry args={[2.4, 0.45, 0.5]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={0.85} />
      </instancedMesh>

      {/* ===== 四角立柱：深色柱身 + 金色顶饰（instanced） ===== */}
      <instancedMesh ref={shaftRef} args={[undefined, undefined, PILLAR_POS.length]} castShadow>
        <cylinderGeometry args={[0.28, 0.34, HEIGHT, 10]} />
        <meshStandardMaterial color={DARK_WOOD} roughness={0.9} />
      </instancedMesh>
      <instancedMesh ref={capitalRef} args={[undefined, undefined, PILLAR_POS.length]}>
        <boxGeometry args={[0.6, 0.4, 0.6]} />
        <meshStandardMaterial color={GOLD} emissive={GOLD} emissiveIntensity={0.3} metalness={0.5} roughness={0.4} />
      </instancedMesh>

      {/* ===== 额外光照（在 Shell 默认光照之上，仅 +2 盏） ===== */}
      {/* 法官席聚光灯（暖白，位于审判长桌正上方，向下照亮审判区） */}
      <spotLight
        position={[0, HEIGHT - 0.4, -3.1]}
        angle={0.7}
        penumbra={0.5}
        color="#fff4e0"
        intensity={1.1}
        distance={14}
        decay={2}
      />
      {/* 左侧壁灯（品牌黄） */}
      <pointLight
        position={[-6.6, 3.2, -1.0]}
        color={BRAND.yellow}
        intensity={0.5}
        distance={7}
        decay={2}
      />
    </InteriorScene>
  )
}

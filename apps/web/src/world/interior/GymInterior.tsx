/**
 * 云健身 · 健身房 3D 室内场景
 * ------------------------------------------------------------------
 * buildingId="gym"，宽 12 / 深 10 / 高 5.5。
 * 全部家具程序化建模（零贴图），主题色取自 BUILDING_THEME.gym：
 *   primary #4fb3a5（青） / secondary #0f1f1d（深墨） / accent #a8e6de（浅青）
 *
 * 家具清单：
 *   - 哑铃架（后墙中央）+ 多组哑铃（instancedMesh，10 个实例一次绘制）
 *   - 跑步机 ×2（右侧靠墙，底座 + 发光仪表盘，均 instancedMesh）
 *   - 瑜伽垫 ×3（地面彩色垫子，instancedMesh + 逐实例色）
 *   - 镜子墙（左墙高反光平面，metalness 高 / roughness 低）
 *   - 拳击沙袋（天花板悬挂圆柱 + 顶部链条）
 *   - 健身球 ×3（彩色球体，instancedMesh + 逐实例色）
 *   - 记分板（后墙发光面板 + 数字装饰条）
 *   - 额外明亮顶灯（健身房比其他建筑更亮）
 *
 * 收集品由 InteriorShell -> CollectibleLayer 按 buildingId="gym" 自动注入：
 *   gym_dumbbell(0,1,-2) / gym_mirror(-4,1,0) / gym_hidden_rooftop(3,3.5,3)
 */
import { useLayoutEffect, useRef } from 'react'
import * as THREE from 'three'
import InteriorScene from './InteriorScene'
import type { InteriorCollider } from './InteriorShell'

// ---------- 主题色（与 art-spec BUILDING_THEME.gym 对齐） ----------
const PRIMARY = '#4fb3a5' // 青
const SECONDARY = '#0f1f1d' // 深墨
const ACCENT = '#a8e6de' // 浅青
const DARK_METAL = '#2a2e33'
const BELT_COLOR = '#17191d'

// ---------- 家具碰撞体（纯数据，供 InteriorPlayer 阻挡玩家穿过器械） ----------
/**
 * 房间内部 X ∈ [-6, 6]，Z ∈ [-5, 5]。
 * 仅对「不可穿越」的大件器械出碰撞体；垫子/健身球/镜子墙等可绕行或贴墙，不阻挡。
 * 格式与 InteriorShell.buildInteriorColliders 一致：{ kind:'aabb', box:{minX,maxX,minZ,maxZ} }
 */
export const GYM_FURNITURE_COLLIDERS: InteriorCollider[] = [
  // 哑铃架（后墙中央，约 x∈[-1.4,1.4] z∈[-4.7,-3.9]）
  { kind: 'aabb', box: { minX: -1.4, maxX: 1.4, minZ: -4.7, maxZ: -3.9 } },
  // 跑步机 1（右侧靠墙）
  { kind: 'aabb', box: { minX: 3.8, maxX: 4.8, minZ: -4.4, maxZ: -2.2 } },
  // 跑步机 2（右侧靠墙）
  { kind: 'aabb', box: { minX: 3.8, maxX: 4.8, minZ: -1.9, maxZ: 0.4 } },
  // 拳击沙袋（左中悬挂点正下方）
  { kind: 'aabb', box: { minX: -2.9, maxX: -2.1, minZ: -3.4, maxZ: -2.6 } },
]

// ---------- instancedMesh 工具 ----------
interface InstanceItem {
  position: [number, number, number]
  rotation?: [number, number, number]
  scale?: [number, number, number]
}

/** 一次性写入所有实例矩阵；可选逐实例颜色（setColorAt）。 */
function applyInstances(
  mesh: THREE.InstancedMesh | null,
  items: InstanceItem[],
  colors?: string[],
) {
  if (!mesh) return
  const dummy = new THREE.Object3D()
  items.forEach((it, i) => {
    dummy.position.set(...it.position)
    dummy.rotation.set(...(it.rotation ?? [0, 0, 0]))
    dummy.scale.set(...(it.scale ?? [1, 1, 1]))
    dummy.updateMatrix()
    mesh.setMatrixAt(i, dummy.matrix)
    if (colors) mesh.setColorAt(i, new THREE.Color(colors[i]))
  })
  mesh.instanceMatrix.needsUpdate = true
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
}

// ---------- 专属家具 ----------
function GymFurniture() {
  // 哑铃架立柱（2 根，instanced）
  const rackPostRef = useRef<THREE.InstancedMesh>(null)
  // 哑铃（10 个，instanced：两层货架 × 5 个）
  const dumbbellRef = useRef<THREE.InstancedMesh>(null)
  // 跑步机底座（2 台，instanced）
  const treadmillBaseRef = useRef<THREE.InstancedMesh>(null)
  // 跑步机仪表盘（2 台，instanced，发光）
  const treadmillPanelRef = useRef<THREE.InstancedMesh>(null)
  // 瑜伽垫（3 块，instanced + 逐实例色）
  const matRef = useRef<THREE.InstancedMesh>(null)
  // 健身球（3 个，instanced + 逐实例色）
  const ballRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    // 哑铃架立柱：左 / 右
    applyInstances(rackPostRef.current, [
      { position: [-1.2, 0.78, -4.3] },
      { position: [1.2, 0.78, -4.3] },
    ])

    // 哑铃：两层货架（y≈0.55 / 1.15），每层 5 个，水平摆放（圆柱绕 Z 转 90° → 沿 X）
    const dumbbells: InstanceItem[] = []
    for (const y of [0.55, 1.15]) {
      for (let k = 0; k < 5; k++) {
        dumbbells.push({ position: [-1.0 + k * 0.5, y, -4.3], rotation: [0, 0, Math.PI / 2] })
      }
    }
    applyInstances(dumbbellRef.current, dumbbells)

    // 跑步机底座（右侧靠墙，面向 +Z 出口方向）
    applyInstances(treadmillBaseRef.current, [
      { position: [4.3, 0.09, -3.3] },
      { position: [4.3, 0.09, -0.8] },
    ])
    // 跑步机仪表盘（每台前端抬高的发光面板）
    applyInstances(treadmillPanelRef.current, [
      { position: [4.3, 1.15, -2.25] },
      { position: [4.3, 1.15, 0.25] },
    ])

    // 瑜伽垫（地面中央偏前，避开出生点与门口）
    applyInstances(
      matRef.current,
      [
        { position: [-1.6, 0.03, 2.0] },
        { position: [0.4, 0.03, 2.6] },
        { position: [2.2, 0.03, 1.7] },
      ],
      [PRIMARY, ACCENT, '#e8a0a0'],
    )

    // 健身球（右后角 + 左前角）
    applyInstances(
      ballRef.current,
      [
        { position: [5.2, 0.35, -4.0] },
        { position: [5.2, 0.35, -3.2] },
        { position: [-5.3, 0.35, 3.6] },
      ],
      [PRIMARY, '#FFD600', '#e07a5f'],
    )
  }, [])

  return (
    <>
      {/* ===== 镜子墙（左墙：高反光） ===== */}
      <mesh position={[-5.78, 2.6, 0]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[8, 4.4]} />
        <meshStandardMaterial
          color="#dfe9e8"
          metalness={0.95}
          roughness={0.05}
          envMapIntensity={1}
        />
      </mesh>

      {/* ===== 哑铃架 ===== */}
      {/* 立柱（instanced） */}
      <instancedMesh ref={rackPostRef} args={[undefined, undefined, 2]}>
        <boxGeometry args={[0.12, 1.55, 0.55]} />
        <meshStandardMaterial color={DARK_METAL} metalness={0.6} roughness={0.4} />
      </instancedMesh>
      {/* 两层货架板 */}
      <mesh position={[0, 0.45, -4.3]}>
        <boxGeometry args={[2.5, 0.07, 0.6]} />
        <meshStandardMaterial color="#3a3f45" metalness={0.5} roughness={0.45} />
      </mesh>
      <mesh position={[0, 1.05, -4.3]}>
        <boxGeometry args={[2.5, 0.07, 0.6]} />
        <meshStandardMaterial color="#3a3f45" metalness={0.5} roughness={0.45} />
      </mesh>
      {/* 哑铃（instanced，10 个） */}
      <instancedMesh ref={dumbbellRef} args={[undefined, undefined, 10]}>
        <cylinderGeometry args={[0.09, 0.09, 0.55, 10]} />
        <meshStandardMaterial color="#4a4f56" metalness={0.75} roughness={0.3} />
      </instancedMesh>

      {/* ===== 跑步机 ×2 ===== */}
      <instancedMesh ref={treadmillBaseRef} args={[undefined, undefined, 2]}>
        <boxGeometry args={[0.95, 0.18, 2.1]} />
        <meshStandardMaterial color={BELT_COLOR} roughness={0.7} />
      </instancedMesh>
      {/* 发光仪表盘 */}
      <instancedMesh ref={treadmillPanelRef} args={[undefined, undefined, 2]}>
        <boxGeometry args={[0.55, 0.45, 0.16]} />
        <meshStandardMaterial
          color={SECONDARY}
          emissive={PRIMARY}
          emissiveIntensity={0.9}
          roughness={0.4}
        />
      </instancedMesh>

      {/* ===== 瑜伽垫 ×3（instanced + 逐实例色） ===== */}
      <instancedMesh ref={matRef} args={[undefined, undefined, 3]}>
        <boxGeometry args={[1.5, 0.05, 1.9]} />
        <meshStandardMaterial color="#ffffff" roughness={0.9} />
      </instancedMesh>

      {/* ===== 拳击沙袋（悬挂） ===== */}
      <mesh position={[-2.5, 2.0, -3]}>
        <cylinderGeometry args={[0.28, 0.3, 1.3, 16]} />
        <meshStandardMaterial color="#1f6f66" roughness={0.6} metalness={0.1} />
      </mesh>
      {/* 顶部链条（细圆柱，从天花板垂到沙袋） */}
      <mesh position={[-2.5, 4.1, -3]}>
        <cylinderGeometry args={[0.03, 0.03, 2.9, 6]} />
        <meshStandardMaterial color="#8a8f96" metalness={0.8} roughness={0.35} />
      </mesh>

      {/* ===== 健身球 ×3（instanced + 逐实例色） ===== */}
      <instancedMesh ref={ballRef} args={[undefined, undefined, 3]}>
        <sphereGeometry args={[0.35, 16, 12]} />
        <meshStandardMaterial color="#ffffff" roughness={0.5} />
      </instancedMesh>

      {/* ===== 记分板 / 发光屏幕（后墙） ===== */}
      <mesh position={[2.3, 3.3, -4.84]}>
        <boxGeometry args={[2.2, 1.1, 0.12]} />
        <meshStandardMaterial
          color={SECONDARY}
          emissive={PRIMARY}
          emissiveIntensity={0.55}
          roughness={0.4}
        />
      </mesh>

      {/* ===== 更亮的顶灯（健身房比其他建筑亮） ===== */}
      <pointLight position={[0, 4.9, 0.5]} color="#e6fffb" intensity={1.1} distance={16} decay={2} />
    </>
  )
}

// ---------- 对外组件 ----------
interface GymInteriorProps {
  onExit: () => void
}

export default function GymInterior({ onExit }: GymInteriorProps) {
  return (
    <InteriorScene
      buildingId="gym"
      width={12}
      depth={10}
      height={5.5}
      buildingName="云健身"
      onExit={onExit}
      extraColliders={GYM_FURNITURE_COLLIDERS}
    >
      <GymFurniture />
    </InteriorScene>
  )
}

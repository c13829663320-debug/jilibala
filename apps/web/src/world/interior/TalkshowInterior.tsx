/**
 * 开放世界 · 脱口秀剧场 3D 室内场景（建筑分片 talkshow）
 * ------------------------------------------------------------------
 * 使用 <InteriorScene> 容器（buildingId="talkshow", 12×11×5），在 children 中
 * 摆放程序化家具：舞台 / 立麦 / 聚光灯 / 阶梯观众席 / 吧台 / 霓虹招牌 / 幕布。
 *
 * 主题色取自 BUILDING_THEME.talkshow：
 *   primary  #e07a5f（珊瑚） secondary #2d1b2e（深紫） accent #ffb4a2（粉桃）
 *
 * 性能预算：家具 draw call ≤ 12（座椅/凳用 instancedMesh 合并），家具新增光源 2
 * （舞台 spotLight + 立麦暖色 pointLight），房间总真实光源由基础层 3 盏 + 本层 2 盏。
 *
 * 家具碰撞体（纯数据，类型与 InteriorCollider 对齐）导出为
 * TALKSHOW_FURNITURE_COLLIDERS，供合并阶段接入 InteriorPlayer；基础层
 * InteriorScene 当前仅生成墙体碰撞体，家具碰撞体不依赖运行时渲染即可被单测。
 */
import { useLayoutEffect, useMemo, useRef } from 'react'
import * as THREE from 'three'
import InteriorScene from './InteriorScene'
import type { InteriorCollider } from './InteriorShell'
import { BUILDING_THEME, MATERIAL } from '../art-spec'

// ---------- 房间尺寸（与 InteriorScene 传入值一致） ----------
const ROOM_W = 12
const ROOM_D = 11
const ROOM_H = 5

// ---------- 家具 AABB 碰撞体（纯数据，室内局部坐标 XZ） ----------
/**
 * 舞台抬高平台 / 吧台 / 观众席座椅区的 AABB 阻挡。
 * 留出左侧过道（x < -1）以便拾取 talkshow_audience_l(-3,1,3)，
 * 舞台前方留边（z=-2.3）以便站在台下拾取 talkshow_mic(0,1.5,-3)，
 * 右后侧不阻挡以便绕到幕布后拾取 talkshow_hidden_backstage(4,1,-4)。
 */
export const TALKSHOW_FURNITURE_COLLIDERS: InteriorCollider[] = [
  // 舞台抬高平台（后墙前，x -4..4，z -5.2..-2.3）
  { kind: 'aabb', box: { minX: -4, maxX: 4, minZ: -5.2, maxZ: -2.3 } },
  // 右侧吧台（贴右墙，z 0.4..4.0）
  { kind: 'aabb', box: { minX: 4.7, maxX: 5.7, minZ: 0.4, maxZ: 4.0 } },
  // 观众席座椅区（留左侧过道，x -1..4，z -1.0..3.3）
  { kind: 'aabb', box: { minX: -1, maxX: 4, minZ: -1.0, maxZ: 3.3 } },
]

// ---------- 专属家具 ----------
function TalkshowFurniture() {
  const theme = BUILDING_THEME.talkshow
  const rough = MATERIAL.defaultRoughness

  // 聚光灯目标点（舞台麦克风处）
  const spotTarget = useMemo(() => new THREE.Object3D(), [])

  // 观众席座椅实例矩阵（instancedMesh 合并，1 次 draw call）
  const chairMatrices = useMemo(() => {
    const pts: [number, number, number][] = []
    const ROWS = 6
    const PER_ROW = 8
    for (let r = 0; r < ROWS; r++) {
      const z = -0.6 + r * 0.75
      const y = 0.3 + r * 0.12 // 阶梯式抬高
      for (let c = 0; c < PER_ROW; c++) {
        const x = -0.9 + c * 0.68 // 左侧留出过道
        pts.push([x, y, z])
      }
    }
    return pts
  }, [])
  const chairRef = useRef<THREE.InstancedMesh>(null)

  // 吧台高脚凳实例
  const stoolMatrices = useMemo<[number, number, number][]>(() => {
    return [1.1, 1.9, 2.7, 3.5].map((z) => [4.25, 0.62, z])
  }, [])
  const stoolRef = useRef<THREE.InstancedMesh>(null)

  useLayoutEffect(() => {
    const m = new THREE.Matrix4()
    if (chairRef.current) {
      chairMatrices.forEach((p, i) => {
        m.makeTranslation(p[0], p[1], p[2])
        chairRef.current!.setMatrixAt(i, m)
      })
      chairRef.current.instanceMatrix.needsUpdate = true
    }
    if (stoolRef.current) {
      stoolMatrices.forEach((p, i) => {
        m.makeTranslation(p[0], p[1], p[2])
        stoolRef.current!.setMatrixAt(i, m)
      })
      stoolRef.current.instanceMatrix.needsUpdate = true
    }
  }, [chairMatrices, stoolMatrices])

  return (
    <>
      {/* ===== 舞台抬高平台（后墙前） ===== */}
      <mesh position={[0, 0.2, -3.8]} receiveShadow>
        <boxGeometry args={[8, 0.4, 2.8]} />
        <meshStandardMaterial color="#5a3240" roughness={rough} />
      </mesh>

      {/* ===== 红砖背景墙 ===== */}
      <mesh position={[0, 1.9, -5.28]}>
        <boxGeometry args={[8, 3.0, 0.14]} />
        <meshStandardMaterial color="#9e4a3c" roughness={0.9} />
      </mesh>

      {/* ===== 立麦（金色立柱 + 珊瑚发光麦头） ===== */}
      <mesh position={[0, 0.95, -3.8]}>
        <cylinderGeometry args={[0.035, 0.035, 1.1, 8]} />
        <meshStandardMaterial color="#d4af37" metalness={0.8} roughness={0.3} />
      </mesh>
      <mesh position={[0, 1.55, -3.8]}>
        <sphereGeometry args={[0.1, 12, 12]} />
        <meshStandardMaterial
          color={theme.accent}
          emissive={theme.accent}
          emissiveIntensity={1.2}
        />
      </mesh>

      {/* ===== 舞台聚光灯（顶部打向麦克风） ===== */}
      <primitive object={spotTarget} position={[0, 0.5, -3.8]} />
      <spotLight
        position={[0, ROOM_H - 0.4, -2.0]}
        target={spotTarget}
        angle={0.5}
        penumbra={0.6}
        intensity={40}
        distance={16}
        decay={2}
        color="#ffd9b0"
      />

      {/* ===== 立麦周围暖色 pointLight ===== */}
      <pointLight
        position={[0, 1.8, -3.6]}
        color={theme.accent}
        intensity={0.9}
        distance={5}
        decay={2}
      />

      {/* ===== 观众席阶梯排椅（instancedMesh） ===== */}
      <instancedMesh
        ref={chairRef}
        args={[undefined, undefined, chairMatrices.length]}
        castShadow
      >
        <boxGeometry args={[0.5, 0.55, 0.5]} />
        <meshStandardMaterial color="#4a2a35" roughness={0.85} />
      </instancedMesh>

      {/* ===== 吧台（右侧贴墙） ===== */}
      <mesh position={[5.2, 0.55, 2.2]}>
        <boxGeometry args={[0.9, 1.1, 3.6]} />
        <meshStandardMaterial color="#3a2030" roughness={0.8} />
      </mesh>
      {/* 高脚凳（instancedMesh） */}
      <instancedMesh
        ref={stoolRef}
        args={[undefined, undefined, stoolMatrices.length]}
      >
        <cylinderGeometry args={[0.18, 0.14, 0.06, 10]} />
        <meshStandardMaterial color={theme.accent} roughness={0.6} />
      </instancedMesh>

      {/* ===== 霓虹灯招牌 OPEN MIC（后墙上方，emissive 平面） ===== */}
      <mesh position={[0, 3.7, -5.2]}>
        <boxGeometry args={[3.4, 1.1, 0.12]} />
        <meshStandardMaterial color="#160c18" roughness={0.9} />
      </mesh>
      <mesh position={[0, 3.7, -5.12]}>
        <planeGeometry args={[3.1, 0.85]} />
        <meshStandardMaterial
          color={theme.accent}
          emissive={theme.accent}
          emissiveIntensity={1.0}
          side={THREE.DoubleSide}
        />
      </mesh>

      {/* ===== 舞台两侧深色垂幕 ===== */}
      <mesh position={[-4.45, 1.9, -4.9]}>
        <boxGeometry args={[0.6, 3.4, 0.25]} />
        <meshStandardMaterial color="#3a1220" roughness={0.95} />
      </mesh>
      <mesh position={[4.45, 1.9, -4.9]}>
        <boxGeometry args={[0.6, 3.4, 0.25]} />
        <meshStandardMaterial color="#3a1220" roughness={0.95} />
      </mesh>
    </>
  )
}

// ---------- 对外组件 ----------
interface TalkshowInteriorProps {
  /** 走近发光门 / 顶部返回按钮触发，回到广场 */
  onExit: () => void
}

/**
 * 脱口秀剧场室内场景。
 * onExit 由路由 / 上层 UI 传入（本分片不修改路由文件）。
 */
export default function TalkshowInterior({ onExit }: TalkshowInteriorProps) {
  return (
    <InteriorScene
      buildingId="talkshow"
      width={ROOM_W}
      depth={ROOM_D}
      height={ROOM_H}
      buildingName="开放麦脱口秀"
      onExit={onExit}
    >
      <TalkshowFurniture />
    </InteriorScene>
  )
}

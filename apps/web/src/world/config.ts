/**
 * 开放世界 · 静态配置
 * ------------------------------------------------------------------
 * 世界尺寸、玩家移动参数、6 大建筑布局表、碰撞体列表都集中在这里。
 * 碰撞体由建筑 footprint 程序化生成，避免手写两份坐标。
 */
import type { BuildingConfig, BuildingId, Collider } from './types'

// ---------- 世界尺度 ----------
/** 世界半边长（世界为 [-WORLD_HALF, WORLD_HALF] 的正方形） */
export const WORLD_HALF = 130
/** 玩家碰撞半径（圆柱） */
export const PLAYER_RADIUS = 0.5
/** 玩家身高（仅用于视觉/相机，不参与碰撞） */
export const PLAYER_HEIGHT = 1.8

// ---------- 移动参数 ----------
export const WALK_SPEED = 6.5
export const RUN_SPEED = 11.5
export const JUMP_VELOCITY = 7.5
export const GRAVITY = -22
/** 走近建筑入口多少单位内显示「进入」提示 */
export const INTERACT_DIST = 4.5

// ---------- 中央广场 ----------
export const FOUNTAIN = { x: 0, z: 0, r: 3 }

// ---------- 6 大建筑布局 ----------
// 沿半径约 70 的环形道路分布，每个建筑正面（+z 方向）朝向世界中心。
// entranceX/Z 是正前方 9 单位处的触发点（depth/2≈6 + 留 3 单位空地）。
export const BUILDINGS: BuildingConfig[] = [
  {
    id: 'court', name: '法庭',
    x: 0, z: -70, rotation: 0,
    width: 16, depth: 12, entranceX: 0, entranceZ: -60,
    color: '#c9a227', emoji: '⚖️', assetId: 'building-court',
  },
  {
    id: 'talkshow', name: '脱口秀',
    x: 65, z: -35, rotation: -1.08,
    width: 13, depth: 11, entranceX: 57, entranceZ: -31,
    color: '#e07a5f', emoji: '🎤', assetId: 'building-talkshow',
  },
  {
    id: 'werewolf', name: '狼人杀',
    x: 65, z: 35, rotation: -2.07,
    width: 13, depth: 11, entranceX: 57, entranceZ: 31,
    color: '#7d5ba6', emoji: '🐺', assetId: 'building-werewolf',
  },
  {
    id: 'bar', name: '酒吧',
    x: 0, z: 70, rotation: Math.PI,
    width: 14, depth: 11, entranceX: 0, entranceZ: 60,
    color: '#a34a4a', emoji: '🍺', assetId: 'building-bar',
  },
  {
    id: 'gym', name: '健身房',
    x: -65, z: 35, rotation: 2.07,
    width: 13, depth: 11, entranceX: -57, entranceZ: 31,
    color: '#4fb3a5', emoji: '🏋️', assetId: 'building-gym',
  },
  {
    id: 'library', name: '图书馆',
    x: -65, z: -35, rotation: 1.08,
    width: 14, depth: 11, entranceX: -57, entranceZ: -31,
    color: '#5b8db8', emoji: '📚', assetId: 'building-library',
  },
]

/** 按 id 取建筑配置 */
export function getBuilding(id: BuildingId): BuildingConfig {
  const b = BUILDINGS.find((x) => x.id === id)
  if (!b) throw new Error(`unknown building: ${id}`)
  return b
}

/**
 * 由建筑 footprint + 喷泉 程序化生成静态碰撞体列表。
 * 建筑用 AABB（盒子），喷泉用 circle（圆柱）。
 * 外围边界在 moveWithCollision 里单独用 WORLD_HALF clamp，不放进列表。
 */
export function buildColliders(): Collider[] {
  const list: Collider[] = []
  for (const b of BUILDINGS) {
    list.push({
      kind: 'aabb',
      box: {
        minX: b.x - b.width / 2,
        maxX: b.x + b.width / 2,
        minZ: b.z - b.depth / 2,
        maxZ: b.z + b.depth / 2,
      },
    })
  }
  // 中央喷泉圆柱
  list.push({ kind: 'circle', c: { x: FOUNTAIN.x, z: FOUNTAIN.z, r: FOUNTAIN.r } })
  return list
}

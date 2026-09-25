/**
 * 开放世界 · 手写碰撞系统（纯函数，无 three 依赖，可直接单测）
 * ------------------------------------------------------------------
 * 玩家视作 XZ 平面上半径 r 的圆；静态障碍分两类：
 *   - aabb：建筑 footprint（盒子）
 *   - circle：喷泉 / 圆柱道具
 * 移动采用「分轴尝试 + 滑动」：先试 X 位移，撞墙就回退 X；再试 Z 位移，
 * 撞墙就回退 Z。这样贴着墙走会自然滑过去，而不是被完全卡住。
 * 外围边界用正方形 clamp。地面恒为 y=0（暂不做起伏地形）。
 */
import type { AABB, CircleObs, Collider } from './types'

/** 圆（圆心 px,pz 半径 r）与 AABB 是否相交 */
export function circleVsAABB(px: number, pz: number, r: number, box: AABB): boolean {
  // 找盒子上离圆心最近的点
  const cx = Math.max(box.minX, Math.min(px, box.maxX))
  const cz = Math.max(box.minZ, Math.min(pz, box.maxZ))
  const dx = px - cx
  const dz = pz - cz
  return dx * dx + dz * dz < r * r
}

/** 圆（px,pz,r）与圆（ox,oz,or）是否相交 */
export function circleVsCircle(
  px: number, pz: number, r: number,
  ox: number, oz: number, or: number,
): boolean {
  const dx = px - ox
  const dz = pz - oz
  const rr = r + or
  return dx * dx + dz * dz < rr * rr
}

/** 在 (px,pz) 处以半径 r 放置玩家圆，是否与任一静态障碍相交 */
export function collidesAt(px: number, pz: number, r: number, colliders: Collider[]): boolean {
  for (const col of colliders) {
    if (col.kind === 'aabb') {
      if (circleVsAABB(px, pz, r, col.box)) return true
    } else {
      if (circleVsCircle(px, pz, r, col.c.x, col.c.z, col.c.r)) return true
    }
  }
  return false
}

/** 把玩家位置夹在 [-half+r, half-r] 的正方形边界内 */
export function clampToBoundary(
  px: number, pz: number, r: number, half: number,
): { x: number; z: number } {
  const lim = half - r
  return {
    x: Math.max(-lim, Math.min(lim, px)),
    z: Math.max(-lim, Math.min(lim, pz)),
  }
}

export interface MoveResult {
  x: number
  z: number
  /** X 方向是否被挡住（用于贴墙滑动动画等） */
  hitX: boolean
  hitZ: boolean
}

/**
 * 尝试从 (x,z) 移动 (dx,dz)，返回碰撞修正后的新位置。
 *
 * 实现策略：分轴滑动。
 *   1. 先只应用 dx：若新位置不与任何障碍相交则接受，否则放弃 X。
 *   2. 在步骤 1 的结果上只应用 dz：若不相交则接受，否则放弃 Z。
 *   3. 最后夹到世界边界。
 * 这样斜着撞墙时会沿墙滑动，而不是完全停住。
 */
export function moveWithCollision(
  x: number, z: number,
  dx: number, dz: number,
  r: number,
  colliders: Collider[],
  half: number,
): MoveResult {
  let nx = x
  let nz = z
  let hitX = false
  let hitZ = false

  // X 轴
  const tryX = x + dx
  if (!collidesAt(tryX, z, r, colliders)) {
    nx = tryX
  } else {
    hitX = true
  }

  // Z 轴（基于 X 步结果）
  const tryZ = z + dz
  if (!collidesAt(nx, tryZ, r, colliders)) {
    nz = tryZ
  } else {
    hitZ = true
  }

  // 世界边界 clamp
  const bounded = clampToBoundary(nx, nz, r, half)
  return { x: bounded.x, z: bounded.z, hitX, hitZ }
}

/** 两点 XZ 距离平方（避免开方，用于「走近建筑」判定） */
export function distSq(ax: number, az: number, bx: number, bz: number): number {
  const dx = ax - bx
  const dz = az - bz
  return dx * dx + dz * dz
}

/** 圆形碰撞体简写（供外部构造喷泉/灯柱等） */
export function circleCollider(x: number, z: number, r: number): Collider {
  return { kind: 'circle', c: { x, z, r } satisfies CircleObs }
}

/** AABB 碰撞体简写 */
export function aabbCollider(minX: number, maxX: number, minZ: number, maxZ: number): Collider {
  return { kind: 'aabb', box: { minX, maxX, minZ, maxZ } satisfies AABB }
}

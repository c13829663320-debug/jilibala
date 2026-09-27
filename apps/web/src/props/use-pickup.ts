// ============================================================================
// 可拾取交互 —— 纯逻辑（无 React / 无 three 运行时依赖，可直接单测）
// ----------------------------------------------------------------------------
// 玩家靠近可拾取道具（距离 < PICKUP_RANGE）→ 显示交互提示；
// 按下 E/点击 → 拾取，道具跟随到玩家手持位置；再次按下 → 放下。
// 浏览器侧的 usePickup hook 只是把这些纯函数接到 PlayerController 输入上。
// ============================================================================
import type { PickupState } from '@balabala/shared'
import { HOLD_DISTANCE, HOLD_HEIGHT, PICKUP_RANGE } from './prop-library'

/** 场景中一个参与拾取判定的道具（XZ 平面位置即可）。 */
export interface PickupableItem {
  propId: string
  /** 实例 id（同一道具可放置多份） */
  instanceId: string
  x: number
  z: number
  pickable: boolean
}

/** XZ 平面欧氏距离。 */
export function distanceXZ(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz)
}

/** 找出玩家附近最近的可拾取道具；没有则返回 null。 */
export function findNearbyPickable(
  playerX: number,
  playerZ: number,
  items: PickupableItem[],
  maxDist: number = PICKUP_RANGE,
): PickupableItem | null {
  let best: PickupableItem | null = null
  let bestDist = maxDist
  for (const item of items) {
    if (!item.pickable) continue
    const d = distanceXZ(playerX, playerZ, item.x, item.z)
    if (d < bestDist) {
      bestDist = d
      best = item
    }
  }
  return best
}

/** 初始拾取状态。 */
export function createPickupState(): PickupState {
  return { phase: 'idle', nearPropId: null, heldPropId: null }
}

/**
 * 每帧/移动后刷新「附近道具」。
 * - 手持中：保持 heldPropId，nearPropId 置空（不再提示新道具）。
 * - 否则：若附近有可拾取道具，phase=nearby 并记录 nearPropId。
 */
export function refreshNearby(
  state: PickupState,
  playerX: number,
  playerZ: number,
  items: PickupableItem[],
  maxDist: number = PICKUP_RANGE,
): PickupState {
  if (state.heldPropId) {
    return { ...state, phase: 'holding', nearPropId: null }
  }
  const near = findNearbyPickable(playerX, playerZ, items, maxDist)
  if (near) {
    return { phase: 'nearby', nearPropId: near.propId, heldPropId: null }
  }
  return { phase: 'idle', nearPropId: null, heldPropId: null }
}

/**
 * 按下交互键（E / 点击）：
 * - 手持中 → 放下（返回新状态 + dropped=true）。
 * - 附近有可拾取道具 → 拾取（phase=holding，heldPropId=nearPropId）。
 * - 否则状态不变。
 */
export function interact(state: PickupState): PickupState {
  if (state.heldPropId) {
    // 放下
    return { phase: 'idle', nearPropId: null, heldPropId: null }
  }
  if (state.phase === 'nearby' && state.nearPropId) {
    return { phase: 'holding', nearPropId: null, heldPropId: state.nearPropId }
  }
  return state
}

/**
 * 计算手持道具的世界坐标（玩家身前、胸口高度）。
 * 与 world/PlayerController 约定一致：forward = (sin(rot), cos(rot)) in XZ。
 */
export function computeHoldPosition(
  playerX: number,
  playerZ: number,
  playerRotation: number,
  offsetDist: number = HOLD_DISTANCE,
  height: number = HOLD_HEIGHT,
): { x: number; y: number; z: number } {
  return {
    x: playerX + Math.sin(playerRotation) * offsetDist,
    y: height,
    z: playerZ + Math.cos(playerRotation) * offsetDist,
  }
}

/**
 * 放下道具时的落点：玩家正前方地面位置（y=0）。
 * 用于把手持道具放回场景地面。
 */
export function computeDropPosition(
  playerX: number,
  playerZ: number,
  playerRotation: number,
  offsetDist: number = HOLD_DISTANCE,
): { x: number; y: number; z: number } {
  return {
    x: playerX + Math.sin(playerRotation) * offsetDist,
    y: 0,
    z: playerZ + Math.cos(playerRotation) * offsetDist,
  }
}

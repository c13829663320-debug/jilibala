/**
 * R5 分片C · Plaza3D 首启聚焦纯逻辑
 * ------------------------------------------------------------------
 * 与 React / three 解耦：纯函数，node 环境可直接单测。
 *
 * 职责：
 *  - 判断「当前用户是否需要首启聚焦推荐建筑」（全新用户 + 有推荐场景 + 未聚焦过）
 *  - 计算把玩家相机初始摆到推荐建筑正前方的出生点与相机 yaw
 *  - 回归用户（firstTimes.plaza=true）一律不聚焦
 */
import type { BuildingId } from '../world'
import type { OnboardingState } from './onboarding-store'
import { needsFirstTimeGuide } from './onboarding-store'

/** 聚焦出生点：玩家位置 + 相机水平角（yaw）。 */
export interface FocusSpawn {
  x: number
  z: number
  /** 相机 yaw（弧度）：相机摆在玩家背后、正对推荐建筑。 */
  yaw: number
}

/**
 * 是否需要首启聚焦。
 * 三个条件同时满足：
 *  1. 有推荐场景建筑 id（recommendedScene 存在）
 *  2. 该用户从未在广场完成过首启聚焦引导（firstTimes.plaza === false）
 *  3. 传入的推荐 id 是合法建筑 id
 * 回归用户 firstTimes.plaza=true → 返回 false。
 */
export function shouldFocusRecommended(
  state: OnboardingState,
  recommendedScene: BuildingId | null | undefined,
): boolean {
  if (!recommendedScene) return false
  return needsFirstTimeGuide(state, 'plaza')
}

/**
 * 计算聚焦出生点。
 * 玩家传送到建筑正前方的入口触发点；相机摆到玩家身后（背离建筑一侧），
 * 这样玩家与建筑都落在镜头正中。
 *
 * @param entranceX 建筑入口 X（玩家落脚点）
 * @param entranceZ 建筑入口 Z
 * @param buildingX 建筑中心 X
 * @param buildingZ 建筑中心 Z
 */
export function computeFocusSpawn(
  entranceX: number,
  entranceZ: number,
  buildingX: number,
  buildingZ: number,
): FocusSpawn {
  // 从玩家指向建筑中心的方向
  const dx = buildingX - entranceX
  const dz = buildingZ - entranceZ
  const len = Math.hypot(dx, dz) || 1
  // 相机在玩家背后 → 相机偏移方向 = 背离建筑
  const awayX = -dx / len
  const awayZ = -dz / len
  // CameraRig 中相机偏移 = (sin(yaw)*h, cos(yaw)*h)，反解 yaw
  const yaw = Math.atan2(awayX, awayZ)
  return { x: entranceX, z: entranceZ, yaw }
}

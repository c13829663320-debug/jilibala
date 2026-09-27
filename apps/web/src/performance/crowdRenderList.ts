// ===== R5: 同屏人群渲染计划（纯函数，无 DOM / three 依赖，可在 Node 单测）=====
//
// 背景：开放广场可能同时有几十人。若每个人都用完整 3D 化身 + 骨骼动画，
// draw call / 蒙皮成本会拖垮中低端设备帧率。
//
// 策略（默认同屏完整模型上限 16）：
//   - 距离本地玩家最近的 maxVisible 人：full（完整 3D 化身 + 动画）
//   - 接下来的 maxVisible 人：billboard（公告牌：名字 + 代表色，不画身体）
//   - 再远的人：capsule（极简胶囊占位，仅保留存在感）；超过 hardCap 则不渲染
//
// 该模块只决定「每个人画到什么程度」，不做实际渲染。

import type { CrowdRenderTier } from '@balabala/shared'

/** 一个远端玩家的位置。 */
export interface CrowdPlayer {
  userId: string
  x: number
  z: number
}

/** 渲染决策。 */
export interface CrowdRenderDecision {
  userId: string
  /** 距本地玩家的水平距离（米）。 */
  distance: number
  /** 应采用的渲染档位。 */
  tier: CrowdRenderTier
}

export interface CrowdPlanOptions {
  /** 完整模型上限（默认 16）。 */
  maxVisible?: number
  /** 公告牌段长度（默认 = maxVisible）。 */
  billboardBand?: number
  /** 再往后是否降级为胶囊（默认 true）；false 则直接不渲染。 */
  allowCapsule?: boolean
}

/** 二维距离。 */
function dist(ax: number, az: number, bx: number, bz: number): number {
  const d = Math.hypot(ax - bx, az - bz)
  return Number.isFinite(d) ? d : 0
}

/**
 * 计算同屏人群的渲染计划。
 *
 * @param players 远端玩家（不含本地玩家本人）
 * @param local   本地玩家位置
 * @param options 人数上限等
 * @returns 按距离由近到远的渲染决策列表
 */
export function planCrowdRender(
  players: readonly CrowdPlayer[],
  local: { x: number; z: number },
  options: CrowdPlanOptions = {},
): CrowdRenderDecision[] {
  const maxVisible = Math.max(0, Math.floor(options.maxVisible ?? 16))
  const billboardBand = Math.max(0, Math.floor(options.billboardBand ?? maxVisible))
  const allowCapsule = options.allowCapsule ?? true

  return players
    .map((p) => ({ p, d: dist(p.x, p.z, local.x, local.z) }))
    .sort((a, b) => a.d - b.d || a.p.userId.localeCompare(b.p.userId))
    .map(({ p, d }, i) => {
      let tier: CrowdRenderTier
      if (i < maxVisible) tier = 'full'
      else if (i < maxVisible + billboardBand) tier = 'billboard'
      else tier = allowCapsule ? 'capsule' : 'billboard'
      return { userId: p.userId, distance: d, tier }
    })
}

/** 便捷：取出应渲染为完整 3D 化身的 userId（最近 maxVisible 个）。 */
export function fullModelUserIds(
  players: readonly CrowdPlayer[],
  local: { x: number; z: number },
  maxVisible = 16,
): string[] {
  return planCrowdRender(players, local, { maxVisible })
    .filter((d) => d.tier === 'full')
    .map((d) => d.userId)
}

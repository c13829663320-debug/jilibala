// ===== R5: 同屏人群上限 Hook =====
//
// 基于 crowdRenderList 的纯函数，把远端玩家列表 + 本地位置 + 人数上限
// 转成一个 userId → 渲染档位 的映射，供 3D 渲染层对远处玩家降级。
//
// 注意：每帧高频调用本 hook 会触发 React 重渲染；应在「玩家集合变化」时
// 计算一次（join/leave），位置缓动由 three 侧自己做。默认上限 16。

import { useMemo } from 'react'
import type { CrowdRenderTier } from '@balabala/shared'
import { planCrowdRender, type CrowdPlayer } from './crowdRenderList'

export interface UseCrowdLimitOptions {
  /** 完整 3D 化身上限（默认 16）。 */
  maxVisible?: number
  /** 公告牌段长度（默认 = maxVisible）。 */
  billboardBand?: number
}

/**
 * @param players 远端玩家（不含本地玩家本人）
 * @param local   本地玩家位置
 * @returns userId → 渲染档位
 */
export function useCrowdLimit(
  players: readonly CrowdPlayer[],
  local: { x: number; z: number },
  options: UseCrowdLimitOptions = {},
): Map<string, CrowdRenderTier> {
  return useMemo(() => {
    const map = new Map<string, CrowdRenderTier>()
    for (const d of planCrowdRender(players, local, options)) {
      map.set(d.userId, d.tier)
    }
    return map
    // players 引用稳定时（join/leave 才变）不重复计算
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [players, local.x, local.z, options.maxVisible, options.billboardBand])
}

/** 默认同屏完整化身人数上限。 */
export const DEFAULT_CROWD_MAX = 16

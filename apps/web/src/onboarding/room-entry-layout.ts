/**
 * R5 分片B：RoomEntry 渐进式披露纯逻辑
 *
 * 首启用户（flowCompleted=false）进入首页时收敛布局：
 *  - 只高亮招牌体验（法庭）+ 一个「全部体验」折叠入口；
 *  - 其余 5 个场景与创造入口收进「全部体验」面板，展开后可见（功能不删）。
 * 回归用户（flowCompleted=true）保持现有完整展示。
 *
 * 纯函数，不依赖 React / DOM，便于 vitest 单测。
 */

import type { OnboardingState } from './onboarding-store'
import type { SceneId } from './onboardingProgress'

/** 招牌体验场景 id（首启用户唯一高亮的场景）。 */
export const SIGNATURE_SCENE_ID: SceneId = 'court'

/**
 * 是否展示收敛布局（首启用户）。
 * 主流程未完成 = 新用户/引导中用户 → 收敛；已完成（含跳过/迁移老用户）→ 完整展示。
 */
export function shouldShowConvergedLayout(state: OnboardingState): boolean {
  return !state.flowCompleted
}

export interface RoomEntryLayout {
  /** 收敛布局下，常驻高亮展示的招牌场景。 */
  signature: SceneId
  /** 收敛布局下，收进「全部体验」面板的其余场景（不含招牌）。 */
  collapsed: SceneId[]
  /** 创造入口是否收进「全部体验」面板。 */
  createEntriesCollapsed: boolean
  /** 全部体验面板当前是否展开（仅收敛布局下有意义）。 */
  panelOpen: boolean
  /** 实际需要渲染在场景网格里的场景（收敛未展开时 = [signature]，其余情况 = 全部）。 */
  visibleScenes: SceneId[]
}

const ALL_SCENES: SceneId[] = ['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library']

/**
 * 计算首页布局。
 * @param state  onboarding 状态
 * @param panelOpen 「全部体验」面板是否已展开（首启用户本地 useState，不持久化）
 * @param allScenes 全部场景 id（默认 6 个；测试可注入）
 */
export function computeRoomEntryLayout(
  state: OnboardingState,
  panelOpen: boolean,
  allScenes: SceneId[] = ALL_SCENES,
): RoomEntryLayout {
  const converged = shouldShowConvergedLayout(state)
  const signature = (allScenes.includes(SIGNATURE_SCENE_ID)
    ? SIGNATURE_SCENE_ID
    : allScenes[0]) as SceneId

  if (!converged) {
    // 回归用户：完整展示，无折叠。
    return {
      signature,
      collapsed: [],
      createEntriesCollapsed: false,
      panelOpen: true,
      visibleScenes: [...allScenes],
    }
  }

  const collapsed = allScenes.filter((s) => s !== signature)
  return {
    signature,
    collapsed,
    createEntriesCollapsed: true,
    panelOpen,
    visibleScenes: panelOpen ? [...allScenes] : [signature],
  }
}

/** 「全部体验」展开后，场景总数必须等于全部场景数（验收：6 建筑入口仍可达）。 */
export function allScenesReachableWhenOpen(layout: RoomEntryLayout, allScenes: SceneId[] = ALL_SCENES): boolean {
  const expected = new Set(allScenes)
  const shown = new Set(layout.visibleScenes)
  return expected.size === shown.size && [...expected].every((s) => shown.has(s))
}

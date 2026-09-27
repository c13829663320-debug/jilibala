/**
 * R5 渐进披露 Feature Gates（纯函数，可单测）。
 *
 * 策略：新手期（前 NEWBIE_SESSION_THRESHOLD 次会话）隐藏/灰化高级入口
 * （自定义角色、场景工作室、狼人杀等复杂玩法），UI 上显示「解锁中」提示。
 * 判断依据：① 新手引导是否完成/跳过；② 累计会话次数。
 *
 * 纯函数：不读 localStorage、不碰 React，宿主（useOnboarding hook）把状态传进来。
 */
import type { R5OnboardingState } from '@balabala/shared'

/** 高级入口 id——与导航层的菜单项一一对应。 */
export type AdvancedEntryId = 'custom-character' | 'scene-studio' | 'werewolf'

/** 一个高级入口在当前引导/会话阶段的可见性与锁定状态。 */
export interface EntryGate {
  /** 是否在导航里渲染（引导未完成时直接隐藏，避免新手看到一堆灰按钮）。 */
  visible: boolean
  /** 是否锁定（灰化、不可点、显示「解锁中」）。 */
  locked: boolean
  /** 解锁提示文案；已解锁时为空串。 */
  unlockHint: string
}

/** 新手期会话阈值：前 3 次会话内高级入口保持锁定。 */
export const NEWBIE_SESSION_THRESHOLD = 3

/** 新手期判断：会话次数是否还在「前 3 次」内。 */
export function isNewbieSession(sessionCount: number): boolean {
  return sessionCount < NEWBIE_SESSION_THRESHOLD
}

/**
 * 计算某个高级入口的门控状态。
 * - 引导未完成/未跳过：入口整体隐藏（visible=false），走完引导后才出现。
 * - 引导完成但仍在新手期：入口可见但锁定，提示「再体验 N 次后解锁」。
 * - 引导完成且会话数达标：解锁。
 */
export function getEntryGate(
  entry: AdvancedEntryId,
  state: R5OnboardingState,
): EntryGate {
  void entry // 目前所有高级入口用同一套阈值；预留按 entry 差异化的扩展点
  const onboarded = state.completed || state.skipped
  if (!onboarded) {
    return { visible: false, locked: true, unlockHint: '完成新手引导后解锁' }
  }
  if (isNewbieSession(state.sessionCount)) {
    const left = NEWBIE_SESSION_THRESHOLD - state.sessionCount
    return { visible: true, locked: true, unlockHint: `再体验 ${left} 次后解锁` }
  }
  return { visible: true, locked: false, unlockHint: '' }
}

/** 快捷判断：某入口是否可点击（已解锁）。 */
export function isEntryUnlocked(entry: AdvancedEntryId, state: R5OnboardingState): boolean {
  return !getEntryGate(entry, state).locked
}

/** 批量取所有高级入口的门控状态（供导航层一次性渲染）。 */
export function getAllEntryGates(state: R5OnboardingState): Record<AdvancedEntryId, EntryGate> {
  return {
    'custom-character': getEntryGate('custom-character', state),
    'scene-studio': getEntryGate('scene-studio', state),
    werewolf: getEntryGate('werewolf', state),
  }
}

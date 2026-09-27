/**
 * R5 新手体验 · 首启动线路由编排（纯函数，可在 node 环境单测）
 *
 * 职责：根据 onboarding-store 的 phase 状态机 + IdentityProvider 的身份阶段，
 * 决定 App 当前该渲染哪一层（开屏 / 兴趣 / 推荐卡片 / 主界面）。
 * 不依赖 React，不读写 localStorage —— 输入 OnboardingState，输出路由决策。
 *
 * 动线（分片A）：
 *   splash → identity(建身份) → interest(选兴趣) → quickstart(推荐) → signature(法庭) → completed
 * 任意一步可跳过：skipFlow → 直接进 entry（RoomEntry），不再被引导打断。
 */

import type { OnboardingState } from './onboarding-store'

/** IdentityProvider 的阶段（与 identity.tsx 对齐，这里用最小子集，避免循环依赖）。 */
export type IdentityPhaseLite = 'loading' | 'setup' | 'ready' | 'error'

/**
 * 路由层：
 * - 'splash'     开屏页（SplashScreen），等用户点击进入
 * - 'none'       不渲染引导层：可能在身份 loading/setup（IdentityProvider 自己弹模态），
 *                或主流程已完成/跳过/进行到招牌体验，直接进主界面
 * - 'interest'   InterestPicker 选兴趣
 * - 'quickstart' QuickStartCard 推荐卡片 → 一个大按钮直达招牌体验
 */
export type OnboardingGate = 'splash' | 'none' | 'interest' | 'quickstart'

/**
 * 是否要展示开屏。仅全新用户（phase 仍在 splash 且主流程未完成）才看开屏；
 * 已完成 / 已跳过 / 中途刷新（phase 已推进）都不再二次播放开屏。
 */
export function shouldShowSplash(state: OnboardingState): boolean {
  return state.phase === 'splash' && !state.flowCompleted && !state.flowSkipped
}

/**
 * 根据状态机 + 身份阶段，决定当前渲染哪一层引导。
 *
 * 规则：
 *  1. 主流程已完成或已跳过（含回归老用户）→ 'none'，永不打断。
 *  2. 身份还在 loading / error → 'none'（IdentityProvider 自带 loading / 重试浮层）。
 *  3. 身份 setup（建身份弹窗）→ 'none'（SetupModal 由 IdentityProvider 渲染，App 不叠层）。
 *  4. 按 phase 分发：splash→'splash'，interest→'interest'，quickstart→'quickstart'，
 *     identity/signature/completed/skipped → 'none'。
 */
export function resolveOnboardingGate(
  state: OnboardingState,
  identityPhase: IdentityPhaseLite,
): OnboardingGate {
  // 规则 1：回归 / 跳过 / 完成 —— 直接进主界面
  if (state.flowCompleted || state.flowSkipped) return 'none'

  // 规则 2：身份未就绪（加载中 / 网络错误）—— 交给 IdentityProvider 的浮层
  if (identityPhase === 'loading' || identityPhase === 'error') return 'none'

  // 规则 3：身份 setup 中（SetupModal 正在收集昵称/化身）—— 不叠自己的引导
  if (identityPhase === 'setup') return 'none'

  // 规则 4：身份已 ready，按 onboarding phase 分发
  switch (state.phase) {
    case 'splash':
      return 'splash'
    case 'identity':
      // 身份刚建完 / 老身份恢复：等 effect 把 phase 推进到 interest，这里先不叠层
      return 'none'
    case 'interest':
      return 'interest'
    case 'quickstart':
      return 'quickstart'
    default:
      // signature / completed / skipped —— 主流程已进入招牌体验或收尾
      return 'none'
  }
}

/**
 * 引导步骤的轻量进度文案（如 "2 / 5"）。
 * currentStep 为 0-based 状态机步数；FLOW_TOTAL_STEPS=5。
 */
export function flowStepLabel(state: OnboardingState, totalSteps: number): string {
  return `${state.currentStep} / ${totalSteps}`
}

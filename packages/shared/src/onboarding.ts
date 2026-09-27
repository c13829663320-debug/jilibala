// ===== R5 新手引导（r5-onboarding 域） =====
// 前后端共用的引导状态机：纯类型 + 纯函数，无 IO / 无 React / 无 Date。
// 设计目标：3 分钟内首个哇时刻（和一位名人对话），零门槛在线体验。
//
// 线性流程（不含终态）：
//   welcome → identity → interest → first-celebrity-chat → first-court
//   splash 是开屏瞬态（由宿主 R5Onboarding 控制器在进入持久化流程前播放），不持久化。
//   first-court 为可选步骤；用户在任意一步「跳过」都直接落地广场并标记 skipped=true。
//
// 注意：本文件 additive，绝不修改 PlayerProfile.multiplayerTour 等已有定义；
// R5 引导状态独立存储（web 端 localStorage key=balabala.r5.onboarding.v1）。

/** 引导线性步骤（终态 'complete' 单独列出）。 */
export const R5_ONBOARDING_STEPS = [
  "welcome",
  "identity",
  "interest",
  "first-celebrity-chat",
  "first-court",
] as const;

export type R5OnboardingStep = (typeof R5_ONBOARDING_STEPS)[number] | "complete";

/** 用户选择的兴趣领域（对应 CelebrityField，用于推荐首位名人）。 */
export type R5InterestField = string;

/**
 * R5 新手引导持久化状态。所有字段带默认值，老存档 / 缺失字段向前兼容。
 * 服务端无需感知：这是纯客户端引导体验，独立 localStorage 存储。
 */
export interface R5OnboardingState {
  /** 当前进行到哪一步。 */
  step: R5OnboardingStep;
  /** 走完了完整引导链路。 */
  completed: boolean;
  /** 用户主动跳过整个引导（落地广场，不再触发）。 */
  skipped: boolean;
  /** 完成时间 ISO；跳过/未完成时为 null。 */
  completedAt: string | null;
  /** 已选兴趣领域（科技/文学/哲学…），null = 还没选。 */
  interestField: R5InterestField | null;
  /** 为用户推荐的首位名人 id（兴趣领域匹配），null = 还没推荐。 */
  recommendedCelebrityId: string | null;
  /** 累计会话次数（每次页面加载 +1），驱动渐进披露 feature gates。 */
  sessionCount: number;
  /** 首次核心体验是否已发生（和名人对话过 / 进过一场法庭）。 */
  firstWowDone: boolean;
}

/** 全新用户的初始状态。step 从 welcome 开始。 */
export function createInitialR5Onboarding(): R5OnboardingState {
  return {
    step: "welcome",
    completed: false,
    skipped: false,
    completedAt: null,
    interestField: null,
    recommendedCelebrityId: null,
    sessionCount: 0,
    firstWowDone: false,
  };
}

/**
 * 是否已经走完或跳过引导——老用户 / 跳过后不再触发引导。
 * completed 与 skipped 任一为真都视为引导结束。
 */
export function isR5OnboardingDone(state: R5OnboardingState): boolean {
  return state.completed || state.skipped;
}

/**
 * 是否需要展示引导：未完成且未跳过。
 * 已完成用户（包括跳过）永远不再触发。
 */
export function shouldShowR5Onboarding(state: R5OnboardingState): boolean {
  return !isR5OnboardingDone(state);
}

/**
 * 前进到下一步。纯函数，返回新状态。
 * - 已完成/跳过：原样返回。
 * - 走完最后一步 first-court：进入 'complete' 并标记 completed。
 * - 其他：按 R5_ONBOARDING_STEPS 顺序推进一格。
 * completedAt 由宿主在真正完成时通过 completeR5Onboarding 注入，本函数不碰时间。
 */
export function nextR5Step(state: R5OnboardingState): R5OnboardingState {
  if (isR5OnboardingDone(state)) return state;
  const idx = (R5_ONBOARDING_STEPS as readonly R5OnboardingStep[]).indexOf(state.step);
  if (idx < 0) {
    // 终态或异常 step：直接收尾为完成。
    return { ...state, step: "complete", completed: true };
  }
  if (idx >= R5_ONBOARDING_STEPS.length - 1) {
    // 最后一步走完 → 完成。
    return { ...state, step: "complete", completed: true };
  }
  return { ...state, step: R5_ONBOARDING_STEPS[idx + 1] };
}

/** 主动完成引导（用户走完首条核心体验后）。 */
export function completeR5Onboarding(
  state: R5OnboardingState,
  completedAt: string,
): R5OnboardingState {
  return { ...state, step: "complete", completed: true, skipped: false, completedAt };
}

/**
 * 跳过整个引导：落地广场，不再触发。
 * skipped=true 同时令 isR5OnboardingDone 返回 true（防重复触发）。
 */
export function skipR5Onboarding(state: R5OnboardingState): R5OnboardingState {
  return { ...state, skipped: true, completed: true };
}

/** 记录已选兴趣领域 + 推荐的首位名人 id。返回新状态。 */
export function recordR5Interest(
  state: R5OnboardingState,
  field: R5InterestField,
  celebrityId: string | null,
): R5OnboardingState {
  return { ...state, interestField: field, recommendedCelebrityId: celebrityId };
}

/** 记录首个哇时刻已发生（和名人对话过 / 进过一场法庭）。 */
export function markR5FirstWow(state: R5OnboardingState): R5OnboardingState {
  return state.firstWowDone ? state : { ...state, firstWowDone: true };
}

/** 新的一次会话（页面加载）：sessionCount +1。 */
export function bumpR5Session(state: R5OnboardingState): R5OnboardingState {
  return { ...state, sessionCount: state.sessionCount + 1 };
}

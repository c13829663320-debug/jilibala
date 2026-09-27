/**
 * R5 新手体验统一状态机（onboarding-store）
 *
 * 在现有 onboardingProgress.ts 基础上统一管理：
 *  - 主流程 phase：splash → identity → interest → quickstart → signature → completed / skipped
 *  - 首次事件标志（plaza / multiplayer / creation / celebrity_chat），各触发一次引导
 *  - 首次奖励（firstWow），仅领取一次
 *  - 持久化到 localStorage，刷新/重开不重复触发
 *
 * 设计原则：
 *  - 纯函数 + 可选 Storage 注入，便于 vitest 单测
 *  - 向后兼容旧版 onboardingProgress 数据（读取时迁移）
 *  - 不依赖 React，可在组件外（路由层、事件回调）直接调用
 */

import {
  EMPTY_PROGRESS,
  MULTIPLAYER_TOUR_STEPS,
  ONBOARDING_STORAGE_KEY,
  loadProgress as loadLegacyProgress,
  type InterestId,
  type MultiplayerTourProgress,
  type SceneId,
} from './onboardingProgress'

// ===== 类型定义 =====

export type OnboardingPhase =
  | 'splash'       // 开屏页
  | 'identity'     // 建身份
  | 'interest'     // 选兴趣
  | 'quickstart'   // 推荐卡片
  | 'signature'    // 招牌体验进行中
  | 'completed'    // 主流程完成
  | 'skipped'      // 主流程已跳过

/** 首次事件 key —— 每个 key 对应的引导只触发一次 */
export type FirstTimeKey =
  | 'plaza'           // 首次进入 3D 广场
  | 'multiplayer'     // 首次进入多人房间
  | 'creation'        // 首次进入场景创作工作室
  | 'celebrity_chat'  // 首次与名人对话
  | 'court'           // 首次进入法庭（招牌体验）

export const FIRST_TIME_KEYS: FirstTimeKey[] = [
  'plaza', 'multiplayer', 'creation', 'celebrity_chat', 'court',
]

export interface OnboardingReward {
  /** 首个哇时刻奖励是否已领取 */
  firstWowClaimed: boolean
  firstWowClaimedAt: string | null
}

export interface OnboardingState {
  /** 主流程当前阶段 */
  phase: OnboardingPhase
  /** 主流程当前步骤序号（0-based），用于进度展示 */
  currentStep: number
  /** 已选兴趣（沿用旧字段） */
  selectedInterest: InterestId | null
  /** 用户跳过了兴趣选择 */
  interestSkipped: boolean
  /** 主流程是否已完成（走完或跳过均视为完成，不再自动触发） */
  flowCompleted: boolean
  /** 主流程是否被主动跳过（区别于自然走完） */
  flowSkipped: boolean
  /** 首次事件标志 */
  firstTimes: Record<FirstTimeKey, boolean>
  /** 奖励记录 */
  rewards: OnboardingReward
  /** 已玩过的场景（沿用旧字段） */
  playedScenes: SceneId[]
  /** 多人引导进度（沿用旧字段） */
  multiplayerTour: MultiplayerTourProgress
  updatedAt: string | null
}

// ===== 常量 =====

/** 主流程总步数（用于进度条）：splash(0) → identity(1) → interest(2) → quickstart(3) → signature(4) → completed */
export const FLOW_TOTAL_STEPS = 5

export const EMPTY_STATE: OnboardingState = {
  phase: 'splash',
  currentStep: 0,
  selectedInterest: null,
  interestSkipped: false,
  flowCompleted: false,
  flowSkipped: false,
  firstTimes: {
    plaza: false,
    multiplayer: false,
    creation: false,
    celebrity_chat: false,
    court: false,
  },
  rewards: {
    firstWowClaimed: false,
    firstWowClaimedAt: null,
  },
  playedScenes: [],
  multiplayerTour: { step: 0, done: false, skipped: false },
  updatedAt: null,
}

// ===== Storage 适配 =====

function defaultStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try { return window.localStorage } catch { return null }
}

function freshState(): OnboardingState {
  return {
    ...EMPTY_STATE,
    firstTimes: { ...EMPTY_STATE.firstTimes },
    rewards: { ...EMPTY_STATE.rewards },
    multiplayerTour: { ...EMPTY_STATE.multiplayerTour },
    playedScenes: [],
  }
}

// ===== 读取 / 写入 =====

/** 从 localStorage 读取统一状态；旧版数据自动迁移；损坏/缺失返回空状态（新用户）。 */
export function loadOnboardingState(storage?: Storage | null): OnboardingState {
  const store = storage ?? defaultStorage()
  if (!store) return freshState()
  try {
    const raw = store.getItem(ONBOARDING_STORAGE_KEY)
    if (!raw) return freshState()
    const parsed = JSON.parse(raw) as Partial<OnboardingState> & Record<string, unknown>

    // 迁移：旧版只有 selectedInterest / playedScenes / interestSkipped / multiplayerTour
    // 没有 phase / flowCompleted / firstTimes / rewards —— 视为已完成主流程的老用户
    const hasNewFields = typeof parsed.phase === 'string'
    const legacy = loadLegacyProgress(store)

    const firstTimes: Record<FirstTimeKey, boolean> = {
      plaza: parsed.firstTimes?.plaza === true,
      multiplayer: parsed.firstTimes?.multiplayer === true,
      creation: parsed.firstTimes?.creation === true,
      celebrity_chat: parsed.firstTimes?.celebrity_chat === true,
      court: parsed.firstTimes?.court === true,
    }

    const state: OnboardingState = {
      phase: hasNewFields ? (parsed.phase as OnboardingPhase) : 'completed',
      currentStep: typeof parsed.currentStep === 'number' ? parsed.currentStep : FLOW_TOTAL_STEPS,
      selectedInterest: legacy.selectedInterest,
      interestSkipped: legacy.interestSkipped,
      flowCompleted: hasNewFields ? parsed.flowCompleted === true : true,
      flowSkipped: hasNewFields ? parsed.flowSkipped === true : legacy.interestSkipped,
      firstTimes,
      rewards: {
        firstWowClaimed: parsed.rewards?.firstWowClaimed === true,
        firstWowClaimedAt: typeof parsed.rewards?.firstWowClaimedAt === 'string' ? parsed.rewards.firstWowClaimedAt : null,
      },
      playedScenes: legacy.playedScenes,
      multiplayerTour: {
        step: typeof legacy.multiplayerTour?.step === 'number'
          ? Math.max(0, Math.min(MULTIPLAYER_TOUR_STEPS.length - 1, Math.floor(legacy.multiplayerTour.step)))
          : 0,
        done: legacy.multiplayerTour?.done === true,
        skipped: legacy.multiplayerTour?.skipped === true,
      },
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : null,
    }
    return state
  } catch {
    return freshState()
  }
}

export function saveOnboardingState(state: OnboardingState, storage?: Storage | null): void {
  const store = storage ?? defaultStorage()
  if (!store) return
  try {
    store.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({ ...state, updatedAt: new Date().toISOString() }))
  } catch {
    /* storage may be unavailable (private mode / quota) */
  }
}

// ===== 纯函数 reducer（返回新状态，不自动持久化） =====

const PHASE_ORDER: OnboardingPhase[] = ['splash', 'identity', 'interest', 'quickstart', 'signature', 'completed']

function phaseIndex(phase: OnboardingPhase): number {
  const idx = PHASE_ORDER.indexOf(phase)
  return idx === -1 ? PHASE_ORDER.length : idx
}

/** 推进到下一阶段；已 completed/skipped 不再回退。推进到 completed 自动标记 flowCompleted。 */
export function advancePhase(state: OnboardingState, next: OnboardingPhase): OnboardingState {
  if (state.flowCompleted || state.flowSkipped) return state
  // 不允许回退
  if (phaseIndex(next) <= phaseIndex(state.phase)) return state
  const step = Math.min(phaseIndex(next), FLOW_TOTAL_STEPS - 1)
  const isCompleted = next === 'completed'
  return {
    ...state,
    phase: next,
    currentStep: isCompleted ? FLOW_TOTAL_STEPS : step,
    flowCompleted: isCompleted ? true : state.flowCompleted,
  }
}

/** 跳过整个主流程：标记 skipped + flowCompleted，阶段设为 skipped。 */
export function skipFlow(state: OnboardingState): OnboardingState {
  return { ...state, phase: 'skipped', flowSkipped: true, flowCompleted: true, currentStep: FLOW_TOTAL_STEPS }
}

/** 自然完成主流程（走完招牌体验后）。 */
export function completeFlow(state: OnboardingState): OnboardingState {
  return { ...state, phase: 'completed', flowCompleted: true, flowSkipped: false, currentStep: FLOW_TOTAL_STEPS }
}

/** 记录兴趣选择。 */
export function selectInterest(state: OnboardingState, interest: InterestId): OnboardingState {
  return { ...state, selectedInterest: interest, interestSkipped: false }
}

/** 标记某个首次事件已发生（对应引导不再触发）。 */
export function markFirstTime(state: OnboardingState, key: FirstTimeKey): OnboardingState {
  if (state.firstTimes[key]) return state
  return { ...state, firstTimes: { ...state.firstTimes, [key]: true } }
}

/** 是否需要展示某个首次引导。 */
export function needsFirstTimeGuide(state: OnboardingState, key: FirstTimeKey): boolean {
  return !state.firstTimes[key]
}

/** 记录场景已玩过（去重）。 */
export function recordScenePlayed(state: OnboardingState, scene: SceneId): OnboardingState {
  if (state.playedScenes.includes(scene)) return state
  return { ...state, playedScenes: [...state.playedScenes, scene] }
}

/** 领取首次哇时刻奖励；已领取则不重复。返回 { state, claimed }。 */
export function claimFirstWowReward(state: OnboardingState): { state: OnboardingState; claimed: boolean } {
  if (state.rewards.firstWowClaimed) return { state, claimed: false }
  return {
    state: {
      ...state,
      rewards: { firstWowClaimed: true, firstWowClaimedAt: new Date().toISOString() },
    },
    claimed: true,
  }
}

/** 重置全部状态（测试用 / 设置里重新引导）。 */
export function resetOnboarding(state?: OnboardingState): OnboardingState {
  return freshState()
}

// ===== 便捷 action（自动持久化） =====

function mutate(storage: Storage | null | undefined, fn: (s: OnboardingState) => OnboardingState): OnboardingState {
  const state = loadOnboardingState(storage)
  const next = fn(state)
  saveOnboardingState(next, storage)
  return next
}

export const onboardingActions = {
  advance: (next: OnboardingPhase, storage?: Storage | null) => mutate(storage, (s) => advancePhase(s, next)),
  skip: (storage?: Storage | null) => mutate(storage, skipFlow),
  complete: (storage?: Storage | null) => mutate(storage, completeFlow),
  selectInterest: (interest: InterestId, storage?: Storage | null) => mutate(storage, (s) => selectInterest(s, interest)),
  markFirstTime: (key: FirstTimeKey, storage?: Storage | null) => mutate(storage, (s) => markFirstTime(s, key)),
  recordScene: (scene: SceneId, storage?: Storage | null) => mutate(storage, (s) => recordScenePlayed(s, scene)),
  claimFirstWow: (storage?: Storage | null) => {
    const state = loadOnboardingState(storage)
    const { state: next, claimed } = claimFirstWowReward(state)
    saveOnboardingState(next, storage)
    return claimed
  },
  reset: (storage?: Storage | null) => mutate(storage, () => freshState()),
}

// ===== 派生查询 =====

/** 是否为全新用户（无任何持久化记录）。 */
export function isBrandNewUser(storage?: Storage | null): boolean {
  const state = loadOnboardingState(storage)
  return !state.flowCompleted && !state.flowSkipped && state.phase === 'splash'
}

/** 回归用户（主流程已完成）：直接进广场不被打断。 */
export function isReturningUser(storage?: Storage | null): boolean {
  const state = loadOnboardingState(storage)
  return state.flowCompleted
}

/** 主流程是否需要展示（未完成且未跳过）。 */
export function needsOnboardingFlow(storage?: Storage | null): boolean {
  const state = loadOnboardingState(storage)
  return !state.flowCompleted && !state.flowSkipped
}

/** 当前阶段（便捷查询）。 */
export function currentPhase(storage?: Storage | null): OnboardingPhase {
  return loadOnboardingState(storage).phase
}

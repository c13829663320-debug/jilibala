/**
 * R5 onboarding-store 单测
 * 覆盖：状态读写、phase 推进、跳过/完成、首次标志、奖励、旧数据迁移、持久化不重复触发
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_STATE,
  FLOW_TOTAL_STEPS,
  advancePhase,
  claimFirstWowReward,
  completeFlow,
  currentPhase,
  isBrandNewUser,
  isReturningUser,
  loadOnboardingState,
  markFirstTime,
  needsFirstTimeGuide,
  needsOnboardingFlow,
  onboardingActions,
  recordScenePlayed,
  resetOnboarding,
  selectInterest,
  skipFlow,
  type FirstTimeKey,
  type OnboardingPhase,
  type OnboardingState,
} from './onboarding-store'
import { ONBOARDING_STORAGE_KEY } from './onboardingProgress'

function makeMemoryStorage(): Storage {
  const map = new Map<string, string>()
  return {
    get length() { return map.size },
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => { map.set(k, String(v)) },
    removeItem: (k: string) => { map.delete(k) },
    clear: () => { map.clear() },
  }
}

describe('onboarding-store 基础读写', () => {
  it('无记录时返回空状态，phase=splash，视为全新用户', () => {
    const store = makeMemoryStorage()
    const state = loadOnboardingState(store)
    expect(state).toEqual({ ...EMPTY_STATE, firstTimes: { ...EMPTY_STATE.firstTimes }, rewards: { ...EMPTY_STATE.rewards }, multiplayerTour: { ...EMPTY_STATE.multiplayerTour }, playedScenes: [] })
    expect(isBrandNewUser(store)).toBe(true)
    expect(isReturningUser(store)).toBe(false)
    expect(needsOnboardingFlow(store)).toBe(true)
  })

  it('注入 null storage（node 环境）降级为空状态，不抛错', () => {
    expect(loadOnboardingState(null).phase).toBe('splash')
    expect(isBrandNewUser(null)).toBe(true)
    onboardingActions.advance('identity', null) // 不应抛错
    expect(loadOnboardingState(null).phase).toBe('splash') // null storage 不持久化
  })

  it('损坏 JSON 自动回退空状态', () => {
    const store = makeMemoryStorage()
    store.setItem(ONBOARDING_STORAGE_KEY, '{{{bad-json')
    expect(loadOnboardingState(store).phase).toBe('splash')
  })
})

describe('phase 状态机推进', () => {
  it('按顺序推进：splash → identity → interest → quickstart → signature → completed', () => {
    let s: OnboardingState = fresh()
    const phases: OnboardingPhase[] = ['splash', 'identity', 'interest', 'quickstart', 'signature']
    for (const p of phases) {
      expect(s.phase).toBe(p)
      s = advancePhase(s, p === 'signature' ? 'completed' : phases[phases.indexOf(p) + 1])
    }
    expect(s.phase).toBe('completed')
    expect(s.flowCompleted).toBe(true)
    expect(s.currentStep).toBe(FLOW_TOTAL_STEPS)
  })

  it('不允许回退：已到 quickstart 不能退回 interest', () => {
    let s = fresh()
    s = advancePhase(s, 'identity')
    s = advancePhase(s, 'interest')
    s = advancePhase(s, 'quickstart')
    const before = s.phase
    s = advancePhase(s, 'interest') // 尝试回退
    expect(s.phase).toBe(before)
  })

  it('已 completed/skipped 后 advance 不再改变状态', () => {
    let s = fresh()
    s = completeFlow(s)
    const after = advancePhase(s, 'signature')
    expect(after).toBe(s) // 同一引用（无变化）
  })

  it('skipFlow 标记 flowSkipped + flowCompleted，阶段为 skipped', () => {
    const s = skipFlow(fresh())
    expect(s.phase).toBe('skipped')
    expect(s.flowSkipped).toBe(true)
    expect(s.flowCompleted).toBe(true)
    expect(needsOnboardingFlowFromState(s)).toBe(false)
  })

  it('completeFlow 标记 flowCompleted 但 flowSkipped=false', () => {
    const s = completeFlow(fresh())
    expect(s.phase).toBe('completed')
    expect(s.flowCompleted).toBe(true)
    expect(s.flowSkipped).toBe(false)
  })
})

describe('首次事件标志', () => {
  it('markFirstTime 幂等：重复标记不改变状态', () => {
    let s = fresh()
    s = markFirstTime(s, 'plaza')
    expect(s.firstTimes.plaza).toBe(true)
    const before = s
    s = markFirstTime(s, 'plaza')
    expect(s).toBe(before)
  })

  it('needsFirstTimeGuide 未标记为 true，已标记为 false', () => {
    const s = fresh()
    expect(needsFirstTimeGuide(s, 'multiplayer')).toBe(true)
    const marked = markFirstTime(s, 'multiplayer')
    expect(needsFirstTimeGuide(marked, 'multiplayer')).toBe(false)
  })

  it('5 个首次 key 相互独立', () => {
    let s = fresh()
    const keys: FirstTimeKey[] = ['plaza', 'multiplayer', 'creation', 'celebrity_chat', 'court']
    for (const k of keys) {
      expect(needsFirstTimeGuide(s, k)).toBe(true)
      s = markFirstTime(s, k)
      expect(needsFirstTimeGuide(s, k)).toBe(false)
    }
    // 全部标记后
    for (const k of keys) expect(s.firstTimes[k]).toBe(true)
  })
})

describe('首次奖励', () => {
  it('claimFirstWowReward 首次领取返回 claimed=true，后续返回 false', () => {
    let s = fresh()
    let result = claimFirstWowReward(s)
    expect(result.claimed).toBe(true)
    expect(result.state.rewards.firstWowClaimed).toBe(true)
    expect(result.state.rewards.firstWowClaimedAt).not.toBeNull()
    s = result.state
    result = claimFirstWowReward(s)
    expect(result.claimed).toBe(false)
    expect(result.state).toBe(s) // 无变化
  })
})

describe('场景记录', () => {
  it('recordScenePlayed 去重', () => {
    let s = fresh()
    s = recordScenePlayed(s, 'court')
    s = recordScenePlayed(s, 'court')
    s = recordScenePlayed(s, 'talkshow')
    expect(s.playedScenes).toEqual(['court', 'talkshow'])
  })
})

describe('持久化与不重复触发', () => {
  it('onboardingActions 自动持久化，刷新后状态保留', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    onboardingActions.selectInterest('debate', store)
    // 模拟刷新：重新读取
    const state = loadOnboardingState(store)
    expect(state.phase).toBe('interest')
    expect(state.selectedInterest).toBe('debate')
    expect(state.flowCompleted).toBe(false)
  })

  it('skip 后 needsOnboardingFlow 为 false，回归用户判定为 true', () => {
    const store = makeMemoryStorage()
    onboardingActions.skip(store)
    expect(needsOnboardingFlow(store)).toBe(false)
    expect(isReturningUser(store)).toBe(true)
    expect(isBrandNewUser(store)).toBe(false)
  })

  it('complete 后 currentPhase 为 completed', () => {
    const store = makeMemoryStorage()
    onboardingActions.complete(store)
    expect(currentPhase(store)).toBe('completed')
  })

  it('claimFirstWow action 只领取一次', () => {
    const store = makeMemoryStorage()
    expect(onboardingActions.claimFirstWow(store)).toBe(true)
    expect(onboardingActions.claimFirstWow(store)).toBe(false)
  })

  it('reset 后恢复全新用户状态', () => {
    const store = makeMemoryStorage()
    onboardingActions.complete(store)
    onboardingActions.markFirstTime('plaza', store)
    expect(isReturningUser(store)).toBe(true)
    onboardingActions.reset(store)
    expect(isBrandNewUser(store)).toBe(true)
    expect(loadOnboardingState(store).firstTimes.plaza).toBe(false)
  })
})

describe('旧版数据迁移', () => {
  it('旧版只有 selectedInterest/playedScenes 的数据迁移为 completed 老用户', () => {
    const store = makeMemoryStorage()
    const legacy = {
      selectedInterest: 'debate',
      playedScenes: ['court', 'talkshow'],
      interestSkipped: false,
      multiplayerTour: { step: 0, done: false, skipped: false },
      updatedAt: '2025-01-01T00:00:00.000Z',
    }
    store.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(legacy))
    const state = loadOnboardingState(store)
    expect(state.phase).toBe('completed')
    expect(state.flowCompleted).toBe(true)
    expect(state.selectedInterest).toBe('debate')
    expect(state.playedScenes).toEqual(['court', 'talkshow'])
    expect(isReturningUser(store)).toBe(true)
  })

  it('旧版 interestSkipped=true 迁移为 flowSkipped=true', () => {
    const store = makeMemoryStorage()
    store.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify({
      selectedInterest: null,
      playedScenes: [],
      interestSkipped: true,
      multiplayerTour: { step: 0, done: false, skipped: false },
    }))
    const state = loadOnboardingState(store)
    expect(state.flowSkipped).toBe(true)
    expect(state.flowCompleted).toBe(true)
  })
})

// helper
function fresh(): OnboardingState {
  return resetOnboarding()
}

function needsOnboardingFlowFromState(s: OnboardingState): boolean {
  return !s.flowCompleted && !s.flowSkipped
}

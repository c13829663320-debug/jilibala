/**
 * R5 分片A · 首启动线路由编排单测
 *
 * 覆盖：
 *  - shouldShowSplash：仅全新用户播开屏，回归 / 中途刷新不二次播放
 *  - resolveOnboardingGate：phase 状态机 × IdentityProvider 阶段 → 渲染层
 *  - 全新用户动线：splash → identity → interest → quickstart → signature → completed
 *  - 跳过路径：兴趣/推荐卡片跳过 → flowSkipped + flowCompleted → 直达入口
 *  - 回归用户不触发：完成/跳过后刷新不再弹引导
 *  - 刷新后状态保留：中途刷新从中断点恢复，不回到开屏
 *  - 法庭首次事件 + 首个哇时刻奖励幂等
 *
 * 用内存 Storage 注入，node 环境纯逻辑测试（与 onboarding-store.test.ts 同模式）。
 */
import { describe, expect, it } from 'vitest'
import {
  FLOW_TOTAL_STEPS,
  loadOnboardingState,
  needsFirstTimeGuide,
  onboardingActions,
} from './onboarding-store'
import {
  flowStepLabel,
  resolveOnboardingGate,
  shouldShowSplash,
  type IdentityPhaseLite,
} from './onboarding-routing'

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

describe('shouldShowSplash（开屏是否播放）', () => {
  it('全新用户（phase=splash，未完成）播放开屏', () => {
    const store = makeMemoryStorage()
    expect(shouldShowSplash(loadOnboardingState(store))).toBe(true)
  })

  it('回归老用户（flowCompleted）不播开屏', () => {
    const store = makeMemoryStorage()
    onboardingActions.complete(store)
    expect(shouldShowSplash(loadOnboardingState(store))).toBe(false)
  })

  it('已跳过的用户不播开屏', () => {
    const store = makeMemoryStorage()
    onboardingActions.skip(store)
    expect(shouldShowSplash(loadOnboardingState(store))).toBe(false)
  })

  it('中途刷新（phase 已推进到 interest，但未完成）不二次播放开屏', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    const state = loadOnboardingState(store)
    expect(state.phase).toBe('interest')
    expect(shouldShowSplash(state)).toBe(false)
  })
})

describe('resolveOnboardingGate（渲染层决策）', () => {
  it('全新用户 + 身份 ready + phase=splash → splash', () => {
    const store = makeMemoryStorage()
    expect(resolveOnboardingGate(loadOnboardingState(store), 'ready')).toBe('splash')
  })

  it('身份 loading / error 时不叠引导层（交给 IdentityProvider 浮层）', () => {
    const store = makeMemoryStorage()
    expect(resolveOnboardingGate(loadOnboardingState(store), 'loading')).toBe('none')
    expect(resolveOnboardingGate(loadOnboardingState(store), 'error')).toBe('none')
  })

  it('身份 setup（建身份弹窗）时不叠自己的引导层', () => {
    const store = makeMemoryStorage()
    // splash 已点掉，phase=identity，身份还在 setup 收集昵称
    onboardingActions.advance('identity', store)
    expect(resolveOnboardingGate(loadOnboardingState(store), 'setup')).toBe('none')
  })

  it('phase=interest + 身份 ready → interest', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    expect(resolveOnboardingGate(loadOnboardingState(store), 'ready')).toBe('interest')
  })

  it('phase=quickstart + 身份 ready → quickstart', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    onboardingActions.selectInterest('debate', store)
    onboardingActions.advance('quickstart', store)
    expect(resolveOnboardingGate(loadOnboardingState(store), 'ready')).toBe('quickstart')
  })

  it('phase=signature（招牌体验进行中）→ none（进入主界面）', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    onboardingActions.advance('quickstart', store)
    onboardingActions.advance('signature', store)
    expect(resolveOnboardingGate(loadOnboardingState(store), 'ready')).toBe('none')
  })

  it('主流程已完成 / 已跳过 → 无论 phase 如何都 none，永不打断', () => {
    const store = makeMemoryStorage()
    onboardingActions.complete(store)
    expect(resolveOnboardingGate(loadOnboardingState(store), 'ready')).toBe('none')
    expect(resolveOnboardingGate(loadOnboardingState(store), 'setup')).toBe('none')

    const skipped = makeMemoryStorage()
    onboardingActions.skip(skipped)
    expect(resolveOnboardingGate(loadOnboardingState(skipped), 'ready')).toBe('none')
  })
})

describe('全新用户动线（splash→identity→interest→quickstart→signature→completed）', () => {
  it('按状态机逐步推进，每步 gate 正确，3-5 步可达招牌体验', () => {
    const store = makeMemoryStorage()

    // 1) 开屏
    let s = loadOnboardingState(store)
    expect(s.phase).toBe('splash')
    expect(resolveOnboardingGate(s, 'ready')).toBe('splash')

    // 2) 点击开屏 → identity
    s = onboardingActions.advance('identity', store)
    expect(s.phase).toBe('identity')
    expect(resolveOnboardingGate(s, 'setup')).toBe('none') // 建身份弹窗接管

    // 3) 身份建完 ready → interest
    s = onboardingActions.advance('interest', store)
    expect(s.phase).toBe('interest')
    expect(resolveOnboardingGate(s, 'ready')).toBe('interest')

    // 4) 选兴趣 → quickstart
    s = onboardingActions.selectInterest('debate', store)
    s = onboardingActions.advance('quickstart', store)
    expect(s.phase).toBe('quickstart')
    expect(s.selectedInterest).toBe('debate')
    expect(resolveOnboardingGate(s, 'ready')).toBe('quickstart')

    // 5) 立即开始 → signature 并完成主流程
    s = onboardingActions.advance('signature', store)
    expect(s.phase).toBe('signature')
    s = onboardingActions.complete(store)
    expect(s.phase).toBe('completed')
    expect(s.flowCompleted).toBe(true)
    expect(s.currentStep).toBe(FLOW_TOTAL_STEPS)
    expect(resolveOnboardingGate(s, 'ready')).toBe('none')
  })

  it('flowStepLabel 输出 "currentStep / total"', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    expect(flowStepLabel(loadOnboardingState(store), FLOW_TOTAL_STEPS)).toBe(`2 / ${FLOW_TOTAL_STEPS}`)
  })
})

describe('跳过路径', () => {
  it('兴趣页跳过 → flowSkipped+flowCompleted → 直达入口，不再弹引导', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    expect(resolveOnboardingGate(loadOnboardingState(store), 'ready')).toBe('interest')

    const s = onboardingActions.skip(store)
    expect(s.flowSkipped).toBe(true)
    expect(s.flowCompleted).toBe(true)
    expect(resolveOnboardingGate(s, 'ready')).toBe('none')
    expect(shouldShowSplash(s)).toBe(false)
  })

  it('推荐卡片跳过同样结束主流程', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    onboardingActions.advance('quickstart', store)
    const s = onboardingActions.skip(store)
    expect(s.flowSkipped).toBe(true)
    expect(resolveOnboardingGate(s, 'ready')).toBe('none')
  })
})

describe('回归用户不触发 + 刷新后状态保留', () => {
  it('完成后刷新：flowCompleted=true，gate=none，不播开屏', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    onboardingActions.selectInterest('debate', store)
    onboardingActions.advance('quickstart', store)
    onboardingActions.complete(store)

    // 模拟刷新：重新从 storage 读
    const reloaded = loadOnboardingState(store)
    expect(reloaded.flowCompleted).toBe(true)
    expect(resolveOnboardingGate(reloaded, 'ready')).toBe('none')
    expect(shouldShowSplash(reloaded)).toBe(false)
    expect(reloaded.selectedInterest).toBe('debate')
  })

  it('跳过之后刷新：仍为 skipped，不再弹兴趣选择', () => {
    const store = makeMemoryStorage()
    onboardingActions.skip(store)
    const reloaded = loadOnboardingState(store)
    expect(reloaded.flowSkipped).toBe(true)
    expect(resolveOnboardingGate(reloaded, 'ready')).toBe('none')
  })

  it('中途刷新（选完兴趣、还没点开始）：从 quickstart 断点恢复，不回到开屏', () => {
    const store = makeMemoryStorage()
    onboardingActions.advance('identity', store)
    onboardingActions.advance('interest', store)
    onboardingActions.selectInterest('funny', store)
    onboardingActions.advance('quickstart', store)

    const reloaded = loadOnboardingState(store)
    expect(reloaded.flowCompleted).toBe(false)
    expect(shouldShowSplash(reloaded)).toBe(false)       // 不重播开屏
    expect(resolveOnboardingGate(reloaded, 'ready')).toBe('quickstart') // 恢复推荐卡片
    expect(reloaded.selectedInterest).toBe('funny')
  })
})

describe('法庭首次事件 + 首个哇时刻', () => {
  it('首次进法庭标记 court，needsFirstTimeGuide 转 false；奖励只领一次', () => {
    const store = makeMemoryStorage()
    let s = loadOnboardingState(store)
    expect(needsFirstTimeGuide(s, 'court')).toBe(true)

    s = onboardingActions.markFirstTime('court', store)
    expect(needsFirstTimeGuide(s, 'court')).toBe(false)

    // claimFirstWow action 幂等
    expect(onboardingActions.claimFirstWow(store)).toBe(true)
    expect(onboardingActions.claimFirstWow(store)).toBe(false)
  })

  it('奖励领取状态刷新后保留（不重复弹哇时刻）', () => {
    const store = makeMemoryStorage()
    expect(onboardingActions.claimFirstWow(store)).toBe(true)
    const reloaded = loadOnboardingState(store)
    expect(reloaded.rewards.firstWowClaimed).toBe(true)
    expect(onboardingActions.claimFirstWow(store)).toBe(false)
  })
})

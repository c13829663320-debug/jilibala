/**
 * R5 新手引导状态机纯逻辑单测（运行在 apps/web vitest，import @balabala/shared 源码）。
 * 覆盖：线性流转 / 完成判定 / 跳过与防重复触发 / 兴趣与首哇记录 / 会话计数。
 */
import { describe, expect, it } from 'vitest'
import {
  R5_ONBOARDING_STEPS,
  bumpR5Session,
  completeR5Onboarding,
  createInitialR5Onboarding,
  isR5OnboardingDone,
  markR5FirstWow,
  nextR5Step,
  recordR5Interest,
  shouldShowR5Onboarding,
  skipR5Onboarding,
} from '@balabala/shared'

describe('R5 引导初始状态', () => {
  it('新用户从 welcome 开始，需要展示引导', () => {
    const s = createInitialR5Onboarding()
    expect(s.step).toBe('welcome')
    expect(s.completed).toBe(false)
    expect(s.skipped).toBe(false)
    expect(isR5OnboardingDone(s)).toBe(false)
    expect(shouldShowR5Onboarding(s)).toBe(true)
    expect(s.interestField).toBeNull()
    expect(s.sessionCount).toBe(0)
  })
})

describe('R5 引导线性流转 nextStep', () => {
  it('按 welcome→identity→interest→first-celebrity-chat→first-court 顺序推进', () => {
    let s = createInitialR5Onboarding()
    const seen: string[] = [s.step]
    for (let i = 0; i < R5_ONBOARDING_STEPS.length - 1; i++) {
      s = nextR5Step(s)
      seen.push(s.step)
    }
    expect(seen).toEqual([...R5_ONBOARDING_STEPS])
  })

  it('走完最后一步自动进入 complete 并标记 completed', () => {
    let s = createInitialR5Onboarding()
    for (let i = 0; i < R5_ONBOARDING_STEPS.length; i++) s = nextR5Step(s)
    expect(s.step).toBe('complete')
    expect(s.completed).toBe(true)
    expect(isR5OnboardingDone(s)).toBe(true)
    expect(shouldShowR5Onboarding(s)).toBe(false)
  })

  it('完成后 nextStep 是恒等操作（不重复推进）', () => {
    let s = createInitialR5Onboarding()
    for (let i = 0; i < R5_ONBOARDING_STEPS.length + 2; i++) s = nextR5Step(s)
    expect(s.step).toBe('complete')
    expect(s.completed).toBe(true)
  })
})

describe('R5 跳过与防重复触发', () => {
  it('跳过 → skipped=true，不再展示引导', () => {
    const s = createInitialR5Onboarding()
    const skipped = skipR5Onboarding(s)
    expect(skipped.skipped).toBe(true)
    expect(skipped.completed).toBe(true)
    expect(isR5OnboardingDone(skipped)).toBe(true)
    expect(shouldShowR5Onboarding(skipped)).toBe(false)
  })

  it('跳过后 nextStep 原样返回（不重新跑流程）', () => {
    const skipped = skipR5Onboarding(createInitialR5Onboarding())
    expect(nextR5Step(skipped)).toEqual(skipped)
  })

  it('已完成用户永远不再触发引导', () => {
    let s = createInitialR5Onboarding()
    s = completeR5Onboarding(s, '2026-09-27T00:00:00.000Z')
    expect(shouldShowR5Onboarding(s)).toBe(false)
    expect(s.completedAt).toBe('2026-09-27T00:00:00.000Z')
  })
})

describe('R5 兴趣 / 首哇 / 会话计数', () => {
  it('recordR5Interest 记录领域与推荐名人 id', () => {
    const s = recordR5Interest(createInitialR5Onboarding(), '文学', 'libai')
    expect(s.interestField).toBe('文学')
    expect(s.recommendedCelebrityId).toBe('libai')
  })

  it('markR5FirstWow 幂等', () => {
    const a = markR5FirstWow(createInitialR5Onboarding())
    expect(a.firstWowDone).toBe(true)
    const b = markR5FirstWow(a)
    expect(b).toEqual(a)
  })

  it('bumpR5Session 每次 +1', () => {
    let s = createInitialR5Onboarding()
    s = bumpR5Session(s)
    s = bumpR5Session(s)
    expect(s.sessionCount).toBe(2)
  })
})

/**
 * Feature gates 渐进披露纯逻辑单测：
 * 引导未完成 → 高级入口隐藏；引导完成但新手期 → 可见但锁定；会话达标 → 解锁。
 */
import { describe, expect, it } from 'vitest'
import {
  NEWBIE_SESSION_THRESHOLD,
  getAllEntryGates,
  getEntryGate,
  isEntryUnlocked,
  isNewbieSession,
} from './featureGates'
import {
  completeR5Onboarding,
  createInitialR5Onboarding,
  bumpR5Session,
  skipR5Onboarding,
  type R5OnboardingState,
} from '@balabala/shared'

function onboarded(sessionCount: number): R5OnboardingState {
  let s = completeR5Onboarding(createInitialR5Onboarding(), '2026-09-27T00:00:00.000Z')
  for (let i = 0; i < sessionCount; i++) s = bumpR5Session(s)
  return s
}

describe('新手期判定', () => {
  it('前 3 次会话为新手期，第 3 次起出新手期', () => {
    expect(isNewbieSession(0)).toBe(true)
    expect(isNewbieSession(2)).toBe(true)
    expect(isNewbieSession(NEWBIE_SESSION_THRESHOLD)).toBe(false)
  })
})

describe('引导未完成时', () => {
  it('所有高级入口整体隐藏（visible=false）', () => {
    const s = createInitialR5Onboarding()
    const gates = getAllEntryGates(s)
    for (const g of Object.values(gates)) {
      expect(g.visible).toBe(false)
      expect(g.locked).toBe(true)
    }
    expect(isEntryUnlocked('scene-studio', s)).toBe(false)
  })
})

describe('引导完成后的渐进披露', () => {
  it('第 1 次会话：入口可见但锁定，提示剩余次数', () => {
    const g = getEntryGate('werewolf', onboarded(1))
    expect(g.visible).toBe(true)
    expect(g.locked).toBe(true)
    expect(g.unlockHint).toContain('次后解锁')
  })

  it('第 2 次会话：仍锁定，剩余次数递减', () => {
    const g = getEntryGate('custom-character', onboarded(2))
    expect(g.locked).toBe(true)
    expect(g.unlockHint).toContain('1 次后解锁')
  })

  it('第 3 次会话：全部解锁', () => {
    const s = onboarded(NEWBIE_SESSION_THRESHOLD)
    expect(isEntryUnlocked('custom-character', s)).toBe(true)
    expect(isEntryUnlocked('scene-studio', s)).toBe(true)
    expect(isEntryUnlocked('werewolf', s)).toBe(true)
    for (const g of Object.values(getAllEntryGates(s))) {
      expect(g.locked).toBe(false)
      expect(g.unlockHint).toBe('')
    }
  })

  it('跳过引导也算 onboarded：跳过即出新手引导隐藏期', () => {
    const s = skipR5Onboarding(createInitialR5Onboarding())
    // 跳过时 sessionCount=0 → 仍新手期锁定，但 visible=true（不再隐藏）
    const g = getEntryGate('scene-studio', s)
    expect(g.visible).toBe(true)
    expect(g.locked).toBe(true)
  })
})

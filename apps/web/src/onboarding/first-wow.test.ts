/**
 * R5 分片B：首次奖励弹窗只触发一次的纯逻辑单测
 */
import { describe, expect, it } from 'vitest'
import { FIRST_WOW_CONTENT, shouldShowFirstWowDialog } from './first-wow'
import { onboardingActions } from './onboarding-store'

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

describe('FirstWowReward 只领一次', () => {
  it('claimFirstWow 首次 true → 弹窗；再次 false → 不弹窗', () => {
    const store = makeMemoryStorage()
    const first = onboardingActions.claimFirstWow(store)
    expect(shouldShowFirstWowDialog(first)).toBe(true)
    const second = onboardingActions.claimFirstWow(store)
    expect(shouldShowFirstWowDialog(second)).toBe(false)
  })

  it('奖励文案包含徽章名「初出茅庐」', () => {
    expect(FIRST_WOW_CONTENT.badge).toBe('初出茅庐')
    expect(FIRST_WOW_CONTENT.title).toContain('庭审')
  })
})

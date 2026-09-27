/**
 * useOnboarding 持久层单测：localStorage 读写往返 / 损坏 JSON 容错 / 完成后不重复触发。
 * 用内存 Storage 注入，node 环境运行。
 */
import { describe, expect, it } from 'vitest'
import {
  R5_ONBOARDING_STORAGE_KEY,
  loadR5State,
  saveR5State,
} from './useOnboarding'
import {
  completeR5Onboarding,
  createInitialR5Onboarding,
  shouldShowR5Onboarding,
  skipR5Onboarding,
} from '@balabala/shared'

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

describe('R5 引导持久层', () => {
  it('无记录时返回初始状态', () => {
    expect(loadR5State(makeMemoryStorage())).toEqual(createInitialR5Onboarding())
  })

  it('save → load 往返一致；损坏 JSON 回退初始状态', () => {
    const store = makeMemoryStorage()
    const done = completeR5Onboarding(
      { ...createInitialR5Onboarding(), interestField: '文学', recommendedCelebrityId: 'libai', sessionCount: 3 },
      '2026-09-27T00:00:00.000Z',
    )
    saveR5State(done, store)
    const back = loadR5State(store)
    expect(back.interestField).toBe('文学')
    expect(back.recommendedCelebrityId).toBe('libai')
    expect(back.sessionCount).toBe(3)
    expect(back.completed).toBe(true)

    store.setItem(R5_ONBOARDING_STORAGE_KEY, '{{{bad')
    expect(loadR5State(store)).toEqual(createInitialR5Onboarding())
  })

  it('完成后（completed/skipped）shouldShow 恒为 false——不重复触发', () => {
    expect(shouldShowR5Onboarding(completeR5Onboarding(createInitialR5Onboarding(), 'x'))).toBe(false)
    expect(shouldShowR5Onboarding(skipR5Onboarding(createInitialR5Onboarding()))).toBe(false)
  })

  it('null storage（node 环境）不抛错', () => {
    expect(loadR5State(null)).toEqual(createInitialR5Onboarding())
    saveR5State(createInitialR5Onboarding(), null)
  })
})

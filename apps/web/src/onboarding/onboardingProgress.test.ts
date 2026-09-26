/**
 * 新手引导进度的纯逻辑单测：
 * 1) localStorage 状态管理（读写 / 损坏容错 / 去重）
 * 2) 兴趣 → 场景映射
 * 3) 老用户跳过逻辑（有记录则不再弹兴趣选择、不重复弹场景引导）
 */
import { describe, expect, it } from 'vitest'
import {
  EMPTY_PROGRESS,
  FIRST_TIME_STEPS,
  INTEREST_SCENE_MAP,
  INTERESTS,
  ONBOARDING_STORAGE_KEY,
  getRecommendedScene,
  hasPlayedScene,
  isNewUser,
  loadProgress,
  needsInterestSelection,
  recordInterest,
  recordInterestSkipped,
  recordScenePlayed,
} from './onboardingProgress'

/** 内存版 Storage，模拟浏览器 localStorage。 */
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

describe('onboarding 状态管理', () => {
  it('没有任何记录时视为全新用户，返回空进度', () => {
    const store = makeMemoryStorage()
    expect(isNewUser(store)).toBe(true)
    expect(loadProgress(store)).toEqual({ ...EMPTY_PROGRESS })
  })

  it('recordInterest 写入后再读回；损坏 JSON 自动回退空进度', () => {
    const store = makeMemoryStorage()
    recordInterest('debate', store)
    expect(loadProgress(store).selectedInterest).toBe('debate')

    store.setItem(ONBOARDING_STORAGE_KEY, '{{{not-json')
    // 损坏后 loadProgress 回退空进度，而不是抛错
    expect(loadProgress(store).selectedInterest).toBeNull()
  })

  it('recordScenePlayed 去重：同一场景记录多次只出现一次', () => {
    const store = makeMemoryStorage()
    recordScenePlayed('court', store)
    recordScenePlayed('court', store)
    recordScenePlayed('talkshow', store)
    expect(loadProgress(store).playedScenes).toEqual(['court', 'talkshow'])
  })

  it('注入 null storage（node 环境）时全部降级为空进度，不抛错', () => {
    expect(isNewUser(null)).toBe(true)
    expect(needsInterestSelection(null)).toBe(true)
    expect(getRecommendedScene(null)).toBeNull()
    recordInterest('fitness', null) // 不应抛错
    expect(getRecommendedScene(null)).toBeNull()
  })
})

describe('兴趣 → 场景映射', () => {
  it('4 个兴趣都存在且各自映射到一个真实场景', () => {
    expect(INTERESTS.map((i) => i.id)).toEqual(['debate', 'funny', 'detective', 'fitness'])
    for (const interest of INTERESTS) {
      expect(['court', 'talkshow', 'werewolf', 'bar', 'gym', 'library']).toContain(INTEREST_SCENE_MAP[interest.id])
    }
  })

  it('映射语义正确：辩论→法庭，搞笑→脱口秀，推理→狼人杀，健身→健身房', () => {
    expect(INTEREST_SCENE_MAP.debate).toBe('court')
    expect(INTEREST_SCENE_MAP.funny).toBe('talkshow')
    expect(INTEREST_SCENE_MAP.detective).toBe('werewolf')
    expect(INTEREST_SCENE_MAP.fitness).toBe('gym')
  })

  it('记录兴趣后 getRecommendedScene 返回对应场景', () => {
    const store = makeMemoryStorage()
    recordInterest('funny', store)
    expect(getRecommendedScene(store)).toBe('talkshow')
  })

  it('每个场景的首次引导都不超过 3 步', () => {
    for (const steps of Object.values(FIRST_TIME_STEPS)) {
      expect(steps.length).toBeLessThanOrEqual(3)
    }
  })
})

describe('老用户跳过逻辑', () => {
  it('选过兴趣后：不再需要兴趣选择器，且 isNewUser 为 false', () => {
    const store = makeMemoryStorage()
    expect(needsInterestSelection(store)).toBe(true)
    recordInterest('detective', store)
    expect(isNewUser(store)).toBe(false)
    expect(needsInterestSelection(store)).toBe(false)
  })

  it('跳过兴趣选择后：老用户不再被 InterestPicker 打扰', () => {
    const store = makeMemoryStorage()
    recordInterestSkipped(store)
    expect(needsInterestSelection(store)).toBe(false)
    expect(isNewUser(store)).toBe(false)
  })

  it('玩过的场景不再弹 FirstTimeGuide；没玩过的仍要弹', () => {
    const store = makeMemoryStorage()
    recordInterest('debate', store)
    expect(hasPlayedScene('court', store)).toBe(false)
    recordScenePlayed('court', store)
    expect(hasPlayedScene('court', store)).toBe(true)
    expect(hasPlayedScene('talkshow', store)).toBe(false)
  })
})

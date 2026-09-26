import { describe, expect, it } from 'vitest'
import {
  createGameplayState,
  collectItem,
  checkReach,
  advanceQuest,
  isCompleted,
} from './gameplay'
import type { SceneBlueprint } from '@balabala/shared'

function makeBlueprint(overrides: Partial<SceneBlueprint> = {}): SceneBlueprint {
  return {
    terrain: {
      theme: 'plains',
      size: 60,
      heightSeed: 1,
      waterLevel: -1,
      weather: 'clear',
      light: 'day',
      params: {},
    },
    scatter: [],
    structures: [],
    npcs: [],
    gameplay: { template: 'explore', config: {} },
    spawnPoint: [0, 0, 0],
    bounds: [-30, -30, 30, 30],
    version: 1,
    ...overrides,
  }
}

describe('createGameplayState', () => {
  it('collect template: empty collected set, copies targets', () => {
    const bp = makeBlueprint({
      gameplay: {
        template: 'collect',
        config: { collectTargets: ['a', 'b', 'c'] },
      },
    })
    const s = createGameplayState(bp)
    expect(s.template).toBe('collect')
    expect(s.collected.size).toBe(0)
    expect(s.collectTargets).toEqual(['a', 'b', 'c'])
    expect(s.completed).toBe(false)
  })

  it('reach template: reached=false', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'reach', config: { goalPosition: [10, 0, 10] } },
    })
    const s = createGameplayState(bp)
    expect(s.template).toBe('reach')
    expect(s.reached).toBe(false)
  })

  it('quest template: step=0, total from config.questSteps', () => {
    const bp = makeBlueprint({
      gameplay: {
        template: 'quest',
        config: { questSteps: [{ id: 'q1', text: '第一步' }, { id: 'q2', text: '第二步' }] },
      },
    })
    const s = createGameplayState(bp)
    expect(s.questStep).toBe(0)
    expect(s.questTotal).toBe(2)
  })
})

describe('collectItem', () => {
  it('adds valid item to collected', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'collect', config: { collectTargets: ['a', 'b'] } },
    })
    const s0 = createGameplayState(bp)
    const s1 = collectItem(s0, 'a')
    expect(s1.collected.has('a')).toBe(true)
    expect(s1.collected.size).toBe(1)
    expect(s0.collected.size).toBe(0) // immutable
    expect(s1.completed).toBe(false)
  })

  it('ignores unknown item id', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'collect', config: { collectTargets: ['a'] } },
    })
    const s0 = createGameplayState(bp)
    const s1 = collectItem(s0, 'zzz')
    expect(s1).toBe(s0) // same reference: no change
  })

  it('ignores duplicate collect', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'collect', config: { collectTargets: ['a'] } },
    })
    const s0 = createGameplayState(bp)
    const s1 = collectItem(s0, 'a')
    const s2 = collectItem(s1, 'a')
    expect(s2).toBe(s1)
  })

  it('marks completed when all collected', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'collect', config: { collectTargets: ['a', 'b'] } },
    })
    const s0 = createGameplayState(bp)
    const s1 = collectItem(s0, 'a')
    expect(s1.completed).toBe(false)
    const s2 = collectItem(s1, 'b')
    expect(s2.completed).toBe(true)
    expect(isCompleted(s2)).toBe(true)
  })
})

describe('checkReach', () => {
  it('sets reached + completed when horizontal distance < 2', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'reach', config: { goalPosition: [10, 0, 10] } },
    })
    const s0 = createGameplayState(bp)
    const near = checkReach(s0, [10.5, 0, 10.5], [10, 0, 10])
    expect(near.reached).toBe(true)
    expect(near.completed).toBe(true)
  })

  it('does nothing when far', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'reach', config: { goalPosition: [10, 0, 10] } },
    })
    const s0 = createGameplayState(bp)
    const far = checkReach(s0, [0, 0, 0], [10, 0, 10])
    expect(far).toBe(s0)
    expect(far.reached).toBe(false)
  })

  it('vertical distance does not matter', () => {
    const bp = makeBlueprint({
      gameplay: { template: 'reach', config: { goalPosition: [10, 5, 10] } },
    })
    const s0 = createGameplayState(bp)
    const result = checkReach(s0, [10, 0, 10], [10, 5, 10])
    expect(result.completed).toBe(true)
  })
})

describe('advanceQuest', () => {
  it('increments step', () => {
    const bp = makeBlueprint({
      gameplay: {
        template: 'quest',
        config: { questSteps: [{ id: 'q1', text: 'a' }, { id: 'q2', text: 'b' }, { id: 'q3', text: 'c' }] },
      },
    })
    const s0 = createGameplayState(bp)
    const s1 = advanceQuest(s0)
    expect(s1.questStep).toBe(1)
    expect(s1.completed).toBe(false)
    expect(s0.questStep).toBe(0) // immutable
  })

  it('marks completed when step exceeds last', () => {
    const bp = makeBlueprint({
      gameplay: {
        template: 'quest',
        config: { questSteps: [{ id: 'q1', text: 'a' }] },
      },
    })
    const s0 = createGameplayState(bp)
    const s1 = advanceQuest(s0)
    expect(s1.questStep).toBe(1)
    expect(s1.completed).toBe(true)
    expect(isCompleted(s1)).toBe(true)
  })
})

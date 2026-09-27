// ===== R5: 记忆重要性评分测试 =====
import { describe, expect, it } from 'vitest'
import { scoreMemoryImportance, MEMORY_IMPORTANCE_LABEL, type MemorySignals } from './memoryImportance'

describe('scoreMemoryImportance', () => {
  it('空输入给基础分 2（一面之缘）', () => {
    expect(scoreMemoryImportance({})).toBe(2)
  })

  it('路过打招呼、情绪平淡时降为 1', () => {
    expect(scoreMemoryImportance({ emotionalIntensity: 0 })).toBe(1)
  })

  it('法庭/脱口秀深度场景 +1', () => {
    expect(scoreMemoryImportance({ scene: 'court' })).toBe(3)
    expect(scoreMemoryImportance({ scene: 'talkshow' })).toBe(3)
    expect(scoreMemoryImportance({ scene: 'hall' })).toBe(2)
  })

  it('引用名言 + 主动深问会叠加到 4', () => {
    expect(scoreMemoryImportance({ containsQuote: true, userInitiatedDeep: true })).toBe(4)
  })

  it('多信号叠加封顶 5（刻骨铭心）', () => {
    expect(
      scoreMemoryImportance({
        scene: 'court',
        containsQuote: true,
        userInitiatedDeep: true,
        turnCount: 8,
        emotionalIntensity: 2,
      }),
    ).toBe(5)
  })

  it('结果永远夹在 1–5', () => {
    for (const signals of [
      { emotionalIntensity: 0, turnCount: 0 },
      { scene: 'court', containsQuote: true, userInitiatedDeep: true, turnCount: 9, emotionalIntensity: 2 },
    ] satisfies MemorySignals[]) {
      const v = scoreMemoryImportance(signals)
      expect(v).toBeGreaterThanOrEqual(1)
      expect(v).toBeLessThanOrEqual(5)
    }
  })

  it('label 覆盖 1–5', () => {
    expect(Object.keys(MEMORY_IMPORTANCE_LABEL).sort()).toEqual(['1', '2', '3', '4', '5'])
  })
})

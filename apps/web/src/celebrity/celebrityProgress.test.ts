// ===== R5: 图鉴收集进度测试 =====
import { describe, expect, it } from 'vitest'
import { CELEBRITIES } from '@balabala/shared'
import {
  computeCollectionProgress,
  isCelebrityMet,
  unlockHintFor,
} from './celebrityProgress'
import type { CelebrityRelation } from '@balabala/shared'

function rel(id: string, affection = 40, level: CelebrityRelation['acquaintanceLevel'] = 'friend'): CelebrityRelation {
  return {
    celebrityId: id,
    acquaintanceLevel: level,
    affection,
    unlockedTopics: [],
    unlockedLines: [],
    interactionCount: 1,
  }
}

describe('computeCollectionProgress', () => {
  it('无关系记录时 met=0、percent=0', () => {
    const p = computeCollectionProgress({})
    expect(p.total).toBe(CELEBRITIES.length)
    expect(p.met).toBe(0)
    expect(p.percent).toBe(0)
    expect(p.unlockedFields).toBe(0)
    expect(p.byField.length).toBe(7)
  })

  it('统计已结识名人并按领域分组', () => {
    const elon = CELEBRITIES.find((c) => c.id === 'elon-mank') || CELEBRITIES.find((c) => c.id === 'elon-musk')!
    const libai = CELEBRITIES.find((c) => c.id === 'li-bai')!
    const p = computeCollectionProgress({
      [elon.id]: rel(elon.id),
      [libai.id]: rel(libai.id),
    })
    expect(p.met).toBe(2)
    expect(p.percent).toBe(Math.round((2 / CELEBRITIES.length) * 100))
    expect(p.unlockedFields).toBe(2)
    const tech = p.byField.find((f) => f.field === '科技')!
    expect(tech.met).toBeGreaterThanOrEqual(1)
  })

  it('stranger 档位不算已结识', () => {
    const id = CELEBRITIES[0].id
    const p = computeCollectionProgress({ [id]: rel(id, 0, 'stranger') })
    expect(p.met).toBe(0)
  })

  it('空入参兜底为零进度', () => {
    expect(computeCollectionProgress(null).met).toBe(0)
    expect(computeCollectionProgress(undefined).met).toBe(0)
  })
})

describe('isCelebrityMet / unlockHintFor', () => {
  it('已结识返回 true 与「已结识」', () => {
    const id = CELEBRITIES[0].id
    expect(isCelebrityMet(id, { [id]: rel(id) })).toBe(true)
    expect(unlockHintFor(id, { [id]: rel(id) })).toBe('已结识')
  })

  it('未结识返回 false 与解锁提示', () => {
    const id = CELEBRITIES[0].id
    expect(isCelebrityMet(id, {})).toBe(false)
    expect(unlockHintFor(id, {})).toContain('对话或同台')
  })
})

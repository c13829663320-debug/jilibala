// ===== R5: 名人数据完整性校验 =====
// 校验 CELEBRITIES 每条记录的必填字段、voice 合法、offlineFacts 数量与非空。
import { describe, expect, it } from 'vitest'
import { CELEBRITIES, CELEBRITY_FIELDS, isValidVoice } from '@balabala/shared'

describe('名人数据完整性', () => {
  it('人数为 100', () => {
    expect(CELEBRITIES.length).toBe(100)
  })

  it('id 全局唯一', () => {
    const ids = CELEBRITIES.map((c) => c.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('每条都有必填文本字段（id/name/title/era/intro/persona/greeting/portrait）', () => {
    for (const c of CELEBRITIES) {
      expect(c.id, '缺 id').toBeTruthy()
      expect(c.name, `${c.id} 缺 name`).toBeTruthy()
      expect(c.title, `${c.id} 缺 title`).toBeTruthy()
      expect(c.era, `${c.id} 缺 era`).toBeTruthy()
      expect(c.intro, `${c.id} 缺 intro`).toBeTruthy()
      expect(c.persona, `${c.id} 缺 persona`).toBeTruthy()
      expect(c.greeting, `${c.id} 缺 greeting`).toBeTruthy()
      expect(c.portrait, `${c.id} 缺 portrait`).toBeTruthy()
      expect(Array.isArray(c.tags), `${c.id} tags 应为数组`).toBe(true)
      expect(c.tags.length, `${c.id} 至少 1 个 tag`).toBeGreaterThanOrEqual(1)
    }
  })

  it('field 都在合法领域枚举内', () => {
    for (const c of CELEBRITIES) {
      expect(CELEBRITY_FIELDS, `${c.id} 的 field=${c.field}`).toContain(c.field)
    }
  })

  it('每条都有合法 voice（StepFun 白名单内）', () => {
    for (const c of CELEBRITIES) {
      expect(c.voice, `${c.id} 缺 voice`).toBeTruthy()
      expect(isValidVoice(c.voice), `${c.id} 的 voice=${c.voice} 不在白名单`).toBe(true)
    }
  })

  it('每条 offlineFacts 都有 3–5 条非空事实', () => {
    for (const c of CELEBRITIES) {
      expect(Array.isArray(c.offlineFacts), `${c.id} 缺 offlineFacts`).toBe(true)
      expect(c.offlineFacts!.length, `${c.id} offlineFacts 数量`).toBeGreaterThanOrEqual(3)
      expect(c.offlineFacts!.length, `${c.id} offlineFacts 数量`).toBeLessThanOrEqual(5)
      for (const f of c.offlineFacts!) {
        expect(typeof f, `${c.id} 有空事实`).toBe('string')
        expect(f.trim().length, `${c.id} 有空事实`).toBeGreaterThan(0)
      }
    }
  })
})

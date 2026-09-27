// 自定义规则纯函数测试
import { describe, expect, it } from 'vitest'
import { defaultRules, normalizeRules, parseRules, serializeRules, validateRules } from './ugcRules'

describe('默认值', () => {
  it('默认规则合法', () => {
    expect(validateRules(defaultRules())).toEqual([])
  })
})

describe('validateRules', () => {
  it('回合数越界报错', () => {
    expect(validateRules({ rounds: 99 }).length).toBeGreaterThan(0)
    expect(validateRules({ rounds: 0 }).length).toBeGreaterThan(0)
  })

  it('max<min 报错', () => {
    const errs = validateRules({ minPlayers: 5, maxPlayers: 2 })
    expect(errs.some((e) => e.message.includes('最多人数'))).toBe(true)
  })

  it('未知胜利条件报错', () => {
    expect(validateRules({ winCondition: 'magic' as never }).length).toBeGreaterThan(0)
  })

  it('秒数越界报错', () => {
    expect(validateRules({ secondsPerRound: 5 }).length).toBeGreaterThan(0)
    expect(validateRules({ secondsPerRound: 999 }).length).toBeGreaterThan(0)
  })
})

describe('normalizeRules 夹紧', () => {
  it('把越界值夹紧到合法区间', () => {
    const r = normalizeRules({ rounds: 99, minPlayers: 0, maxPlayers: 99, secondsPerRound: 5 })
    expect(r.rounds).toBe(20)
    expect(r.minPlayers).toBe(1)
    expect(r.maxPlayers).toBe(8)
    expect(r.secondsPerRound).toBe(10)
  })

  it('max<min 时把 max 抬到 min', () => {
    const r = normalizeRules({ minPlayers: 4, maxPlayers: 2 })
    expect(r.maxPlayers).toBe(4)
  })

  it('非法胜利条件回退默认', () => {
    const r = normalizeRules({ winCondition: 'xxx' as never })
    expect(r.winCondition).toBe('most-points')
  })
})

describe('序列化', () => {
  it('序列化再反序列化一致', () => {
    const r = normalizeRules({ rounds: 5, winCondition: 'survive', minPlayers: 2, maxPlayers: 6 })
    expect(parseRules(serializeRules(r))).toEqual(r)
  })

  it('非法 JSON 回退默认', () => {
    expect(parseRules('not-json{').rounds).toBe(defaultRules().rounds)
  })

  it('空串回退默认', () => {
    expect(parseRules('')).toEqual(defaultRules())
  })
})

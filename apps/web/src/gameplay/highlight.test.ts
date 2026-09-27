import { describe, it, expect } from 'vitest'
import {
  buildCourtReplay,
  courtHighlights,
  oneLineHighlight,
  buildShareCard,
  CARD_LABEL,
} from './highlight'
import { emptyStreak } from './streak'
import type { CourtPlayerMove } from '@balabala/shared'

function move(partial: Partial<CourtPlayerMove>): CourtPlayerMove {
  return {
    round: 1,
    card: 'attack',
    delta: 0,
    hit: false,
    ...partial,
  }
}

describe('buildCourtReplay 天平累计与逆转检测', () => {
  it('全程领先不标记逆转', () => {
    const steps = buildCourtReplay([
      move({ round: 1, card: 'attack', delta: 10 }),
      move({ round: 2, card: 'evidence', delta: 8 }),
    ])
    expect(steps.every((s) => !s.isReverse)).toBe(true)
    expect(steps[1].cumAfter).toBe(18)
  })

  it('落后后翻盘一步标记逆转时刻', () => {
    const steps = buildCourtReplay([
      move({ round: 1, card: 'attack', delta: -12 }), // cum -12 落后
      move({ round: 2, card: 'evidence', delta: 20 }), // cum +8 翻盘
    ])
    expect(steps[0].isReverse).toBe(false)
    expect(steps[1].isReverse).toBe(true)
    expect(steps[1].cumAfter).toBe(8)
  })

  it('连续落后后转正才算逆转（中途仍负不算）', () => {
    const steps = buildCourtReplay([
      move({ delta: -10 }),
      move({ delta: 5 }), // cum -5 仍落后
      move({ delta: 10 }), // cum +5 逆转
    ])
    expect(steps[1].isReverse).toBe(false)
    expect(steps[2].isReverse).toBe(true)
  })

  it('口播包含卡牌标签与天平增量', () => {
    const s = buildCourtReplay([move({ card: 'mock', delta: -4, hit: true })])[0]
    expect(s.text).toContain(CARD_LABEL.mock)
    expect(s.text).toContain('命中争议点')
  })
})

describe('courtHighlights 高光列表', () => {
  it('逆转时刻优先且带 isReverse', () => {
    const hs = courtHighlights([
      move({ round: 1, delta: -10 }),
      move({ round: 2, delta: 15, freeText: '请看这份铁证！' }),
    ])
    const rev = hs.find((h) => h.isReverse)
    expect(rev).toBeTruthy()
    expect(rev!.round).toBe(2)
    expect(rev!.quote).toBe('请看这份铁证！')
  })

  it('无逆转时取最大正向 delta 高光', () => {
    const hs = courtHighlights([
      move({ round: 1, delta: 3 }),
      move({ round: 2, delta: 9, freeText: '致命一击' }),
    ])
    expect(hs.some((h) => h.quote === '致命一击')).toBe(true)
  })

  it('合并 LLM key_moments 且上限 3 条', () => {
    const hs = courtHighlights([move({ delta: 2 })], ['法官被说服了', '全场哗然', '第三条', '第四条'])
    expect(hs.length).toBeLessThanOrEqual(3)
    expect(hs.some((h) => h.text === '法官被说服了')).toBe(true)
  })

  it('空 moves 不抛错', () => {
    expect(courtHighlights(undefined, ['x']).length).toBe(1)
  })
})

describe('oneLineHighlight 即时高光', () => {
  it('优先逆转', () => {
    const line = oneLineHighlight([
      { text: '普通高光', isReverse: false },
      { text: '翻盘了', isReverse: true },
    ])
    expect(line).toContain('逆转')
  })
  it('无高光兜底', () => {
    expect(oneLineHighlight([])).toContain('再来一局')
  })
})

describe('buildShareCard 可分享战果卡', () => {
  it('包含胜负/连胜/关系', () => {
    const card = buildShareCard({
      scene: 'court',
      won: true,
      score: 88,
      streak: { current: 3, best: 5, lastPlayedAt: null },
      relations: [{ celebrityId: 'libai', celebrityName: '李白', delta: 1, reason: '当庭击败' }],
      highlights: [{ text: '翻盘', isReverse: true }],
    })
    expect(card.emoji).toBe('⚖️')
    expect(card.lines.join('\n')).toContain('获胜')
    expect(card.lines.join('\n')).toContain('李白')
    expect(card.lines.join('\n')).toContain('逆转时刻')
  })
  it('失败局文案', () => {
    const card = buildShareCard({ scene: 'werewolf', won: false, streak: emptyStreak() })
    expect(card.lines[0]).toContain('惜败')
  })
})

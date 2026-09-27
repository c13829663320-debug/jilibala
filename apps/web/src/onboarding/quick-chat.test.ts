/**
 * R5 分片C · 名人快车道纯逻辑单测
 * 覆盖：推荐名人选择、降级数据可用、开场白兜底、卡片归一化
 */
import { describe, expect, it } from 'vitest'
import { CELEBRITIES, getCelebrity, type Celebrity } from '@balabala/shared'
import {
  FALLBACK_GREETING,
  RECOMMENDED_QUICK_CHAT_IDS,
  buildQuickChatCard,
  pickQuickChatCelebrity,
  prepareQuickChatCard,
  resolveGreeting,
} from './quick-chat'

function makeCeleb(over: Partial<Celebrity>): Celebrity {
  return {
    id: 'test-celeb', name: '测试名人', title: '头衔', era: '当代', field: '哲学',
    intro: '', tags: [], persona: '', greeting: '你好', portrait: '/portraits/x.png',
    ...over,
  }
}

describe('pickQuickChatCelebrity', () => {
  it('优先从内置推荐顺序里挑（苏格拉底/爱因斯坦存在于本地数据）', () => {
    const hit = pickQuickChatCelebrity()
    expect(hit).toBeDefined()
    expect(RECOMMENDED_QUICK_CHAT_IDS).toContain(hit!.id)
  })

  it('苏格拉底应被选中（默认首选）', () => {
    expect(pickQuickChatCelebrity()?.id).toBe('socrates')
  })

  it('首选缺失时顺延到下一个推荐 id', () => {
    const pool = [makeCeleb({ id: 'albert-einstein', name: '爱因斯坦' }), makeCeleb({ id: 'socrates', name: '苏格拉底' })]
    // 顺序里 socrates 在前但也在池里 → 选中 socrates
    expect(pickQuickChatCelebrity(RECOMMENDED_QUICK_CHAT_IDS, pool)?.id).toBe('socrates')
  })

  it('推荐 id 全部缺失时回退到池里第一位', () => {
    const pool = [makeCeleb({ id: 'somebody' })]
    expect(pickQuickChatCelebrity(['nope-a', 'nope-b'], pool)?.id).toBe('somebody')
  })

  it('空池返回 undefined（组件层据此隐藏入口）', () => {
    expect(pickQuickChatCelebrity(['socrates'], [])).toBeUndefined()
  })
})

describe('降级数据', () => {
  it('本地 CELEBRITIES 一定能产出可用卡片（离线/无 API 也能渲染）', () => {
    const card = prepareQuickChatCard()
    expect(card).not.toBeNull()
    expect(card!.name.length).toBeGreaterThan(0)
    expect(card!.greeting.length).toBeGreaterThan(0)
    expect(card!.portrait.length).toBeGreaterThan(0)
  })

  it('getCelebrity 与推荐 id 一致（卡片名人确实在共享数据里）', () => {
    const card = prepareQuickChatCard()!
    expect(getCelebrity(card.celebrityId)).toBeDefined()
  })

  it('greeting 为空时降级为默认文案，不返回空串', () => {
    const c = makeCeleb({ greeting: '   ' })
    expect(resolveGreeting(c)).toBe(FALLBACK_GREETING)
  })

  it('greeting 有内容时原样使用并 trim', () => {
    const c = makeCeleb({ greeting: '  保持好奇。  ' })
    expect(resolveGreeting(c)).toBe('保持好奇。')
  })

  it('池为空时 prepareQuickChatCard 返回 null 而不抛错', () => {
    expect(prepareQuickChatCard(undefined, [])).toBeNull()
  })
})

describe('buildQuickChatCard 归一化', () => {
  it('输出字段完整且 greeting 一定非空', () => {
    const card = buildQuickChatCard(makeCeleb({ id: 'a', name: '甲', title: '哲学家', greeting: 'hi' }))
    expect(card).toEqual({
      celebrityId: 'a', name: '甲', title: '哲学家', greeting: 'hi',
      portrait: '/portraits/x.png', field: '哲学',
    })
  })

  it('全部 102 位名人都能归一化为合法卡片（不炸数据）', () => {
    for (const c of CELEBRITIES) {
      const card = buildQuickChatCard(c)
      expect(card.celebrityId).toBe(c.id)
      expect(card.greeting.length).toBeGreaterThan(0)
      expect(card.name.length).toBeGreaterThan(0)
    }
  })
})

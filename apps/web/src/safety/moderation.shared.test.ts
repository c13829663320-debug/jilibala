// ===== R5 发布域：shared 审核纯函数测试（运行在 apps/web vitest） =====
import { describe, expect, it } from 'vitest'
import {
  moderateText,
  containsSensitiveWord,
  isCelebrityNameSafe,
  ALL_SENSITIVE_WORDS,
  MODERATION_CATEGORIES,
  MASK,
} from '@balabala/shared'

describe('moderateText (shared pure)', () => {
  it('空串不崩且不命中', () => {
    expect(moderateText('')).toEqual({ hit: false, text: '', muted: false })
  })

  it('正常文本原样返回，hit=false', () => {
    const r = moderateText('今天天气真不错，想去广场逛一逛')
    expect(r.hit).toBe(false)
    expect(r.text).toBe('今天天气真不错，想去广场逛一逛')
    expect(r.muted).toBe(false) // 纯函数无用户上下文
  })

  it('中文辱骂词命中并替换为 ***', () => {
    const r = moderateText('你这个傻逼玩意儿')
    expect(r.hit).toBe(true)
    expect(r.text).toBe(`你这个${MASK}玩意儿`)
  })

  it('一句话多处命中全部替换', () => {
    const r = moderateText('操你妈 傻逼 博彩网站')
    expect(r.hit).toBe(true)
    expect(r.text).toBe(`${MASK} ${MASK} ${MASK}`)
  })

  it('英文敏感词大小写不敏感', () => {
    expect(moderateText('Fuck you').hit).toBe(true)
    expect(moderateText('what the FUCK').hit).toBe(true)
  })

  it('英文词边界：不误伤 class / mass 等普通词', () => {
    // ass 不在词表；用 nigger 验证边界——普通含该子串的词不应被误伤
    expect(moderateText('这是一个 great class').text).toBe('这是一个 great class')
    expect(moderateText('I like this class').hit).toBe(false)
  })

  it('广告类命中（赌博网站）', () => {
    const r = moderateText('点击这里博彩网站注册')
    expect(r.hit).toBe(true)
    expect(r.text).toBe(`点击这里${MASK}注册`)
  })

  it('containsSensitiveText 仅判定命中', () => {
    expect(containsSensitiveWord('加微信约')).toBe(true)
    expect(containsSensitiveWord('一起去法庭辩论')).toBe(false)
  })

  it('词表覆盖全部四个类别且非空', () => {
    expect([...MODERATION_CATEGORIES].sort()).toEqual(['ad', 'insult', 'political', 'porn'].sort())
    expect(ALL_SENSITIVE_WORDS.length).toBeGreaterThan(10)
  })
})

describe('isCelebrityNameSafe (shared pure)', () => {
  it('空输入安全', () => {
    expect(isCelebrityNameSafe('')).toBe(true)
    expect(isCelebrityNameSafe('   ')).toBe(true)
  })

  it('没提到名人 → 安全', () => {
    expect(isCelebrityNameSafe('今天和朋友一起聊天')).toBe(true)
  })

  it('正常讨论/喜欢名人 → 安全', () => {
    expect(isCelebrityNameSafe('我很喜欢李白的诗')).toBe(true)
    expect(isCelebrityNameSafe('和马斯克来一场法庭辩论')).toBe(true)
  })

  it('冒充名人（我是+名人名）→ 不安全', () => {
    expect(isCelebrityNameSafe('我是马斯克本尊')).toBe(false)
    expect(isCelebrityNameSafe('我是鲁迅本人')).toBe(false)
  })

  it('诽谤名人（名人名+侮辱词）→ 不安全', () => {
    expect(isCelebrityNameSafe('鲁迅就是个骗子')).toBe(false)
    expect(isCelebrityNameSafe('李白是傻逼')).toBe(false)
  })
})

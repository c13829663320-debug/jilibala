// 失败降级策略测试
import { describe, expect, it } from 'vitest'
import { decideFallback } from './failureFallback'

describe('decideFallback', () => {
  it('not_found → 逛模板，推荐模板', () => {
    const a = decideFallback({ code: 'not_found', message: 'x' })
    expect(a.kind).toBe('browse-templates')
    expect(a.recommendedTemplateId).toBeTruthy()
  })

  it('forbidden → 回广场', () => {
    const a = decideFallback({ code: '403' })
    expect(a.kind).toBe('back-to-plaza')
    expect(a.route).toContain('plaza')
  })

  it('network/timeout 可重试', () => {
    expect(decideFallback({ code: 'network' }).kind).toBe('retry')
    expect(decideFallback({ code: 'timeout' }).kind).toBe('retry')
  })

  it('invalid_draft → 编辑重发', () => {
    expect(decideFallback({ code: 'invalid_draft' }).kind).toBe('edit-and-repost')
  })

  it('空错误 → 默认重试', () => {
    const a = decideFallback(undefined)
    expect(a.kind).toBe('retry')
    expect(a.message).toBeTruthy()
  })
})

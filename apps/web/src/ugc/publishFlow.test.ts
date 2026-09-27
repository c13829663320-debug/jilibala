// 发布状态机 + 草稿校验测试
import { describe, expect, it } from 'vitest'
import { nextPublishStatus, runStateMachine, validateDraftLocally } from './publishFlow'

describe('发布状态机', () => {
  it('draft --submit--> previewing', () => {
    expect(nextPublishStatus('draft', 'submit')).toBe('previewing')
  })

  it('完整成功路径：submit→validate-ok→server-ok → published', () => {
    expect(runStateMachine(['submit', 'validate-ok', 'server-ok'])).toBe('published')
  })

  it('校验失败 → failed', () => {
    expect(runStateMachine(['submit', 'validate-fail'])).toBe('failed')
  })

  it('服务端失败 → failed', () => {
    expect(runStateMachine(['submit', 'validate-ok', 'server-fail'])).toBe('failed')
  })

  it('published 后可 reset 回 draft 重编', () => {
    expect(nextPublishStatus('published', 'reset')).toBe('draft')
    expect(nextPublishStatus('failed', 'reset')).toBe('draft')
  })

  it('非法迁移保持原态（防御）', () => {
    expect(nextPublishStatus('published', 'submit')).toBe('published')
    expect(nextPublishStatus('draft', 'server-ok')).toBe('draft')
  })
})

describe('本地草稿校验', () => {
  it('空草稿报错', () => {
    expect(validateDraftLocally(null).length).toBeGreaterThan(0)
  })

  it('空描述报错', () => {
    const errs = validateDraftLocally({ rawPrompt: '   ', theme: 'x', gameType: 'explore' })
    expect(errs[0].message).toContain('描述')
  })

  it('合法草稿无错误', () => {
    const errs = validateDraftLocally({ rawPrompt: '茶馆', theme: 'teahouse', gameType: 'debate', celebrityIds: ['su-shi'] })
    expect(errs).toEqual([])
  })

  it('celebrityIds 非数组报错', () => {
    const errs = validateDraftLocally({ rawPrompt: 'x', theme: 't', gameType: 'explore', celebrityIds: 'nope' as never })
    expect(errs.some((e) => e.message.includes('名人'))).toBe(true)
  })
})

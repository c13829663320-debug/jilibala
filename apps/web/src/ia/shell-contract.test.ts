import { describe, expect, it } from 'vitest'
import { assertSceneShellProps, validateSceneShellProps } from './shell-contract'

const valid = {
  sceneId: 'court',
  title: '趣味法庭',
  mode: 'fullscreen' as const,
  breadcrumb: [{ label: '广场', to: '/plaza' }, { label: '趣味法庭' }],
  onBack: () => {},
}

describe('validateSceneShellProps', () => {
  it('合法 props 返回空错误数组', () => {
    expect(validateSceneShellProps(valid)).toEqual([])
  })
  it('非对象直接报错', () => {
    expect(validateSceneShellProps(null).length).toBeGreaterThan(0)
  })
  it('拒绝非法 sceneId', () => {
    const errors = validateSceneShellProps({ ...valid, sceneId: 'bedroom' })
    expect(errors.join('\n')).toContain('sceneId')
  })
  it('拒绝空 title / 非法 mode', () => {
    expect(validateSceneShellProps({ ...valid, title: '  ' }).join('\n')).toContain('title')
    expect(validateSceneShellProps({ ...valid, mode: 'wide' }).join('\n')).toContain('mode')
  })
  it('要求非空 breadcrumb 且每节有 label', () => {
    expect(validateSceneShellProps({ ...valid, breadcrumb: [] }).join('\n')).toContain('breadcrumb')
    expect(validateSceneShellProps({ ...valid, breadcrumb: [{ to: '/x' }] }).join('\n')).toContain('label')
  })
  it('要求 onBack 是函数', () => {
    expect(validateSceneShellProps({ ...valid, onBack: 'back' }).join('\n')).toContain('onBack')
  })
  it('assertSceneShellProps 合法时返回自身，非法时抛错', () => {
    expect(assertSceneShellProps(valid)).toEqual(valid)
    expect(() => assertSceneShellProps({})).toThrow()
  })
})

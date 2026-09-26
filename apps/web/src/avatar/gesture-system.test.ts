import { describe, it, expect } from 'vitest'
import { getGesturePose, isAnimatedGesture, ALL_GESTURES } from './gesture-system'

describe('手势系统：基础姿势', () => {
  it('none 时所有手臂/手通道归零', () => {
    const p = getGesturePose('none', 0)
    expect(p.armRaiseL).toBe(0)
    expect(p.armRaiseR).toBe(0)
    expect(p.armSwingL).toBe(0)
    expect(p.armSwingR).toBe(0)
    expect(p.handGripL).toBe(0)
    expect(p.handGripR).toBe(0)
  })

  it('每个手势都返回一份完整姿势表', () => {
    for (const g of ALL_GESTURES) {
      const p = getGesturePose(g, 0)
      expect(p).toHaveProperty('armRaiseL')
      expect(p).toHaveProperty('handGripR')
    }
  })
})

describe('手势系统：各手势形态', () => {
  it('wave 右臂高举且随时间摆动', () => {
    const p0 = getGesturePose('wave', 0)
    expect(p0.armRaiseR).toBe(1)
    const p1 = getGesturePose('wave', 300)
    expect(p1.armSwingR).not.toBe(p0.armSwingR)
  })

  it('point 右臂前伸（摆动角大）', () => {
    const p = getGesturePose('point', 0)
    expect(p.armSwingR).toBeGreaterThan(0.8)
  })

  it('fist 双手紧握（grip=1）', () => {
    const p = getGesturePose('fist', 0)
    expect(p.handGripL).toBe(1)
    expect(p.handGripR).toBe(1)
  })

  it('open_palm 双手张开（grip=0）', () => {
    const p = getGesturePose('open_palm', 0)
    expect(p.handGripL).toBe(0)
    expect(p.handGripR).toBe(0)
  })

  it('thumbs_up 手握起但未到满拳、手腕上翻', () => {
    const p = getGesturePose('thumbs_up', 0)
    expect(p.handGripR).toBeGreaterThan(0.7)
    expect(p.handPitchR).not.toBe(0)
  })

  it('peace / ok 手为半握状态', () => {
    expect(getGesturePose('peace', 0).handGripR).toBeLessThan(0.5)
    expect(getGesturePose('ok', 0).handGripR).toBeGreaterThan(0.4)
  })

  it('isAnimatedGesture 只对 wave 为真', () => {
    expect(isAnimatedGesture('wave')).toBe(true)
    for (const g of ALL_GESTURES) {
      if (g === 'wave') continue
      expect(isAnimatedGesture(g)).toBe(false)
    }
  })
})

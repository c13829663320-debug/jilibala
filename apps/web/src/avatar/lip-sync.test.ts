import { describe, it, expect } from 'vitest'
import { levelToMouthOpen, smoothIntensity } from './lip-sync'

describe('levelToMouthOpen', () => {
  it('电平为 0 时口部完全闭合', () => {
    expect(levelToMouthOpen(0)).toBe(0)
  })

  it('低于阈值时口部完全闭合（底噪抑制）', () => {
    // 默认阈值 0.02
    expect(levelToMouthOpen(0.01)).toBe(0)
    expect(levelToMouthOpen(0.02)).toBe(0) // 等于阈值也视为静默
  })

  it('电平 0.5 时口部张开度落在合理区间且非线性', () => {
    const v = levelToMouthOpen(0.5)
    // 归一化后 (0.5-0.02)/(1-0.02) ≈ 0.49，pow(0.49,0.65) ≈ 0.61
    expect(v).toBeGreaterThan(0.4)
    expect(v).toBeLessThan(0.9)
    // 非线性应让中等电平比线性映射更张开
    const linear = (0.5 - 0.02) / (1 - 0.02)
    expect(v).toBeGreaterThan(linear)
  })

  it('电平为 1 时口部完全张开', () => {
    expect(levelToMouthOpen(1)).toBeCloseTo(1, 5)
  })

  it('越界输入被钳制', () => {
    expect(levelToMouthOpen(-0.5)).toBe(0)
    expect(levelToMouthOpen(2)).toBeCloseTo(1, 5)
  })

  it('自定义阈值生效', () => {
    expect(levelToMouthOpen(0.1, 0.3)).toBe(0) // 0.1 < 0.3
    expect(levelToMouthOpen(0.5, 0.3)).toBeGreaterThan(0)
  })
})

describe('smoothIntensity', () => {
  it('alpha=0 时完全不跟随，保持上一帧', () => {
    expect(smoothIntensity(0.2, 0.8, 0)).toBe(0.2)
  })

  it('alpha=1 时完全跟随当前帧', () => {
    expect(smoothIntensity(0.2, 0.8, 1)).toBe(0.8)
  })

  it('alpha=0.5 时取中间值', () => {
    expect(smoothIntensity(0, 1, 0.5)).toBeCloseTo(0.5, 5)
  })

  it('alpha 越界被钳制', () => {
    expect(smoothIntensity(0, 1, -1)).toBe(0)
    expect(smoothIntensity(0, 1, 2)).toBe(1)
  })
})

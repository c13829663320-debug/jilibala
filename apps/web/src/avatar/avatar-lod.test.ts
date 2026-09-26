// ===== avatar-lod 纯逻辑单测（距离分级 + 边界值） =====
import { describe, expect, it } from 'vitest'
import {
  computeLodTier,
  distance2d,
  lodProfile,
  lodProfileForPositions,
  LOD_NEAR,
  LOD_MID,
  LOD_FAR,
  type Vec2,
} from './avatar-lod'

describe('computeLodTier 距离分级', () => {
  it('近距离 (<15m) → high（完整模型 + 动画 + 表情）', () => {
    expect(computeLodTier(0)).toBe('high')
    expect(computeLodTier(5)).toBe('high')
    expect(computeLodTier(14.99)).toBe('high')
  })

  it('中距离 (15<=d<40m) → medium（简化几何体，无表情）', () => {
    expect(computeLodTier(LOD_NEAR)).toBe('medium') // 15 边界归 medium
    expect(computeLodTier(20)).toBe('medium')
    expect(computeLodTier(39.99)).toBe('medium')
  })

  it('远距离 (40<=d<80m) → billboard（公告板精灵）', () => {
    expect(computeLodTier(LOD_MID)).toBe('billboard') // 40 边界归 billboard
    expect(computeLodTier(55)).toBe('billboard')
    expect(computeLodTier(79.99)).toBe('billboard')
  })

  it('极远 (>=80m) → hidden（完全隐藏）', () => {
    expect(computeLodTier(LOD_FAR)).toBe('hidden') // 80 边界归 hidden
    expect(computeLodTier(120)).toBe('hidden')
  })

  it('非法/负距离兜底为最近（high），不抛错', () => {
    expect(computeLodTier(-5)).toBe('high')
    expect(computeLodTier(NaN)).toBe('high')
    expect(computeLodTier(Infinity)).toBe('hidden') // 无穷远视为隐藏
  })
})

describe('distance2d 水平距离', () => {
  it('同点距离为 0', () => {
    const p: Vec2 = { x: 3, z: 4 }
    expect(distance2d(p, p)).toBe(0)
  })

  it('计算欧氏距离', () => {
    expect(distance2d({ x: 0, z: 0 }, { x: 3, z: 4 })).toBe(5)
    expect(distance2d({ x: 10, z: 10 }, { x: 10, z: 20 })).toBe(10)
  })

  it('非法坐标兜底为 0，不抛错', () => {
    expect(distance2d({ x: NaN, z: 0 }, { x: 0, z: 0 })).toBe(0)
  })
})

describe('lodProfile 渲染策略', () => {
  it('high：完整模型 + 动画 + 表情，细分 1.0', () => {
    const p = lodProfile('high')
    expect(p.visible).toBe(true)
    expect(p.fullModel).toBe(true)
    expect(p.skeletalAnim).toBe(true)
    expect(p.expressions).toBe(true)
    expect(p.billboard).toBe(false)
    expect(p.tessellation).toBe(1.0)
  })

  it('medium：简化几何体（面数约减 50%），无表情', () => {
    const p = lodProfile('medium')
    expect(p.simplified).toBe(true)
    expect(p.expressions).toBe(false)
    expect(p.tessellation).toBeCloseTo(0.5)
  })

  it('billboard：不画模型，只画公告板', () => {
    const p = lodProfile('billboard')
    expect(p.fullModel).toBe(false)
    expect(p.billboard).toBe(true)
    expect(p.tessellation).toBe(0)
  })

  it('hidden：完全不可见', () => {
    const p = lodProfile('hidden')
    expect(p.visible).toBe(false)
    expect(p.billboard).toBe(false)
  })
})

describe('lodProfileForPositions 一步到位', () => {
  it('本地与远端位置 → 正确 tier', () => {
    const local: Vec2 = { x: 0, z: 0 }
    expect(lodProfileForPositions(local, { x: 5, z: 0 }).tier).toBe('high')
    expect(lodProfileForPositions(local, { x: 20, z: 0 }).tier).toBe('medium')
    expect(lodProfileForPositions(local, { x: 60, z: 0 }).tier).toBe('billboard')
    expect(lodProfileForPositions(local, { x: 90, z: 0 }).tier).toBe('hidden')
  })
})

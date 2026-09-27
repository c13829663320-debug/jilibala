// ===== R5: 多人合影布局纯函数测试 =====
import { describe, expect, it } from 'vitest'
import { computeGroupPhotoLayout } from './groupPhotoLayout'

describe('computeGroupPhotoLayout', () => {
  it('0 人：空头像墙，仍返回标题/战果位置', () => {
    const l = computeGroupPhotoLayout(0)
    expect(l.avatars).toEqual([])
    expect(l.title).toEqual({ x: 600, y: 90 })
    expect(l.resultText).toEqual({ x: 600, y: 540 })
  })

  it('单人：头像在画布正中央', () => {
    const l = computeGroupPhotoLayout(1)
    expect(l.avatars).toHaveLength(1)
    const a = l.avatars[0]
    // 中心应接近画布中心
    expect(a.x + a.size / 2).toBeCloseTo(600, -1)
    expect(a.y + a.size / 2).toBeCloseTo(315, -1)
  })

  it('5 人：排成 2 行（4+1），不超过单行上限', () => {
    const l = computeGroupPhotoLayout(5, { maxPerRow: 4 })
    expect(l.avatars).toHaveLength(5)
    const rows = new Set(l.avatars.map((a) => a.y))
    expect(rows.size).toBe(2)
  })

  it('所有头像都在画布内且不重叠', () => {
    const l = computeGroupPhotoLayout(12)
    for (const a of l.avatars) {
      expect(a.x).toBeGreaterThanOrEqual(0)
      expect(a.y).toBeGreaterThanOrEqual(0)
      expect(a.x + a.size).toBeLessThanOrEqual(l.width)
      expect(a.y + a.size).toBeLessThanOrEqual(l.height)
    }
    // 两两不重叠（同列不同行 y 不同，同行不同列 x 不同）
    for (let i = 0; i < l.avatars.length; i++) {
      for (let j = i + 1; j < l.avatars.length; j++) {
        const a = l.avatars[i], b = l.avatars[j]
        const overlap = a.x < b.x + b.size && b.x < a.x + a.size && a.y < b.y + b.size && b.y < a.y + a.size
        expect(overlap).toBe(false)
      }
    }
  })

  it('头像尺寸随人数自适应缩小但不小于下限', () => {
    const small = computeGroupPhotoLayout(2).avatars[0].size
    const many = computeGroupPhotoLayout(20).avatars[0].size
    expect(many).toBeLessThanOrEqual(small)
    expect(many).toBeGreaterThanOrEqual(72)
  })
})

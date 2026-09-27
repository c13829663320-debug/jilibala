/**
 * R5 分片B：CoachMark 定位几何单测
 */
import { describe, expect, it } from 'vitest'
import { computeCoachPosition, type TargetRect, type ViewportSize } from './coachmark-geo'

const VP: ViewportSize = { width: 1280, height: 800 }
const BUBBLE = { width: 300, height: 140 }

function target(over: Partial<TargetRect> = {}): TargetRect {
  return { x: 200, y: 300, width: 120, height: 48, ...over }
}

describe('computeCoachPosition', () => {
  it('目标在屏幕中部：气泡放在目标下方，箭头指向目标中心', () => {
    const pos = computeCoachPosition(target(), VP, BUBBLE.width, BUBBLE.height)
    expect(pos.placement).toBe('bottom')
    // 目标中心 x = 260；气泡左缘 = 260 - 150 = 110
    expect(pos.left).toBe(110)
    // 气泡顶部 = 目标底(348) + 12 = 360
    expect(pos.top).toBe(360)
    // 箭头相对气泡左缘 = 260 - 110 = 150
    expect(pos.arrowX).toBe(150)
  })

  it('目标贴底：下方放不下，改放上方', () => {
    const nearBottom = target({ y: 800 - 48 - 4 })
    const pos = computeCoachPosition(nearBottom, VP, BUBBLE.width, BUBBLE.height)
    expect(pos.placement).toBe('top')
    // 气泡底部贴目标顶：top = 目标y - 12 - 140
    expect(pos.top).toBe(nearBottom.y - 12 - BUBBLE.height)
  })

  it('目标贴右：气泡水平方向被夹回视口内，箭头不超出气泡', () => {
    const right = target({ x: 1280 - 60, width: 40 })
    const pos = computeCoachPosition(right, VP, BUBBLE.width, BUBBLE.height)
    expect(pos.left + BUBBLE.width).toBeLessThanOrEqual(VP.width - 12)
    expect(pos.arrowX).toBeLessThanOrEqual(BUBBLE.width - 16)
  })

  it('目标贴左：气泡被夹回视口内', () => {
    const left = target({ x: 4, width: 40 })
    const pos = computeCoachPosition(left, VP, BUBBLE.width, BUBBLE.height)
    expect(pos.left).toBeGreaterThanOrEqual(12)
    expect(pos.arrowX).toBeGreaterThanOrEqual(16)
  })

  it('极小视口上下都放不下时退化为居中悬浮', () => {
    const tiny: ViewportSize = { width: 320, height: 200 }
    const pos = computeCoachPosition(target({ y: 90 }), tiny, 280, 160)
    expect(pos.left).toBe(20) // (320-280)/2 居中
    expect(pos.top).toBeGreaterThanOrEqual(12)
  })
})
